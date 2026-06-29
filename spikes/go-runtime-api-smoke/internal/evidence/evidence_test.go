package evidence

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCallBytesCountsCompleteHexBytes(t *testing.T) {
	got, err := CallBytes("0x1234")
	if err != nil {
		t.Fatalf("CallBytes returned error: %v", err)
	}
	if got != 2 {
		t.Fatalf("CallBytes() = %d, want 2", got)
	}
}

func TestCallBytesRejectsInvalidHex(t *testing.T) {
	tests := []string{"1234", "0x1", "0xzz"}
	for _, input := range tests {
		if _, err := CallBytes(input); err == nil {
			t.Fatalf("CallBytes(%q) returned nil error", input)
		}
	}
}

func TestEnvelopeRendersStableJSON(t *testing.T) {
	env := Envelope{
		Label: "call",
		Input: Input{
			Account:          "5Alice",
			CallBytes:        2,
			ResultXCMVersion: 4,
		},
		RuntimeCalls: []RuntimeCallEvidence{
			{Method: "DryRunApi_dry_run_call", Status: "blocked", Error: "TODO(verify): SCALE args not encoded"},
		},
	}

	out, err := RenderJSON(env)
	if err != nil {
		t.Fatalf("RenderJSON returned error: %v", err)
	}
	if !json.Valid([]byte(out)) {
		t.Fatalf("RenderJSON returned invalid JSON: %s", out)
	}
	if !strings.Contains(out, "DryRunApi_dry_run_call") {
		t.Fatalf("RenderJSON missing runtime method: %s", out)
	}

	want := `{
  "label": "call",
  "input": {
    "account": "5Alice",
    "callBytes": 2,
    "resultXcmVersion": 4
  },
  "runtimeCalls": [
    {
      "method": "DryRunApi_dry_run_call",
      "status": "blocked",
      "error": "TODO(verify): SCALE args not encoded"
    }
  ]
}`
	if out != want {
		t.Fatalf("RenderJSON() = %s, want %s", out, want)
	}
}
