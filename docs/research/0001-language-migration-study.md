# Language Migration Study: TypeScript vs Go vs Rust

- Date: 2026-06-28
- Status: Study, not an ADR
- Scope: Cartographer MVP/V2/V3 language and client stack

Post-commit note, 2026-06-29: the previous `spikes/go-runtime-api-smoke`
workspace has been removed from the main tree. Treat this study as the migration
decision framework; recreate a bounded spike only after the TypeScript/PAPI live
evidence contract is frozen.

## Executive Summary

Cartographer could be built in Go or Rust, but the best near-term product path is
to keep the current TypeScript/PAPI implementation through the live MVP proof and
only revisit migration after the runtime API shapes are captured.

If we migrate later:

1. **Rust + subxt** is the strongest full rewrite candidate technically.
2. **Go** is the strongest owner-productivity candidate, but the weakest protocol
   client fit for XCM runtime APIs unless a spike proves the required calls and
   SCALE decoding are reliable.
3. **Hybrid Go core + TypeScript PAPI sidecar** is viable as a transition, but it
   adds process/protocol complexity and should not be the first move.

Recommendation: keep TypeScript now, run a bounded Go spike, and decide from
evidence. Do not rewrite before the live PAPI harness has captured real
`DryRunApi` and `XcmPaymentApi` payloads.

## Current Project Constraints

The current ADRs define Cartographer as a read-only XCM dry-run and diagnosis CLI:

- `DryRunApi.dry_run_call` / `dry_run_xcm` are the central execution primitives.
- `XcmPaymentApi` provides weight, acceptable payment assets, fee conversion, and
  delivery fees.
- `client/` is the only I/O layer.
- `diagnostics/` and `report/` are pure and should be easy to port.
- V3 expects Chopsticks real-state forks.

Current implementation size is small enough that migration is possible:

- `src/**/*.ts`: 3,223 lines.
- Pure/value layers (`types`, `diagnostics`, `report`) are the easiest to port.
- Hard part is not the CLI or diagnosis logic; it is runtime API invocation and
  decoded XCM shape fidelity.

## Source Snapshot

Context7 was attempted first for library docs and failed with:

```text
Invalid or expired OAuth token. Please re-authenticate to obtain a new token.
```

Fallback sources checked:

- Polkadot XCM fee estimation docs use `polkadot-api`, generated descriptors,
  `DryRunApi.dry_run_xcm`, and `XcmPaymentApi` in TypeScript:
  https://docs.polkadot.com/chain-interactions/send-transactions/interoperability/estimate-xcm-fees/
- PAPI docs expose runtime calls under `typedApi.apis`:
  https://papi.how/typed/apis/
- PAPI codegen downloads metadata and generates descriptors containing runtime
  calls, consumed by `getTypedApi()` or `getUnsafeApi()`:
  https://papi.how/codegen/
- Polkadot SDK rustdoc confirms the `DryRunApi` and `XcmPaymentApi` signatures:
  https://paritytech.github.io/polkadot-sdk/master/xcm_runtime_apis/dry_run/trait.DryRunApi.html
  https://paritytech.github.io/polkadot-sdk/master/xcm_runtime_apis/fees/trait.XcmPaymentApi.html
- Subxt docs state it supports runtime API access and type-safe interfaces from
  metadata:
  https://docs.polkadot.com/reference/tools/subxt/
  https://docs.rs/subxt/latest/subxt/
- Go Substrate RPC Client (GSRPC) describes itself as a Go client for
  Substrate/Polkadot RPC, but its docs emphasize manual SCALE type work and warn
  to use it cautiously in production:
  https://pkg.go.dev/github.com/centrifuge/go-substrate-rpc-client/v4
  https://github.com/centrifuge/go-substrate-rpc-client
- Chopsticks is Node/TypeScript tooling for local chain forking, block replay,
  XCM testing, and storage manipulation:
  https://docs.polkadot.com/reference/tools/chopsticks/

## Option A: Stay TypeScript + PAPI

### Strengths

- Best alignment with current official XCM examples. The Polkadot XCM fee
  estimation guide is TypeScript/PAPI and directly calls the runtime APIs
  Cartographer needs.
- PAPI descriptors are built specifically around runtime metadata and generated
  chain types.
- Chopsticks is Node-based, so V3 integrates in-process or at least within the
  same ecosystem.
- Current Sprint 0 is already scaffolded, tested, and boundary-checked.

### Weaknesses

- You are stronger in Go than TypeScript, so owner velocity may be lower.
- Runtime type safety depends on generated descriptors and metadata refresh.
- The current unsafe PAPI path still needs live payload shape proof.

### Migration Risk

Lowest, because this is not a migration. The right next work is live proof:
capture 5-10 real dry-run outputs and close the `TODO(verify:)` shape gaps.

## Option B: Rewrite in Rust + subxt

### Strengths

- Strongest protocol-native option.
- Subxt has first-class Rust support for metadata-generated, type-safe chain
  interfaces and runtime APIs.
- XCM and runtime API source types are Rust-native, reducing conceptual distance
  from Polkadot SDK rustdoc.
- Good long-term correctness story if we want a single statically typed binary.

### Weaknesses

- Higher rewrite cost and slower iteration unless the maintainer is comfortable
  with async Rust, SCALE types, metadata generation, and subxt conventions.
- Chopsticks would still likely be an external Node process for V3, unless we
  drop or defer that integration.
- The product value layer is diagnosis UX, not CPU-bound execution; Rust does
  not buy much performance for the MVP.

### Migration Risk

Medium-high. Technically feasible, but it should start with a Rust client spike:

1. Generate metadata for one API-capable system chain.
2. Call `DryRunApi.dry_run_call`.
3. Call `XcmPaymentApi.query_xcm_weight`,
   `query_acceptable_payment_assets`, and `query_weight_to_asset_fee`.
4. Normalize the output into the current Cartographer domain model.
5. Compare against the TypeScript live evidence JSON.

If this spike passes, a Rust rewrite becomes credible.

## Option C: Rewrite in Go

### Strengths

- Best fit for your personal expertise and likely day-to-day maintainability.
- Excellent CLI ergonomics and operational simplicity: one static-ish binary,
  simple tests, familiar tooling.
- Pure layers (`types`, `diagnostics`, `report`, CLI formatting) would port well.

### Weaknesses

- Weakest ecosystem fit for the specific hard problem: typed XCM runtime APIs.
- GSRPC provides Substrate RPC and SCALE primitives, but custom/runtime-specific
  enums, tuples, and vectors require manual type definitions and encoding/
  decoding discipline.
- The GSRPC README still advises caution for production usage, and the issue
  tracker shows active decoding/signing/runtime compatibility friction.
- No direct equivalent to PAPI descriptors or subxt generated Rust interfaces for
  the exact `DryRunApi` / `XcmPaymentApi` path was verified in this study.

### Migration Risk

High for the client layer, low for the pure product layer. Go is attractive only
if a spike proves the hard runtime API path with real payloads.

Required Go spike:

1. Connect to an API-capable system chain.
2. Encode the runtime call payload for `DryRunApi.dry_run_call`.
3. Decode `CallDryRunEffects<Event>` including `execution_result`,
   `emitted_events`, `local_xcm`, and `forwarded_xcms`.
4. Call/decode the needed `XcmPaymentApi` methods.
5. Emit the same JSON evidence shape as `src/client/live-evidence.ts`.
6. Confirm no hand-written type work becomes a maintenance trap.

If the Go spike cannot decode these shapes cleanly, do not migrate the client to
Go.

## Option D: Go Core + TypeScript PAPI Sidecar

This is a compromise if Go ownership matters but PAPI remains the only proven
runtime API surface.

Shape:

```text
cartographer-go CLI/core
  -> invokes cartographer-papi sidecar over stdio/JSON
  -> sidecar calls PAPI and returns normalized domain models
  -> Go owns diagnostics/report/orchestration
```

### Pros

- Lets the maintainer work mostly in Go.
- Keeps PAPI for the riskiest protocol boundary.
- Avoids rewriting the runtime API client before evidence exists.

### Cons

- Two build systems and a JSON-RPC/stdio contract.
- Harder packaging.
- New failure mode: sidecar version skew.
- Not worth it until the product has enough value to justify operational
  complexity.

## Decision Matrix

Scores: 5 = best, 1 = worst.

| Criterion | TS + PAPI | Rust + subxt | Go + GSRPC/custom | Go core + TS sidecar |
|---|---:|---:|---:|---:|
| Runtime API fit | 5 | 4 | 2 | 5 |
| XCM type fidelity | 5 | 5 | 2 | 5 |
| Chopsticks/V3 fit | 5 | 2 | 2 | 4 |
| Maintainer velocity for you | 3 | 2 | 5 | 4 |
| Packaging simplicity | 3 | 5 | 5 | 2 |
| Migration cost from current repo | 5 | 2 | 3 | 3 |
| Long-term protocol credibility | 3 | 5 | 3 | 3 |
| Overall near-term product fit | 5 | 4 | 3 | 3 |

## Recommendation

Do not migrate yet.

The best solution for Cartographer right now is:

1. Finish the TypeScript/PAPI live proof.
2. Capture real `DryRunApi` / `XcmPaymentApi` payloads.
3. Freeze the domain JSON contract from those captures.
4. Run a Go spike against that frozen contract.
5. Decide based on evidence.

Given your Go strength, the most pragmatic migration path is not "rewrite all in
Go now"; it is "prove the Go client layer can match PAPI on real runtime API
payloads". If it can, Go becomes the best owner-fit language. If it cannot,
keep PAPI and only consider a Go sidecar/core split later.

Rust is the best technical rewrite candidate if protocol-native correctness is
the deciding factor. Go is the best maintainer-productivity candidate if the
runtime API spike succeeds. TypeScript remains the best current implementation
choice because the official XCM examples, PAPI descriptors, and Chopsticks all
line up with the current roadmap.

## Proposed Next Step

Add a short migration spike milestone before any ADR change. Because no active
spike workspace is kept in the main tree, create it as a fresh bounded artifact
when this milestone starts:

```text
M0.7 Language viability spike
- Keep current TS implementation unchanged.
- Add a separate /spikes/go-runtime-api-smoke or /spikes/rust-subxt-smoke.
- Use the same live endpoint/call env values as test:it.
- Produce evidence JSON matching src/client/live-evidence.ts.
- Decision gate:
  - If Go/Rust output matches TypeScript evidence and gates are maintainable,
    draft ADR-0004 to migrate or split.
  - If not, keep ADR-0002 and continue TypeScript/PAPI.
```

Success criteria for Go:

- Calls `DryRunApi.dry_run_call` against a live API-capable chain.
- Calls at least three required `XcmPaymentApi` methods.
- Decodes `local_xcm`, `forwarded_xcms`, and `emitted_events` without lossy
  string-only fallback.
- Produces the current `DryRunEffects` and `FeeEstimate` shapes.
- Has unit tests for decoding and one opt-in live integration test.

Success criteria for Rust:

- Same as Go, but using subxt metadata/codegen or dynamic runtime API support.
- Must show the build, generated metadata handling, and binary packaging story.

## ADR Impact

Do not replace ADR-0002 yet. Add an ADR only after one spike passes:

- ADR-0004A: "Keep TypeScript/PAPI after migration spike."
- ADR-0004B: "Migrate client/core to Go."
- ADR-0004C: "Migrate to Rust/subxt."
- ADR-0004D: "Adopt Go core with TypeScript PAPI sidecar."
