package smoke

import (
	"strings"
	"testing"

	"cartographer-go-smoke/internal/rpccall"
)

type fakeRuntimeCaller struct {
	calls []rpccall.RuntimeCallEvidence
}

func (f fakeRuntimeCaller) CallRuntime(rpccall.Config) ([]rpccall.RuntimeCallEvidence, error) {
	return f.calls, nil
}

func TestRunBuildsEvidenceEnvelope(t *testing.T) {
	env := map[string]string{
		"CARTOGRAPHER_IT_RPC":     "wss://example.test",
		"CARTOGRAPHER_IT_ACCOUNT": "5Alice",
		"CARTOGRAPHER_IT_CALL":    "0x1234",
	}
	caller := fakeRuntimeCaller{
		calls: []rpccall.RuntimeCallEvidence{
			{
				Method: rpccall.DryRunCallMethod,
				Status: "blocked",
				Error:  "TODO(verify: SCALE args are not encoded)",
			},
		},
	}

	got, err := Run(env, caller)
	if err != nil {
		t.Fatalf("Run returned error: %v", err)
	}

	if got.Label != "call" {
		t.Fatalf("Label = %q, want call", got.Label)
	}
	if got.Input.Account != "5Alice" || got.Input.CallBytes != 2 || got.Input.ResultXCMVersion != 4 {
		t.Fatalf("unexpected input: %#v", got.Input)
	}
	if len(got.RuntimeCalls) != 1 || got.RuntimeCalls[0].Method != rpccall.DryRunCallMethod {
		t.Fatalf("unexpected runtime calls: %#v", got.RuntimeCalls)
	}
}

func TestRunRejectsInvalidCallHex(t *testing.T) {
	env := map[string]string{
		"CARTOGRAPHER_IT_RPC":     "wss://example.test",
		"CARTOGRAPHER_IT_ACCOUNT": "5Alice",
		"CARTOGRAPHER_IT_CALL":    "0x1",
	}

	_, err := Run(env, fakeRuntimeCaller{})
	if err == nil {
		t.Fatal("Run returned nil error")
	}
	if !strings.Contains(err.Error(), "complete bytes") {
		t.Fatalf("Run error = %q, want complete bytes", err.Error())
	}
}
