package main

import (
	"bytes"
	"context"
	"encoding/binary"
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
	metadataEnvVar = "CARTOGRAPHER_METADATA_RPC_HTTP"
	probeName      = "cartographer-go-metadata-version-probe"
	stateCall      = "state_call"

	metadataAtVersionMethod = "Metadata_metadata_at_version"
	targetAPI               = "XcmPaymentApi"
	targetMethod            = "query_acceptable_payment_assets"
)

type config struct {
	RPC     string
	Version uint32
}

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type probeResult struct {
	Status                  string       `json:"status"`
	RequestedVersion        uint32       `json:"requestedVersion,omitempty"`
	ReturnedMetadataVersion uint8        `json:"returnedMetadataVersion,omitempty"`
	RuntimeAPICount         int          `json:"runtimeApiCount,omitempty"`
	Method                  *methodProbe `json:"method,omitempty"`
	Error                   string       `json:"error,omitempty"`
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

type blockedError struct {
	message string
}

func (e blockedError) Error() string {
	return e.message
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

	code := 0
	if result.Status == "error" {
		code = 1
	}
	renderAndExit(result, code)
}

func renderAndExit(result probeResult, code int) {
	out, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "%s: render JSON: %v\n", probeName, err)
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

	metadata, err := fetchMetadataAtVersion(ctx, client, cfg.RPC, cfg.Version)
	if err != nil {
		if _, ok := err.(blockedError); ok {
			return probeResult{Status: "blocked", RequestedVersion: cfg.Version, Error: err.Error()}, nil
		}
		return probeResult{}, err
	}

	return probeMetadataVersion(cfg.Version, metadata), nil
}

func configFromArgsEnv(args []string, env map[string]string) (config, error) {
	flags := flag.NewFlagSet(probeName, flag.ContinueOnError)
	flags.SetOutput(io.Discard)

	rpcFlag := flags.String("rpc", "", "HTTP JSON-RPC endpoint")
	versionFlag := flags.Uint("version", 0, "metadata version to request, for example 15 or 16")
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
	if *versionFlag == 0 {
		return config{}, fmt.Errorf("missing --version")
	}
	if *versionFlag > uint(^uint32(0)) {
		return config{}, fmt.Errorf("--version must fit in u32")
	}

	return config{RPC: rpc, Version: uint32(*versionFlag)}, nil
}

func fetchMetadataAtVersion(ctx context.Context, client httpDoer, endpoint string, version uint32) ([]byte, error) {
	if client == nil {
		return nil, fmt.Errorf("HTTP client is nil")
	}

	rawResult, err := callState(ctx, client, endpoint, metadataAtVersionMethod, encodeU32ArgHex(version))
	if err != nil {
		return nil, err
	}

	metadata, err := decodeOptionOpaqueMetadata(rawResult)
	if err != nil {
		return nil, err
	}
	if metadata == nil {
		return nil, blockedError{message: fmt.Sprintf("no metadata returned for version %d", version)}
	}
	return metadata, nil
}

func callState(ctx context.Context, client httpDoer, endpoint, method, argsHex string) ([]byte, error) {
	reqBody, err := buildStateCallRequest(method, argsHex)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(reqBody))
	if err != nil {
		return nil, fmt.Errorf("build %s request: %w", stateCall, err)
	}
	req.Header.Set("content-type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%s request failed: %w", stateCall, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, fmt.Errorf("%s HTTP status %d", stateCall, resp.StatusCode)
	}

	var rpcResp jsonRPCResponse
	if err := json.NewDecoder(resp.Body).Decode(&rpcResp); err != nil {
		return nil, fmt.Errorf("decode JSON-RPC response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("%s JSON-RPC error %d: %s", stateCall, rpcResp.Error.Code, rpcResp.Error.Message)
	}
	if strings.TrimSpace(rpcResp.Result) == "" {
		return nil, fmt.Errorf("%s response missing result", stateCall)
	}

	return decodeHexResult(rpcResp.Result)
}

func buildStateCallRequest(method, argsHex string) ([]byte, error) {
	methodParam, err := json.Marshal(method)
	if err != nil {
		return nil, fmt.Errorf("encode state_call method param: %w", err)
	}
	argsParam, err := json.Marshal(argsHex)
	if err != nil {
		return nil, fmt.Errorf("encode state_call args param: %w", err)
	}
	reqBody := jsonRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  stateCall,
		Params:  []json.RawMessage{methodParam, argsParam},
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("encode JSON-RPC request: %w", err)
	}
	return body, nil
}

func encodeU32ArgHex(value uint32) string {
	var encoded [4]byte
	binary.LittleEndian.PutUint32(encoded[:], value)
	return "0x" + hex.EncodeToString(encoded[:])
}

func decodeHexResult(value string) ([]byte, error) {
	trimmed := strings.TrimSpace(value)
	if !strings.HasPrefix(trimmed, "0x") {
		return nil, fmt.Errorf("%s result must be 0x-prefixed hex", stateCall)
	}
	payload := trimmed[2:]
	if len(payload)%2 != 0 {
		return nil, fmt.Errorf("%s result must have an even number of hex characters", stateCall)
	}
	out, err := hex.DecodeString(payload)
	if err != nil {
		return nil, fmt.Errorf("%s result must be valid hex: %w", stateCall, err)
	}
	return out, nil
}

func decodeOptionOpaqueMetadata(data []byte) ([]byte, error) {
	reader := newByteReader(data)
	option, err := reader.readByte()
	if err != nil {
		return nil, blockedError{message: "decode metadata_at_version Option<OpaqueMetadata>: " + err.Error()}
	}
	switch option {
	case 0:
		return nil, nil
	case 1:
		return reader.readBytesVec()
	default:
		return nil, blockedError{message: fmt.Sprintf("decode metadata_at_version Option<OpaqueMetadata>: invalid Option discriminant %d", option)}
	}
}

func probeMetadataVersion(requested uint32, raw []byte) probeResult {
	returned, hasReturned := metadataVersion(raw)

	metadata, err := metadatadecode.DecodeRuntimeAPIs(raw)
	if err != nil {
		result := probeResult{Status: "blocked", RequestedVersion: requested, Error: err.Error()}
		if hasReturned {
			result.ReturnedMetadataVersion = returned
		}
		return result
	}

	result := probeResult{
		Status:                  "ok",
		RequestedVersion:        requested,
		ReturnedMetadataVersion: metadata.Version,
		RuntimeAPICount:         len(metadata.RuntimeAPIs),
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

type byteReader struct {
	data []byte
	pos  int
}

func newByteReader(data []byte) *byteReader {
	return &byteReader{data: data}
}

func (r *byteReader) readBytesVec() ([]byte, error) {
	length, err := r.readCompactU32()
	if err != nil {
		return nil, blockedError{message: "decode OpaqueMetadata length: " + err.Error()}
	}
	bytes, err := r.readBytes(int(length))
	if err != nil {
		return nil, blockedError{message: "decode metadata_at_version Option<OpaqueMetadata>: " + err.Error()}
	}
	return bytes, nil
}

func (r *byteReader) readCompactU32() (uint32, error) {
	first, err := r.readByte()
	if err != nil {
		return 0, err
	}

	switch first & 0b11 {
	case 0:
		return uint32(first >> 2), nil
	case 1:
		second, err := r.readByte()
		if err != nil {
			return 0, err
		}
		return uint32(binary.LittleEndian.Uint16([]byte{first, second}) >> 2), nil
	case 2:
		bytes, err := r.readBytes(3)
		if err != nil {
			return 0, err
		}
		encoded := uint32(first) | uint32(bytes[0])<<8 | uint32(bytes[1])<<16 | uint32(bytes[2])<<24
		return encoded >> 2, nil
	default:
		return r.readBigCompactU32(first)
	}
}

func (r *byteReader) readBigCompactU32(first byte) (uint32, error) {
	byteCount := int(first>>2) + 4
	if byteCount > 4 {
		return 0, fmt.Errorf("compact integer exceeds u32: %d bytes", byteCount)
	}
	bytes, err := r.readBytes(byteCount)
	if err != nil {
		return 0, err
	}

	var value uint32
	for i, b := range bytes {
		value |= uint32(b) << (8 * i)
	}
	return value, nil
}

func (r *byteReader) readByte() (uint8, error) {
	bytes, err := r.readBytes(1)
	if err != nil {
		return 0, err
	}
	return bytes[0], nil
}

func (r *byteReader) readBytes(length int) ([]byte, error) {
	if length < 0 || r.pos+length > len(r.data) {
		return nil, fmt.Errorf("short SCALE payload")
	}
	bytes := r.data[r.pos : r.pos+length]
	r.pos += length
	return bytes, nil
}
