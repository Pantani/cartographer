package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
)

func TestConfigRequiresEndpointMetadataVersionAndXCMVersion(t *testing.T) {
	_, err := configFromArgsEnv([]string{}, map[string]string{})
	if err == nil {
		t.Fatal("configFromArgsEnv returned nil error")
	}
	if !strings.Contains(err.Error(), "CARTOGRAPHER_METADATA_RPC_HTTP") {
		t.Fatalf("error = %q, want endpoint env var", err.Error())
	}

	_, err = configFromArgsEnv([]string{"--rpc", "https://rpc.example"}, map[string]string{})
	if err == nil {
		t.Fatal("configFromArgsEnv returned nil error for missing metadata version")
	}
	if !strings.Contains(err.Error(), "--metadata-version") {
		t.Fatalf("error = %q, want metadata version message", err.Error())
	}

	_, err = configFromArgsEnv([]string{"--rpc", "https://rpc.example", "--metadata-version", "16"}, map[string]string{})
	if err == nil {
		t.Fatal("configFromArgsEnv returned nil error for missing xcm version")
	}
	if !strings.Contains(err.Error(), "--xcm-version") {
		t.Fatalf("error = %q, want xcm version message", err.Error())
	}
}

func TestRunProbeUsesMetadataMethodTypeIDsThenDecodesAssets(t *testing.T) {
	metadata := v16MetadataWithTargetMethod(14, 1020)
	calls := make([]jsonRPCRequest, 0, 2)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}

		var req jsonRPCRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		calls = append(calls, req)

		switch len(calls) {
		case 1:
			assertStateCallParam(t, req, "Metadata_metadata_at_version", "0x10000000")
			responseHex := "0x" + hexPayloadString(optionSomeBytes(metadata))
			_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: responseHex})
		case 2:
			assertStateCallParam(t, req, "XcmPaymentApi_query_acceptable_payment_assets", "0x05000000")
			_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: req.ID, Result: "0x0004050000"})
		default:
			t.Fatalf("unexpected request #%d: %+v", len(calls), req)
		}
	}))
	defer server.Close()

	got, err := runProbe(context.Background(), server.Client(), []string{
		"--rpc", server.URL,
		"--metadata-version", "16",
		"--xcm-version", "5",
	}, map[string]string{})
	if err != nil {
		t.Fatalf("runProbe returned error: %v", err)
	}
	if got.Status != "ok" {
		t.Fatalf("Status = %q, want ok; error = %q", got.Status, got.Error)
	}
	if len(calls) != 2 {
		t.Fatalf("request count = %d, want 2", len(calls))
	}
	if got.MetadataVersion != 16 || got.XCMVersion != 5 {
		t.Fatalf("versions = metadata %d xcm %d, want 16/5", got.MetadataVersion, got.XCMVersion)
	}
	if got.ArgsHex != "0x05000000" {
		t.Fatalf("ArgsHex = %q, want SCALE u32 xcm version", got.ArgsHex)
	}
	if got.Method == nil {
		t.Fatal("Method = nil, want located method")
	}
	if got.Method.Params[0].Name != "xcm_version" || got.Method.Params[0].TypeID != 14 {
		t.Fatalf("Params = %#v, want xcm_version type 14", got.Method.Params)
	}
	if got.Method.OutputTypeID != 1020 {
		t.Fatalf("OutputTypeID = %d, want 1020", got.Method.OutputTypeID)
	}
	if got.Decoded == nil || got.Decoded.AssetCount != 1 || got.Decoded.Assets[0].VersionTag != "V5" {
		t.Fatalf("Decoded = %+v, want one V5 asset", got.Decoded)
	}
}

func TestRunProbeBlocksWhenMetadataMethodMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		responseHex := "0x" + hexPayloadString(optionSomeBytes(v16MetadataWithoutRuntimeAPIs()))
		_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: 1, Result: responseHex})
	}))
	defer server.Close()

	got, err := runProbe(context.Background(), server.Client(), []string{
		"--rpc", server.URL,
		"--metadata-version", "16",
		"--xcm-version", "5",
	}, map[string]string{})
	if err != nil {
		t.Fatalf("runProbe returned error: %v", err)
	}
	if got.Status != "blocked" {
		t.Fatalf("Status = %q, want blocked", got.Status)
	}
	if !strings.Contains(got.Error, "XcmPaymentApi.query_acceptable_payment_assets not found") {
		t.Fatalf("Error = %q, want missing method", got.Error)
	}
}

func TestRunProbeBlocksWhenReturnedAssetsCannotDecode(t *testing.T) {
	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		callCount++
		if callCount == 1 {
			responseHex := "0x" + hexPayloadString(optionSomeBytes(v16MetadataWithTargetMethod(14, 1020)))
			_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: 1, Result: responseHex})
			return
		}
		_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: 1, Result: "0x00"})
	}))
	defer server.Close()

	got, err := runProbe(context.Background(), server.Client(), []string{
		"--rpc", server.URL,
		"--metadata-version", "16",
		"--xcm-version", "5",
	}, map[string]string{})
	if err != nil {
		t.Fatalf("runProbe returned error: %v", err)
	}
	if got.Status != "blocked" {
		t.Fatalf("Status = %q, want blocked", got.Status)
	}
	if !strings.Contains(got.Error, "decode acceptable payment assets return") {
		t.Fatalf("Error = %q, want decode failure", got.Error)
	}
}

func TestCommandNoArgsExitsNonzeroWithJSONError(t *testing.T) {
	if os.Getenv("CARTOGRAPHER_ACCEPTABLE_ASSETS_PROBE_HELPER") == "1" {
		main()
		return
	}

	cmd := exec.Command(os.Args[0], "-test.run=TestCommandNoArgsExitsNonzeroWithJSONError")
	cmd.Env = append(os.Environ(),
		"CARTOGRAPHER_ACCEPTABLE_ASSETS_PROBE_HELPER=1",
		"CARTOGRAPHER_METADATA_RPC_HTTP=",
	)
	output, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatal("command exited nil, want nonzero")
	}
	if !strings.Contains(string(output), `"status": "error"`) {
		t.Fatalf("output = %s, want JSON error status", output)
	}
}

func assertStateCallParam(t *testing.T, req jsonRPCRequest, method string, argsHex string) {
	t.Helper()
	if req.Method != "state_call" {
		t.Fatalf("JSON-RPC method = %q, want state_call", req.Method)
	}
	if len(req.Params) != 2 {
		t.Fatalf("params len = %d, want 2", len(req.Params))
	}
	if string(req.Params[0]) != `"`+method+`"` {
		t.Fatalf("method param = %s, want %s", req.Params[0], method)
	}
	if string(req.Params[1]) != `"`+argsHex+`"` {
		t.Fatalf("args param = %s, want %s", req.Params[1], argsHex)
	}
}

func v16MetadataWithTargetMethod(inputType, outputType uint32) []byte {
	out := v16MetadataPrefix()
	out = appendRuntimeAPI(out, "XcmPaymentApi", "query_acceptable_payment_assets", inputType, outputType, 2)
	return out
}

func v16MetadataWithoutRuntimeAPIs() []byte {
	out := v16MetadataPrefix()
	out = append(out, compact(0)...) // runtime APIs
	return out
}

func v16MetadataPrefix() []byte {
	out := []byte{'m', 'e', 't', 'a', 16}
	out = append(out, compact(0)...) // PortableRegistry.types
	out = append(out, compact(0)...) // pallets
	out = append(out, compact(1)...) // extrinsic.versions
	out = append(out, 5)
	out = appendTypeIDs(out, 0, 1, 2) // address_ty, call_ty, signature_ty
	out = append(out, compact(0)...)  // transaction_extensions_by_version
	out = append(out, compact(0)...)  // transaction_extensions
	return out
}

func appendRuntimeAPI(out []byte, apiName, methodName string, inputType, outputType, apiVersion uint32) []byte {
	out = append(out, compact(1)...)
	out = appendString(out, apiName)
	out = append(out, compact(1)...)
	out = appendString(out, methodName)
	out = append(out, compact(1)...)
	out = appendString(out, "xcm_version")
	out = appendTypeIDs(out, inputType)
	out = appendTypeIDs(out, outputType)
	out = append(out, compact(0)...) // method docs
	out = append(out, 0)             // method deprecation_info: NotDeprecated
	out = append(out, compact(0)...) // API docs
	out = append(out, compact(apiVersion)...)
	out = append(out, 0) // API deprecation_info: NotDeprecated
	return out
}

func optionSomeBytes(data []byte) []byte {
	out := []byte{1}
	out = append(out, compact(uint32(len(data)))...)
	return append(out, data...)
}

func appendString(out []byte, value string) []byte {
	out = append(out, compact(uint32(len(value)))...)
	return append(out, []byte(value)...)
}

func appendTypeIDs(out []byte, values ...uint32) []byte {
	for _, value := range values {
		out = append(out, compact(value)...)
	}
	return out
}

func compact(value uint32) []byte {
	switch {
	case value < 1<<6:
		return []byte{byte(value << 2)}
	case value < 1<<14:
		encoded := uint16(value<<2) | 0b01
		return []byte{byte(encoded), byte(encoded >> 8)}
	case value < 1<<30:
		encoded := value<<2 | 0b10
		return []byte{byte(encoded), byte(encoded >> 8), byte(encoded >> 16), byte(encoded >> 24)}
	default:
		return []byte{0b11, byte(value), byte(value >> 8), byte(value >> 16), byte(value >> 24)}
	}
}

func hexPayloadString(data []byte) string {
	const alphabet = "0123456789abcdef"
	out := make([]byte, 0, len(data)*2)
	for _, b := range data {
		out = append(out, alphabet[b>>4], alphabet[b&0x0f])
	}
	return string(out)
}

func TestDecodeOptionOpaqueMetadataRejectsTrailingBytes(t *testing.T) {
	data := append(optionSomeBytes([]byte("meta")), 0)

	_, err := decodeOptionOpaqueMetadata(data)
	if err == nil {
		t.Fatal("decodeOptionOpaqueMetadata returned nil error")
	}
	if !strings.Contains(err.Error(), "trailing data") {
		t.Fatalf("error = %q, want trailing data", err.Error())
	}
}

func TestEncodeXCMVersionArgRequiresSourcedParam(t *testing.T) {
	method := methodProbe{
		API:          "XcmPaymentApi",
		Name:         "query_acceptable_payment_assets",
		Params:       []paramProbe{{Name: "xcm_version", TypeID: 14}},
		OutputTypeID: 1020,
	}

	got, err := encodeXCMVersionArgHex(method, 5)
	if err != nil {
		t.Fatalf("encodeXCMVersionArgHex returned error: %v", err)
	}
	if got != "0x05000000" {
		t.Fatalf("arg hex = %q, want little-endian u32", got)
	}

	method.Params[0].Name = "other"
	_, err = encodeXCMVersionArgHex(method, 5)
	if err == nil {
		t.Fatal("encodeXCMVersionArgHex returned nil error for wrong param")
	}
}

func TestDecodeHexResultRejectsOddLength(t *testing.T) {
	_, err := decodeHexResult("0x0")
	if err == nil {
		t.Fatal("decodeHexResult returned nil error")
	}
}

func TestOptionRoundTripFixture(t *testing.T) {
	metadata := v16MetadataWithTargetMethod(14, 1020)
	got, err := decodeOptionOpaqueMetadata(optionSomeBytes(metadata))
	if err != nil {
		t.Fatalf("decodeOptionOpaqueMetadata returned error: %v", err)
	}
	if !bytes.Equal(got, metadata) {
		t.Fatalf("metadata = %x, want %x", got, metadata)
	}
}
