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

func TestConfigRequiresVersionAndEndpoint(t *testing.T) {
	_, err := configFromArgsEnv([]string{}, map[string]string{})
	if err == nil {
		t.Fatal("configFromArgsEnv returned nil error")
	}
	if !strings.Contains(err.Error(), "CARTOGRAPHER_METADATA_RPC_HTTP") {
		t.Fatalf("error = %q, want endpoint env var", err.Error())
	}

	_, err = configFromArgsEnv([]string{"--rpc", "https://rpc.example"}, map[string]string{})
	if err == nil {
		t.Fatal("configFromArgsEnv returned nil error for missing version")
	}
	if !strings.Contains(err.Error(), "--version") {
		t.Fatalf("error = %q, want version message", err.Error())
	}
}

func TestConfigPrefersFlagEndpointOverEnv(t *testing.T) {
	cfg, err := configFromArgsEnv([]string{"--rpc", "https://flag.example", "--version", "15"}, map[string]string{
		"CARTOGRAPHER_METADATA_RPC_HTTP": "https://env.example",
	})
	if err != nil {
		t.Fatalf("configFromArgsEnv returned error: %v", err)
	}
	if cfg.RPC != "https://flag.example" {
		t.Fatalf("RPC = %q, want flag value", cfg.RPC)
	}
	if cfg.Version != 15 {
		t.Fatalf("Version = %d, want 15", cfg.Version)
	}
}

func TestFetchMetadataAtVersionUsesStateCallOverHTTP(t *testing.T) {
	metadata := v15MetadataWithTargetMethod()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}

		var req jsonRPCRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Method != "state_call" {
			t.Fatalf("JSON-RPC method = %q, want state_call", req.Method)
		}
		if len(req.Params) != 2 {
			t.Fatalf("params len = %d, want 2", len(req.Params))
		}
		if string(req.Params[0]) != `"Metadata_metadata_at_version"` {
			t.Fatalf("method param = %s, want Metadata_metadata_at_version", req.Params[0])
		}
		if string(req.Params[1]) != `"0x0f000000"` {
			t.Fatalf("args param = %s, want SCALE u32 version 15", req.Params[1])
		}

		responseHex := "0x" + hexString(optionSomeBytes(metadata))
		_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: 1, Result: responseHex})
	}))
	defer server.Close()

	got, err := fetchMetadataAtVersion(context.Background(), server.Client(), server.URL, 15)
	if err != nil {
		t.Fatalf("fetchMetadataAtVersion returned error: %v", err)
	}
	if !bytes.Equal(got, metadata) {
		t.Fatalf("metadata bytes = %x, want %x", got, metadata)
	}
}

func TestProbeReportsBlockedForUnsupportedReturnedMetadata(t *testing.T) {
	got := probeMetadataVersion(16, []byte{'m', 'e', 't', 'a', 14})

	if got.Status != "blocked" {
		t.Fatalf("Status = %q, want blocked", got.Status)
	}
	if got.RequestedVersion != 16 {
		t.Fatalf("RequestedVersion = %d, want 16", got.RequestedVersion)
	}
	if got.ReturnedMetadataVersion != 14 {
		t.Fatalf("ReturnedMetadataVersion = %d, want 14", got.ReturnedMetadataVersion)
	}
	if !strings.Contains(got.Error, "unsupported metadata version") {
		t.Fatalf("Error = %q, want decode failure", got.Error)
	}
}

func TestRunProbeReportsMethodTypeIDsFromReturnedMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		responseHex := "0x" + hexString(optionSomeBytes(v15MetadataWithTargetMethod()))
		_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: 1, Result: responseHex})
	}))
	defer server.Close()

	got, err := runProbe(context.Background(), server.Client(), []string{"--rpc", server.URL, "--version", "15"}, map[string]string{})
	if err != nil {
		t.Fatalf("runProbe returned error: %v", err)
	}
	if got.Status != "ok" {
		t.Fatalf("Status = %q, want ok; error = %q", got.Status, got.Error)
	}
	if got.RequestedVersion != 15 || got.ReturnedMetadataVersion != 15 {
		t.Fatalf("versions = requested %d returned %d, want 15/15", got.RequestedVersion, got.ReturnedMetadataVersion)
	}
	if got.RuntimeAPICount != 1 {
		t.Fatalf("RuntimeAPICount = %d, want 1", got.RuntimeAPICount)
	}
	if got.Method == nil {
		t.Fatal("Method = nil, want located method")
	}
	if got.Method.OutputTypeID != 7 {
		t.Fatalf("OutputTypeID = %d, want 7", got.Method.OutputTypeID)
	}
	if len(got.Method.Params) != 1 || got.Method.Params[0].Name != "xcm_version" || got.Method.Params[0].TypeID != 4 {
		t.Fatalf("Params = %#v, want xcm_version type 4", got.Method.Params)
	}
}

func TestFetchMetadataAtVersionReportsNoneAsBlocked(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: 1, Result: "0x00"})
	}))
	defer server.Close()

	_, err := fetchMetadataAtVersion(context.Background(), server.Client(), server.URL, 16)
	if err == nil {
		t.Fatal("fetchMetadataAtVersion returned nil error")
	}
	if !strings.Contains(err.Error(), "no metadata returned for version 16") {
		t.Fatalf("error = %q, want unsupported-version none", err.Error())
	}
}

func TestRunProbeReportsMalformedReturnEnvelopeAsBlocked(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: 1, Result: "0x0104"})
	}))
	defer server.Close()

	got, err := runProbe(context.Background(), server.Client(), []string{"--rpc", server.URL, "--version", "15"}, map[string]string{})
	if err != nil {
		t.Fatalf("runProbe returned error: %v", err)
	}
	if got.Status != "blocked" {
		t.Fatalf("Status = %q, want blocked", got.Status)
	}
	if !strings.Contains(got.Error, "decode metadata_at_version Option<OpaqueMetadata>") {
		t.Fatalf("Error = %q, want return envelope decode error", got.Error)
	}
}

func TestCommandNoArgsExitsNonzeroWithJSONError(t *testing.T) {
	if os.Getenv("CARTOGRAPHER_METADATA_VERSION_PROBE_HELPER") == "1" {
		main()
		return
	}

	cmd := exec.Command(os.Args[0], "-test.run=TestCommandNoArgsExitsNonzeroWithJSONError")
	cmd.Env = append(os.Environ(),
		"CARTOGRAPHER_METADATA_VERSION_PROBE_HELPER=1",
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

func v15MetadataWithTargetMethod() []byte {
	out := []byte{'m', 'e', 't', 'a', 15}
	out = append(out, compact(0)...) // PortableRegistry.types
	out = append(out, compact(0)...) // pallets
	out = append(out, 4)             // extrinsic.version
	out = appendTypeIDs(out, 0, 1, 2, 3)
	out = append(out, compact(0)...) // signed_extensions
	out = appendTypeIDs(out, 99)     // runtime ty
	out = appendRuntimeAPI(out, "XcmPaymentApi", "query_acceptable_payment_assets", 4, 7)
	return out
}

func appendRuntimeAPI(out []byte, apiName, methodName string, inputType, outputType uint32) []byte {
	out = append(out, compact(1)...)
	out = appendString(out, apiName)
	out = append(out, compact(1)...)
	out = appendString(out, methodName)
	out = append(out, compact(1)...)
	out = appendString(out, "xcm_version")
	out = appendTypeIDs(out, inputType)
	out = appendTypeIDs(out, outputType)
	out = append(out, compact(0)...) // method docs
	out = append(out, compact(0)...) // API docs
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

func hexString(data []byte) string {
	const alphabet = "0123456789abcdef"
	out := make([]byte, 0, len(data)*2)
	for _, b := range data {
		out = append(out, alphabet[b>>4], alphabet[b&0x0f])
	}
	return string(out)
}
