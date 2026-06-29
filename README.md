# Cartographer

**An end-to-end trace explorer and debugger for XCM (Cross-Consensus Messaging).**

Cartographer takes an extrinsic or a raw XCM program, dry-runs it against live
runtime state, follows the message across every hop (relay → system parachain →
destination), and reports — in human language — what happened, what it cost, and
*why it failed* when it does.

It is the missing experience layer on top of primitives that already exist
(`DryRunApi`, `XcmPaymentApi`, Chopsticks). Think of those as
`debug_traceTransaction`; Cartographer is the readable trace explorer on top.

---

## The problem

XCM is not messaging — it is *remote execution*. A message is a program of
instructions (`WithdrawAsset`, `BuyExecution`, `DepositAsset`, `Transact`, …)
that the destination chain's virtual machine (XCVM) runs. When it fails, you are
debugging a program that executed on a VM whose state you cannot see, and the
feedback is raw SCALE structs and error enums, hop by hop.

The simulation primitives exist but stop short of a usable workflow:

- **`DryRunApi`** returns the effects of a single hop, including the list of
  `forwarded_xcms` queued to other chains — but it does **not** follow them.
- **`XcmPaymentApi`** estimates fees, but you orchestrate it by hand.
- **Chopsticks** can fork chains and replay XCM, but it is test infrastructure
  (WASM overrides, YAML, TS scripts), not a debug experience.
- **xcm-emulator / xcm-simulator** are Rust test kits, not interactive tools.

Nobody chains the hops automatically, and nobody translates the raw failure into
a root cause. That gap is Cartographer.

## What Cartographer does

1. **Chains the trace multi-hop automatically.** Reads `forwarded_xcms` from each
   hop, resolves the destination chain, dry-runs there, and repeats until the
   trace terminates. (V2 — the core differentiator.)
2. **Diagnoses failures in human language.** A data-driven rule engine maps raw
   effects to a root cause: barrier rejection, insufficient `BuyExecution`
   weight, trapped assets, untrusted reserve, XCM version mismatch.
3. **Shows the whole route in one place.** Per hop: executed instructions,
   holding-register state, weight/fee consumed, emitted events, verdict.

## What Cartographer is NOT

- Not a re-implementation of the XCVM. It orchestrates existing runtime APIs.
- Not an asset-transfer SDK (that is ParaSpell / Moonbeam XCM SDK).
- Not a generic chain explorer. It is scoped to the XCM execution lifecycle.

## Status

Pre-MVP. See [`ROADMAP.md`](./ROADMAP.md). Building the MVP (single-hop,
readable diagnosis, fee estimate) first; V2 adds multi-hop chaining.

Current Sprint-0 runnable CLI surface is single-hop `--call` tracing only. The
`--xcm` flag is intentionally guarded and rejected until the raw-XCM
`dryRunXcm` path, JSON input validation, and runtime API call shape are verified.
The repo now includes a local/forked Chopsticks XCM harness, the opt-in live RPC
dry-run harness, debug-flow proof, local Make shortcuts, a coverage gate, and CI
workflows for quality, workflow linting, and production dependency audit.

## Architecture

See [`docs/architecture.md`](./docs/architecture.md) for module boundaries,
layering, and the dependency rules enforced in CI.

Decisions of record:

- [ADR-0001 — Scope & Architecture](./docs/adr/0001-scope-and-architecture.md)
- [ADR-0002 — Language & Client](./docs/adr/0002-language-and-client.md)
- [ADR-0003 — Diagnostics Engine](./docs/adr/0003-diagnostics-engine.md)

## Quickstart (current Sprint-0 CLI surface)

```bash
pnpm install
pnpm build

# Single-hop call dry-run against an API-capable endpoint.
node dist/cli/index.js trace \
  --rpc wss://asset-hub-polkadot-rpc.example \
  --origin //Alice \
  --call '0x...' \
  --format human
```

Raw XCM input is planned but not runnable in Sprint 0:

```bash
node dist/cli/index.js trace --rpc wss://... --origin //Alice --xcm ./program.json
# cartographer: Raw XCM input (--xcm) is not supported in this build; pass --call.
```

For the complete user workflow, output formats, coverage gate, and live
integration env vars, see [`docs/usage.md`](./docs/usage.md).

## Local XCM workflow

The top-level `infra:*` and `xcm:*` commands target a local/forked Chopsticks
topology, not public network broadcast:

```bash
make infra-up
make infra-status

# Provide a verified SCALE call for the origin local endpoint.
CARTOGRAPHER_LOCAL_CALL='0x...' make xcm-send

make xcm-test
make xcm-cli
make infra-down
```

Defaults use `infra/chopsticks/westend.yml`,
`infra/chopsticks/westend-asset-hub.yml`, and
`infra/chopsticks/westend-people.yml`, exposed at `ws://127.0.0.1:8002`,
`ws://127.0.0.1:8000`, and `ws://127.0.0.1:8001` respectively.

`xcm-send` signs and submits the configured call to the local origin fork with a
dev signer. It refuses non-local endpoints and fails early when
`CARTOGRAPHER_LOCAL_CALL` is missing. Runtime API dry-runs remain separate.

## Local gates

Run the same local quality chain before handing off a change:

```bash
pnpm run check
# or
make check
```

This runs lint and complexity gates, typecheck, unit tests, coverage, dependency
boundaries, and the production build.

## Live dry-run handoff

These tests hit live RPC only when real env values are supplied. A passing
no-env run is harness proof, not live product proof. See
[`docs/usage.md`](./docs/usage.md#live-integration-inputs) for the full env
contract.

```bash
pnpm test:it
pnpm test:debug-flow
pnpm run live:xcm:test
pnpm run live:xcm:cli
pnpm run test:live
```

`.env.example` lists the required variables. Export real values before using the
`live:*` and `test:live` scripts; those scripts fail fast when required live
inputs are missing or still set to the example placeholders. The non-`live:*`
`xcm:*` scripts use local Chopsticks endpoints.

## CI

`.github/workflows/ci.yml` runs the quality gate on Node 20.x and 22.x, checks
the coverage threshold, lints workflow files with `actionlint`, and rolls those
jobs up through `CI Success`. `.github/workflows/dependency-audit.yml` runs a
production `pnpm audit --prod --audit-level moderate` on dependency changes,
weekly schedule, and manual dispatch.

## License

TBD before first publish — likely Apache-2.0 or MIT (permissive, so the tool can
later be packaged as a Pop CLI plugin without copyleft friction). Decide in
ADR-0004 before any third-party code is vendored.
