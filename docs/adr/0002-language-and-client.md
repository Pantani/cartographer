# ADR-0002 — Language & Client

- Status: Accepted
- Date: 2026-06-27
- Deciders: project owner

## Context

Cartographer is orchestration + UX over runtime APIs, not runtime code. The
language choice should minimize friction with the XCM tooling surface, not
maximize protocol-native credibility.

## Decision

**TypeScript, with PAPI (`polkadot-api`) as the chain client.** Package manager:
pnpm. Node LTS.

## Rationale

- **Official dry-run examples are in PAPI.** The documented path for calling
  `DryRunApi` / `XcmPaymentApi` uses `polkadot-api` with generated descriptors.
  Building on the same client the docs use lowers risk and keeps us aligned with
  upstream changes.
- **Chopsticks (the V3 fork engine) is TypeScript/Node.** Choosing TS means the
  fork engine integrates in-process, with no FFI or subprocess bridge.
- **subxt (the Rust client) was reported unstable for production** by an
  experienced builder. Even discounting one report, the V2/V3 integration cost
  with Chopsticks tilts the decision toward TS regardless.
- **The workload is I/O-bound.** This is RPC orchestration; there is no CPU hot
  path where Rust's performance would matter. Profile-first says don't pay the
  integration tax for a speed we don't need.

## Trade-offs (stated directly)

- **Less protocol-native signal than Rust.** A Rust tool reads as "deeper" in
  this ecosystem. Accepted: the value is in diagnosis quality and multi-hop UX,
  which are language-agnostic, and the portfolio story is "IBC veteran who fixed
  XCM DX", not "wrote Rust".
- **Type fidelity depends on PAPI descriptors.** Versioned XCM types (V3/V4/V5)
  come from generated descriptors; a chain/runtime upgrade can shift them. We pin
  descriptor generation per target chain and treat regeneration as a maintenance
  task (tracked, not ad hoc).
- **Two languages in the mental model.** Contributors read Rust (the runtime API
  definitions) but write TS. Mitigated by pinning the Rust signatures in
  ADR-0001 so TS authors don't need to chase the source each time.

## Consequences

- `client/` wraps PAPI; no other module imports PAPI types directly — they
  consume our own `types/` domain model, so a PAPI breaking change is contained
  to one module.
- Descriptor generation is a build prerequisite, documented in the README and
  scripted in `package.json`.

## Revisit if

- PAPI cannot express a needed runtime-API call, or
- a Rust path (subxt/smoldot) becomes clearly more stable AND we drop the
  Chopsticks dependency.
