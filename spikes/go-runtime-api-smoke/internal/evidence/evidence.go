package evidence

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

// Input records the user-provided smoke inputs after pure normalization.
type Input struct {
	Account          string `json:"account"`
	CallBytes        int    `json:"callBytes"`
	ResultXCMVersion int    `json:"resultXcmVersion"`
}

// RuntimeCallEvidence records one runtime API attempt without doing network I/O.
type RuntimeCallEvidence struct {
	Method string `json:"method"`
	Status string `json:"status"`
	RawHex string `json:"rawHex,omitempty"`
	Error  string `json:"error,omitempty"`
}

// Envelope is the stable JSON evidence shape emitted by the Go smoke spike.
type Envelope struct {
	Label        string                `json:"label"`
	Input        Input                 `json:"input"`
	RuntimeCalls []RuntimeCallEvidence `json:"runtimeCalls"`
}

// CallBytes returns the complete byte count for a 0x-prefixed hex call.
func CallBytes(call string) (int, error) {
	if !strings.HasPrefix(call, "0x") {
		return 0, fmt.Errorf("call must be 0x-prefixed")
	}

	raw := strings.TrimPrefix(call, "0x")
	if len(raw) == 0 || len(raw)%2 != 0 {
		return 0, fmt.Errorf("call must contain complete bytes")
	}
	if _, err := hex.DecodeString(raw); err != nil {
		return 0, fmt.Errorf("call must be hex: %w", err)
	}

	return len(raw) / 2, nil
}

// RenderJSON returns stable indented JSON for the evidence envelope.
func RenderJSON(value Envelope) (string, error) {
	out, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", err
	}

	return string(out), nil
}
