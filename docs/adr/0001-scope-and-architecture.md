# ADR-0001 — Scope & Architecture

- Status: Accepted
- Date: 2026-06-27
- Deciders: project owner

## Context

XCM debugging is painful because a message is a program executed on a remote
VM, and the feedback surface is raw. Simulation primitives exist
(`DryRunApi`, `XcmPaymentApi`, Chopsticks) but there is no tool that (a) follows
a message across hops automatically and (b) translates a raw failure into a root
cause. Cartographer fills exactly that gap.

This ADR fixes the scope and the high-level architecture so that subsequent work
has stable boundaries.

## Decision

### Scope boundary

In scope:
- Dry-run an extrinsic or a raw XCM program against a live chain via runtime APIs.
- Estimate fees/weight for the resulting XCM.
- Translate effects into a human-readable diagnosis (success or root cause).
- (V2) Follow `forwarded_xcms` across hops and produce an end-to-end trace.
- (V3) Real-state forks via Chopsticks; route visualization; XCM "recipes".
- Local/forked test harness commands that submit configured extrinsics only to
  Chopsticks endpoints for evidence capture.

Out of scope (explicit non-goals):
- Re-implementing the XCVM or any execution semantics.
- Asset-transfer SDK / dApp message composition (ParaSpell, Moonbeam own this).
- Public network broadcast. Cartographer's product CLI remains dry-run /
  simulation-oriented; local harness submissions are limited to forked
  Chopsticks endpoints and must not be confused with public-chain state changes.

### Pinned runtime API surface (sources of record)

These are the primitives Cartographer orchestrates. **Verify against the pinned
polkadot-sdk version before implementing; update this ADR if reality differs.**

`xcm_runtime_apis::dry_run::DryRunApi`:

```rust
fn dry_run_call(
    origin: OriginCaller,
    call: Call,
    result_xcms_version: XcmVersion,
) -> Result<CallDryRunEffects<Event>, Error>;

fn dry_run_xcm(
    origin_location: VersionedLocation,
    xcm: VersionedXcm<Call>,
) -> Result<XcmDryRunEffects<Event>, Error>;
```

`CallDryRunEffects` carries: `execution_result`, `emitted_events`, `local_xcm`,
and `forwarded_xcms: Vec<(VersionedLocation, Vec<VersionedXcm<()>>)>` — the queued
messages to other chains. This vector is what V2 follows.

`xcm_runtime_apis::fees::XcmPaymentApi`: given an XCM program, returns the fees
required to execute or send it. Pairs with the dry-run output.

Caveat of record: **not every chain implements these APIs.** System parachains
and the main testnets do; some networks added them only later. Cartographer
targets API-capable chains first and degrades gracefully where absent (see
ADR-0002 on the Chopsticks fallback).

### Architecture (layers)

```
cli  →  orchestrator  →  client  →  (RPC / runtime APIs)
            │   │
            │   └────────→  diagnostics   (pure)
            └────────────→  report        (pure)
registry  (V2: location → endpoint)      types  (leaf, imports nothing)
```

- `cli` — entrypoint, arg parsing, command wiring. Depended on by nothing.
- `orchestrator` — the trace engine. Drives the dry-run, collects effects,
  invokes diagnostics and report. In V2, owns hop chaining.
- `client` — the **only** module allowed to do network I/O. Typed wrapper over
  `DryRunApi` + `XcmPaymentApi`.
- `diagnostics` — pure. Maps effects → `Diagnosis`. No network. (See ADR-0003.)
- `report` — pure. Formats a `TraceResult` to human text or JSON.
- `registry` — (V2) resolves a `Location` to an RPC endpoint + caches metadata.
- `types` — shared domain types. Imports nothing.

Rationale for keeping `diagnostics` and `report` pure: they hold the product's
real value (the readable explanations and output), they change most often, and
purity makes them unit-testable from fixtures with zero network flakiness.

### MVP data flow (single hop)

1. `cli` parses origin chain RPC, origin caller, and the call (or raw XCM).
2. `orchestrator.trace()`:
   - `client.dryRunCall(origin, call)` → effects.
   - `client.estimateFees(localXcm)` via `XcmPaymentApi`.
   - `diagnostics.diagnose(effects)` → `Diagnosis`.
   - assemble `TraceResult { hops: [singleHop], diagnosis, fees }`.
3. `report.render(result, format)`.

## Consequences

- Multi-hop is deferred to V2 but the `TraceResult` shape is hop-list-shaped from
  day one, so V2 is additive, not a rewrite.
- The hard dependency on runtime-API availability is an accepted constraint;
  mitigated by targeting system chains and the Chopsticks fallback.
- Product read-only scope removes an entire class of public-chain safety
  concerns. The local Chopsticks harness introduces signing only for dev/local
  fork evidence and must fail early for non-local endpoints.

## Alternatives considered

- **Rust + subxt instead of TS + PAPI.** Rejected in ADR-0002.
- **Wrap Chopsticks only (no direct runtime-API calls).** Rejected: too heavy a
  setup for the common "why did this fail" case; Chopsticks is the V3 fork engine,
  not the MVP path.
