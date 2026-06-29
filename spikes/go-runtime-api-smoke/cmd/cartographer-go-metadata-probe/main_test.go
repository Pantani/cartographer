package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestConfigRequiresExplicitEndpoint(t *testing.T) {
	_, err := configFromArgsEnv([]string{}, map[string]string{})
	if err == nil {
		t.Fatal("configFromArgsEnv returned nil error")
	}
	if !strings.Contains(err.Error(), "CARTOGRAPHER_METADATA_RPC_HTTP") {
		t.Fatalf("configFromArgsEnv error = %q, want env var name", err.Error())
	}
}

func TestConfigPrefersFlagOverEnv(t *testing.T) {
	cfg, err := configFromArgsEnv([]string{"--rpc", "https://flag.example"}, map[string]string{
		"CARTOGRAPHER_METADATA_RPC_HTTP": "https://env.example",
	})
	if err != nil {
		t.Fatalf("configFromArgsEnv returned error: %v", err)
	}
	if cfg.RPC != "https://flag.example" {
		t.Fatalf("RPC = %q, want flag value", cfg.RPC)
	}
}

func TestFetchMetadataUsesStateGetMetadataOverHTTP(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}

		var req jsonRPCRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.Method != "state_getMetadata" {
			t.Fatalf("JSON-RPC method = %q, want state_getMetadata", req.Method)
		}
		if len(req.Params) != 0 {
			t.Fatalf("params = %#v, want empty", req.Params)
		}

		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"result":"0x6d6574610f"}`))
	}))
	defer server.Close()

	got, err := fetchMetadata(context.Background(), server.Client(), server.URL)
	if err != nil {
		t.Fatalf("fetchMetadata returned error: %v", err)
	}
	if string(got[:4]) != "meta" || got[4] != 15 {
		t.Fatalf("metadata bytes = %x, want meta envelope v15", got)
	}
}

func TestFetchMetadataRejectsRPCError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"boom"}}`))
	}))
	defer server.Close()

	_, err := fetchMetadata(context.Background(), server.Client(), server.URL)
	if err == nil {
		t.Fatal("fetchMetadata returned nil error")
	}
	if !strings.Contains(err.Error(), "boom") {
		t.Fatalf("fetchMetadata error = %q, want RPC error message", err.Error())
	}
}

func TestProbeMetadataReportsBlockedWhenDecodeFails(t *testing.T) {
	got := probeMetadata([]byte{'m', 'e', 't', 'a', 14})

	if got.Status != "blocked" {
		t.Fatalf("Status = %q, want blocked", got.Status)
	}
	if got.MetadataVersion != 14 {
		t.Fatalf("MetadataVersion = %d, want 14", got.MetadataVersion)
	}
	if !strings.Contains(got.Error, "unsupported metadata version") {
		t.Fatalf("Error = %q, want decode failure", got.Error)
	}
}

func TestProbeMetadataReportsLocatedAcceptableAssetsMethod(t *testing.T) {
	got := probeMetadata(v15MetadataWithAcceptableAssets())

	if got.Status != "ok" {
		t.Fatalf("Status = %q, want ok; error = %q", got.Status, got.Error)
	}
	if got.MetadataVersion != 15 {
		t.Fatalf("MetadataVersion = %d, want 15", got.MetadataVersion)
	}
	if got.RuntimeAPICount != 1 {
		t.Fatalf("RuntimeAPICount = %d, want 1", got.RuntimeAPICount)
	}
	if got.Method == nil {
		t.Fatal("Method = nil, want located method")
	}
	if got.Method.API != "XcmPaymentApi" || got.Method.Name != "query_acceptable_payment_assets" {
		t.Fatalf("Method = %#v, want XcmPaymentApi.query_acceptable_payment_assets", got.Method)
	}
	if got.Method.OutputTypeID != 7 {
		t.Fatalf("OutputTypeID = %d, want 7", got.Method.OutputTypeID)
	}
	if len(got.Method.Params) != 1 || got.Method.Params[0].Name != "xcm_version" || got.Method.Params[0].TypeID != 4 {
		t.Fatalf("Params = %#v, want xcm_version type 4", got.Method.Params)
	}
}

func TestRunProbeFetchesAndDecodesMetadata(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		metadataHex := "0x" + hexString(v15MetadataWithAcceptableAssets())
		_ = json.NewEncoder(w).Encode(jsonRPCResponse{JSONRPC: "2.0", ID: 1, Result: metadataHex})
	}))
	defer server.Close()

	got, err := runProbe(context.Background(), server.Client(), []string{"--rpc", server.URL}, map[string]string{})
	if err != nil {
		t.Fatalf("runProbe returned error: %v", err)
	}
	if got.Status != "ok" || got.RuntimeAPICount != 1 || got.Method == nil {
		t.Fatalf("runProbe result = %#v, want decoded method evidence", got)
	}
}

func v15MetadataWithAcceptableAssets() []byte {
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
