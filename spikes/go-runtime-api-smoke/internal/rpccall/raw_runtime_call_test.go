package rpccall

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	gsrpcclient "github.com/centrifuge/go-substrate-rpc-client/v4/client"
)

var _ StateCallClient = (gsrpcclient.Client)(nil)

type recordingStateCallClient struct {
	method string
	args   []interface{}
	result string
	err    error
}

func (c *recordingStateCallClient) CallContext(
	_ context.Context,
	result interface{},
	method string,
	args ...interface{},
) error {
	c.method = method
	c.args = append([]interface{}{}, args...)
	if c.err != nil {
		return c.err
	}
	target, ok := result.(*string)
	if !ok {
		return errors.New("result must be *string")
	}
	*target = c.result
	return nil
}

func TestCallRawRuntimeUsesStateCall(t *testing.T) {
	client := &recordingStateCallClient{result: "0xabcdef"}
	call := RawRuntimeCall{
		Method:  DryRunCallMethod,
		ArgsHex: "0x0102",
	}

	got, err := CallRawRuntime(context.Background(), client, call)
	if err != nil {
		t.Fatalf("CallRawRuntime returned error: %v", err)
	}

	if client.method != StateCallRPCMethod {
		t.Fatalf("JSON-RPC method = %q, want %q", client.method, StateCallRPCMethod)
	}
	if want := []interface{}{DryRunCallMethod, "0x0102"}; !reflect.DeepEqual(client.args, want) {
		t.Fatalf("JSON-RPC args = %#v, want %#v", client.args, want)
	}
	if got.Method != DryRunCallMethod || got.Status != "ok" || got.RawHex != "0xabcdef" {
		t.Fatalf("unexpected evidence: %#v", got)
	}
}

func TestCallRawRuntimeRejectsInvalidInputsBeforeRPC(t *testing.T) {
	tests := []struct {
		name string
		call RawRuntimeCall
		want string
	}{
		{
			name: "empty method",
			call: RawRuntimeCall{Method: "", ArgsHex: "0x00"},
			want: "method",
		},
		{
			name: "missing hex prefix",
			call: RawRuntimeCall{Method: DryRunCallMethod, ArgsHex: "0102"},
			want: "0x",
		},
		{
			name: "odd length hex",
			call: RawRuntimeCall{Method: DryRunCallMethod, ArgsHex: "0x123"},
			want: "even",
		},
		{
			name: "non hex",
			call: RawRuntimeCall{Method: DryRunCallMethod, ArgsHex: "0xzz"},
			want: "hex",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			client := &recordingStateCallClient{result: "0x00"}
			_, err := CallRawRuntime(context.Background(), client, tt.call)
			if err == nil {
				t.Fatal("CallRawRuntime returned nil error")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("CallRawRuntime error = %q, want substring %q", err, tt.want)
			}
			if client.method != "" {
				t.Fatalf("CallRawRuntime reached RPC method %q for invalid input", client.method)
			}
		})
	}
}

func TestCallRawRuntimeRejectsInvalidRawResult(t *testing.T) {
	client := &recordingStateCallClient{result: "not-hex"}

	_, err := CallRawRuntime(context.Background(), client, RawRuntimeCall{
		Method:  DryRunCallMethod,
		ArgsHex: "0x00",
	})
	if err == nil {
		t.Fatal("CallRawRuntime returned nil error")
	}
	if !strings.Contains(err.Error(), "raw result") {
		t.Fatalf("CallRawRuntime error = %q, want raw result context", err)
	}
}

func TestCallRawRuntimePropagatesRPCError(t *testing.T) {
	client := &recordingStateCallClient{err: errors.New("rpc failed")}

	_, err := CallRawRuntime(context.Background(), client, RawRuntimeCall{
		Method:  DryRunCallMethod,
		ArgsHex: "0x00",
	})
	if err == nil {
		t.Fatal("CallRawRuntime returned nil error")
	}
	if !strings.Contains(err.Error(), "state_call") || !strings.Contains(err.Error(), "rpc failed") {
		t.Fatalf("CallRawRuntime error = %q, want state_call and original error", err)
	}
}
