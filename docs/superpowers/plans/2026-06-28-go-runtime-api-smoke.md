# Go Runtime API Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an isolated Go spike that tests whether Go can become a viable Cartographer client/runtime-API stack.

**Architecture:** The spike lives under `spikes/go-runtime-api-smoke/` and does not modify `src/`. It has a small CLI, a pure evidence package, and a runtime/RPC package that can be unit-tested without live network while keeping live calls behind explicit env vars.

**Tech Stack:** Go 1.26, Go standard library, optional Go Substrate RPC Client (`github.com/centrifuge/go-substrate-rpc-client/v4`) only if the runtime API path proves useful, JSON evidence compatible with the TypeScript `CARTOGRAPHER_IT_EVIDENCE` envelope.

---

## File Structure

- Create `spikes/go-runtime-api-smoke/go.mod`
  - Isolated Go module for the spike.
- Create `spikes/go-runtime-api-smoke/README.md`
  - How to run unit tests, how to run live smoke, what success/failure means.
- Create `spikes/go-runtime-api-smoke/cmd/cartographer-go-smoke/main.go`
  - CLI entrypoint that reads env vars, calls the smoke runner, prints JSON.
- Create `spikes/go-runtime-api-smoke/internal/evidence/evidence.go`
  - Pure evidence envelope types and JSON rendering.
- Create `spikes/go-runtime-api-smoke/internal/evidence/evidence_test.go`
  - Unit tests for call byte counting, missing env reporting, bigint-safe JSON substitutes.
- Create `spikes/go-runtime-api-smoke/internal/rpccall/runtime.go`
  - Runtime API smoke interface, env parsing, method names, guarded live execution.
- Create `spikes/go-runtime-api-smoke/internal/rpccall/runtime_test.go`
  - Unit tests for env parsing, method names, and no-live-input behavior.
- Create `spikes/go-runtime-api-smoke/internal/smoke/smoke.go`
  - Coordinates env -> runtime call -> evidence.
- Create `spikes/go-runtime-api-smoke/internal/smoke/smoke_test.go`
  - Unit test using a fake runtime caller.
- Create `_workspace/09_go_runtime_api_spike_report.md`
  - Final report with status, commands, and migration decision signal.

## Task 1: Evidence Package

**Files:**
- Create: `spikes/go-runtime-api-smoke/internal/evidence/evidence.go`
- Test: `spikes/go-runtime-api-smoke/internal/evidence/evidence_test.go`

- [ ] **Step 1: Write the failing tests**

```go
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
	for _, input := range []string{"1234", "0x1", "0xzz"} {
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
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd spikes/go-runtime-api-smoke
go test ./internal/evidence
```

Expected: FAIL because package/functions do not exist.

- [ ] **Step 3: Implement minimal evidence package**

Implement:

```go
package evidence

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
)

type Input struct {
	Account          string `json:"account"`
	CallBytes        int    `json:"callBytes"`
	ResultXCMVersion int    `json:"resultXcmVersion"`
}

type RuntimeCallEvidence struct {
	Method string `json:"method"`
	Status string `json:"status"`
	RawHex string `json:"rawHex,omitempty"`
	Error  string `json:"error,omitempty"`
}

type Envelope struct {
	Label        string                `json:"label"`
	Input        Input                 `json:"input"`
	RuntimeCalls []RuntimeCallEvidence `json:"runtimeCalls"`
}

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

func RenderJSON(value Envelope) (string, error) {
	out, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out), nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd spikes/go-runtime-api-smoke
go test ./internal/evidence
```

Expected: PASS.

## Task 2: Runtime Call Package

**Files:**
- Create: `spikes/go-runtime-api-smoke/internal/rpccall/runtime.go`
- Test: `spikes/go-runtime-api-smoke/internal/rpccall/runtime_test.go`

- [ ] **Step 1: Write failing tests**

```go
package rpccall

import "testing"

func TestConfigFromEnvRequiresCoreInputs(t *testing.T) {
	_, err := ConfigFromEnv(map[string]string{})
	if err == nil {
		t.Fatal("ConfigFromEnv returned nil error")
	}
}

func TestConfigFromEnvParsesInputs(t *testing.T) {
	cfg, err := ConfigFromEnv(map[string]string{
		"CARTOGRAPHER_IT_RPC":     "wss://example.test",
		"CARTOGRAPHER_IT_ACCOUNT": "5Alice",
		"CARTOGRAPHER_IT_CALL":    "0x1234",
	})
	if err != nil {
		t.Fatalf("ConfigFromEnv returned error: %v", err)
	}
	if cfg.RPC != "wss://example.test" || cfg.Account != "5Alice" || cfg.CallHex != "0x1234" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
	if cfg.ResultXCMVersion != 4 {
		t.Fatalf("ResultXCMVersion = %d, want 4", cfg.ResultXCMVersion)
	}
}

func TestRuntimeAPIMethodNames(t *testing.T) {
	if DryRunCallMethod != "DryRunApi_dry_run_call" {
		t.Fatalf("unexpected dry-run method: %s", DryRunCallMethod)
	}
	if QueryXCMWeightMethod != "XcmPaymentApi_query_xcm_weight" {
		t.Fatalf("unexpected weight method: %s", QueryXCMWeightMethod)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd spikes/go-runtime-api-smoke
go test ./internal/rpccall
```

Expected: FAIL because package/functions do not exist.

- [ ] **Step 3: Implement env/method contract**

Implement config parsing and constants. The live runtime function may return a
clear `TODO(verify:)` blocked result until SCALE argument encoding is proven.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd spikes/go-runtime-api-smoke
go test ./internal/rpccall
```

Expected: PASS.

## Task 3: Smoke Coordinator and CLI

**Files:**
- Create: `spikes/go-runtime-api-smoke/go.mod`
- Create: `spikes/go-runtime-api-smoke/internal/smoke/smoke.go`
- Test: `spikes/go-runtime-api-smoke/internal/smoke/smoke_test.go`
- Create: `spikes/go-runtime-api-smoke/cmd/cartographer-go-smoke/main.go`

- [ ] **Step 1: Write coordinator test**

The test uses a fake runtime caller and asserts the output envelope contains the
input summary and runtime method evidence.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd spikes/go-runtime-api-smoke
go test ./internal/smoke
```

Expected: FAIL before implementation.

- [ ] **Step 3: Implement coordinator and CLI**

The CLI reads process env, calls the coordinator, prints JSON, and exits non-zero
on invalid env.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd spikes/go-runtime-api-smoke
go test ./...
```

Expected: PASS.

## Task 4: Docs and Report

**Files:**
- Create: `spikes/go-runtime-api-smoke/README.md`
- Create: `_workspace/09_go_runtime_api_spike_report.md`

- [ ] **Step 1: Document commands**

Include:

```bash
cd spikes/go-runtime-api-smoke
go test ./...
go run ./cmd/cartographer-go-smoke
CARTOGRAPHER_IT_RPC='wss://...' CARTOGRAPHER_IT_ACCOUNT='5...' CARTOGRAPHER_IT_CALL='0x...' go run ./cmd/cartographer-go-smoke
```

- [ ] **Step 2: Document decision meaning**

State that this spike is accepted only as scaffolding until a live runtime API
call returns real decoded `DryRunApi`/`XcmPaymentApi` evidence.

- [ ] **Step 3: Write report**

Include status, files changed, commands run, source docs, and remaining
`TODO(verify:)` items.

## Final Verification

Run:

```bash
cd spikes/go-runtime-api-smoke && go test ./...
rtk proxy pnpm lint
rtk proxy pnpm typecheck
rtk proxy pnpm depcheck
rtk proxy pnpm test
```

Expected:

- Go tests pass.
- Existing TypeScript gates still pass.
- No `src/` production behavior changes.
