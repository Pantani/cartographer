package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"cartographer-go-smoke/internal/metadatadecode"
)

const (
	metadataEnvVar    = "CARTOGRAPHER_METADATA_RPC_HTTP"
	stateMetadata     = "state_getMetadata"
	targetAPI         = "XcmPaymentApi"
	targetMethod      = "query_acceptable_payment_assets"
	metadataProbeName = "cartographer-go-metadata-probe"
)

type config struct {
	RPC string
}

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type probeResult struct {
	Status          string       `json:"status"`
	MetadataVersion uint8        `json:"metadataVersion,omitempty"`
	RuntimeAPICount int          `json:"runtimeApiCount,omitempty"`
	Method          *methodProbe `json:"method,omitempty"`
	Error           string       `json:"error,omitempty"`
}

type methodProbe struct {
	API          string       `json:"api"`
	Name         string       `json:"name"`
	Params       []paramProbe `json:"params,omitempty"`
	OutputTypeID uint32       `json:"outputTypeId"`
}

type paramProbe struct {
	Name   string `json:"name"`
	TypeID uint32 `json:"typeId"`
}

type jsonRPCRequest struct {
	JSONRPC string            `json:"jsonrpc"`
	ID      int               `json:"id"`
	Method  string            `json:"method"`
	Params  []json.RawMessage `json:"params"`
}

type jsonRPCResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	ID      int           `json:"id"`
	Result  string        `json:"result,omitempty"`
	Error   *jsonRPCError `json:"error,omitempty"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	result, err := runProbe(ctx, http.DefaultClient, os.Args[1:], map[string]string{
		metadataEnvVar: os.Getenv(metadataEnvVar),
	})
	if err != nil {
		renderAndExit(probeResult{Status: "error", Error: err.Error()}, 1)
	}

	renderAndExit(result, 0)
}

func renderAndExit(result probeResult, code int) {
	out, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: render JSON: %v\n", metadataProbeName, err)
		os.Exit(1)
	}
	fmt.Println(string(out))
	os.Exit(code)
}

func runProbe(ctx context.Context, client httpDoer, args []string, env map[string]string) (probeResult, error) {
	cfg, err := configFromArgsEnv(args, env)
	if err != nil {
		return probeResult{}, err
	}

	metadata, err := fetchMetadata(ctx, client, cfg.RPC)
	if err != nil {
		return probeResult{}, err
	}

	return probeMetadata(metadata), nil
}

func configFromArgsEnv(args []string, env map[string]string) (config, error) {
	flags := flag.NewFlagSet(metadataProbeName, flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	rpcFlag := flags.String("rpc", "", "HTTP JSON-RPC endpoint")
	if err := flags.Parse(args); err != nil {
		return config{}, err
	}

	rpc := strings.TrimSpace(*rpcFlag)
	if rpc == "" {
		rpc = strings.TrimSpace(env[metadataEnvVar])
	}
	if rpc == "" {
		return config{}, fmt.Errorf("missing --rpc or %s", metadataEnvVar)
	}
	if !strings.HasPrefix(rpc, "http://") && !strings.HasPrefix(rpc, "https://") {
		return config{}, fmt.Errorf("--rpc/%s must be an HTTP(S) JSON-RPC endpoint", metadataEnvVar)
	}

	return config{RPC: rpc}, nil
}

func fetchMetadata(ctx context.Context, client httpDoer, endpoint string) ([]byte, error) {
	if client == nil {
		return nil, fmt.Errorf("HTTP client is nil")
	}

	reqBody := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  stateMetadata,
		Params:  []json.RawMessage{},
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("encode JSON-RPC request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build metadata request: %w", err)
	}
	req.Header.Set("content-type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s request failed: %w", stateMetadata, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("%s HTTP status %d", stateMetadata, resp.StatusCode)
	}

	var rpcResp jsonRPCResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return nil, fmt.Errorf("decode JSON-RPC response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("%s JSON-RPC error %d: %s", stateMetadata, rpcResp.Error.Code, rpcResp.Error.Message)
	}
	if strings.TrimSpace(rpcResp.Result) == "" {
		return nil, fmt.Errorf("%s response missing result", stateMetadata)
	}

	return decodeHexResult(rpcResp.Result)
}

func decodeHexResult(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if !strings.HasPrefix(trimmed, "0x") {
		return nil, fmt.Errorf("%s result must be 0x-prefixed hex", stateMetadata)
	}
	payload := trimmed[2:]
	if len(payload)%2 != 0 {
		return nil, fmt.Errorf("%s result must have an even number of hex characters", stateMetadata)
	}
	out, err := hex.DecodeString(payload)
	if err != nil {
		return nil, fmt.Errorf("%s result must be valid hex: %w", stateMetadata, err)
	}
	return out, nil
}

func probeMetadata(raw []byte) probeResult {
	version, hasVersion := metadataVersion(raw)

	metadata, err := metadatadecode.DecodeRuntimeAPIs(raw)
	if err != nil {
		result := probeResult{Status: "blocked", Error: err.Error()}
		if hasVersion {
			result.MetadataVersion = version
		}
		return result
	}

	result := probeResult{
		Status:          "ok",
		MetadataVersion: metadata.Version,
		RuntimeAPICount: len(metadata.RuntimeAPIs),
	}

	method, ok := metadatadecode.FindRuntimeAPIMethod(metadata, targetAPI, targetMethod)
	if !ok {
		result.Status = "blocked"
		result.Error = targetAPI + "." + targetMethod + " not found in runtime APIs"
		return result
	}

	result.Method = projectMethod(method)
	return result
}

func metadataVersion(raw []byte) (uint8, bool) {
	if len(raw) < 5 || string(raw[:4]) != "meta" {
		return 0, false
	}
	return raw[4], true
}

func projectMethod(method metadatadecode.RuntimeAPIMethod) *methodProbe {
	params := make([]paramProbe, 0, len(method.Params))
	for _, param := range method.Params {
		params = append(params, paramProbe{Name: param.Name, TypeID: param.TypeID})
	}
	return &methodProbe{
		API:          targetAPI,
		Name:         method.Name,
		Params:       params,
		OutputTypeID: method.OutputTypeID,
	}
}
