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

Pre-MVP. See [`ROADMAP.md`](./ROADMAP.md). Building the MVP (single-hop, readable
diagnosis, fee estimate) first; V2 adds multi-hop chaining.

Current Sprint-0 runnable CLI surface is single-hop `--call` tracing only. The
`--xcm` flag is intentionally guarded and rejected until the raw-XCM
`dryRunXcm` path, JSON input validation, and runtime API call shape are verified.

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

## Integration test handoff

These tests hit live RPC only when real env values are supplied. A passing
no-env run is harness proof, not live product proof. See
[`docs/usage.md`](./docs/usage.md#live-integration-inputs) for the full env
contract.

```bash
rtk proxy pnpm test:it
```

## License

TBD before first publish — likely Apache-2.0 or MIT (permissive, so the tool can
later be packaged as a Pop CLI plugin without copyleft friction). Decide in
ADR-0004 before any third-party code is vendored.
