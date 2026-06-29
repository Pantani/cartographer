package rpccall

import (
	"context"
	"encoding/hex"
	"fmt"
	"strings"
)

const (
	// StateCallRPCMethod is the Substrate JSON-RPC method used for raw runtime API calls.
	StateCallRPCMethod = "state_call"
)

// StateCallClient captures the GSRPC CallContext shape required by raw runtime calls.
type StateCallClient interface {
	CallContext(ctx context.Context, result interface{}, method string, args ...interface{}) error
}

// RawRuntimeCall contains an already SCALE-encoded runtime API call payload.
type RawRuntimeCall struct {
	Method  string
	ArgsHex string
}

// CallRawRuntime invokes state_call and returns raw hex without decoding runtime-specific SCALE output.
func CallRawRuntime(ctx context.Context, client StateCallClient, call RawRuntimeCall) (RuntimeCallEvidence, error) {
	method := strings.TrimSpace(call.Method)
	argsHex := strings.TrimSpace(call.ArgsHex)

	if client == nil {
		return RuntimeCallEvidence{}, fmt.Errorf("state_call client is nil")
	}
	if method == "" {
		return RuntimeCallEvidence{}, fmt.Errorf("runtime API method is required")
	}
	if err := validateHex("runtime API args", argsHex); err != nil {
		return RuntimeCallEvidence{}, err
	}

	var rawHex string
	if err := client.CallContext(ctx, &rawHex, StateCallRPCMethod, method, argsHex); err != nil {
		return RuntimeCallEvidence{}, fmt.Errorf("%s %s failed: %w", StateCallRPCMethod, method, err)
	}
	if err := validateHex("raw result", strings.TrimSpace(rawHex)); err != nil {
		return RuntimeCallEvidence{}, err
	}

	return RuntimeCallEvidence{
		Method: method,
		Status: "ok",
		RawHex: strings.TrimSpace(rawHex),
	}, nil
}

func validateHex(label string, value string) error {
	if !strings.HasPrefix(value, "0x") {
		return fmt.Errorf("%s must be 0x-prefixed hex", label)
	}

	hexPayload := value[2:]
	if len(hexPayload)%2 != 0 {
		return fmt.Errorf("%s must have an even number of hex characters", label)
	}

	if _, err := hex.DecodeString(hexPayload); err != nil {
		return fmt.Errorf("%s must be valid hex: %w", label, err)
	}
	return nil
}
