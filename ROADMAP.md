# Roadmap

Sliced to de-risk the hard part (multi-hop) by proving the value layer
(diagnosis) on a single hop first. Each milestone is shippable on its own.

## MVP — single-hop, readable

Goal: point at a chain + a call, get a verdict — succeed/fail, fee, and *why* on
failure — in human language. No Chopsticks, no hop chaining.

- M0.1 Project scaffold: TS, pnpm, ESLint (`complexity: 10`), tsconfig strict,
  dependency-cruiser wired into CI. (See Sprint 0.)
- M0.2 `client/`: PAPI connection + `dryRunCall` and `estimateFees` wrappers,
  normalizing PAPI output into `types/` domain models.
- M0.3 `diagnostics/`: rule engine + the seed rule set (ADR-0003), with fixtures.
- M0.4 `report/`: human and JSON renderers for a single-hop `TraceResult`.
- M0.5 `cli/`: `cartographer trace --rpc --origin --call --format`; keep
  `--xcm` rejected until `dryRunXcm` and raw XCM input validation are verified.
- M0.6 Integration test against a live API-capable system chain (opt-in),
  covering `--call` only until raw XCM support is built. Env contract:
  client-only smoke uses `CARTOGRAPHER_IT_RPC`, `CARTOGRAPHER_IT_ACCOUNT`,
  `CARTOGRAPHER_IT_CALL`; full trace uses those first two plus
  `CARTOGRAPHER_IT_CALL_OK` and `CARTOGRAPHER_IT_CALL_FAIL`.

Exit criteria: a real failing reserve transfer produces a correct, human root
cause and a fee estimate, end to end.

## V2 — multi-hop chaining (the differentiator)

Goal: follow `forwarded_xcms` across hops automatically; produce an end-to-end
trace tree with a per-hop diagnosis.

- M1.1 `registry/`: `Location` → endpoint resolution + metadata cache.
- M1.2 `orchestrator/` hop loop (queue, `maxDepth`, cycle guard).
- M1.3 `report/`: render the hop tree (route view).
- M1.4 Fixtures for a known 2–3 hop route (relay → Asset Hub → parachain).

Exit criteria: a multi-hop transfer is traced to its terminal hop, with the
failing hop and cause identified when it breaks.

## V3 — real state, visualization, recipes

- M2.1 Chopsticks integration for real-state forks where dry-run alone is
  insufficient or the API is absent.
- M2.2 TUI/web route visualization.
- M2.3 XCM "recipes": correctly-scaffolded common programs (reserve transfer,
  teleport, remote `Transact`) — attacking the *authoring* pain, not just debug.

## Distribution (parallel track, non-blocking)

- Standalone first (own license, own pace).
- If/when a Pop CLI plugin mechanism exists, expose as `pop cartographer`. The
  permissive license (ADR-0004, TBD) keeps that door open.

---

# Sprint 0 — task prompts for Claude Code

Run these in order. Each is a self-contained delegation. Keep one concern per PR.
Honor `CLAUDE.md` (CC ≤ 10, pure modules, layering, sources verified).

### S0-T1 — Scaffold
> Initialize a TypeScript CLI project with pnpm. Add: `tsconfig.json` (strict),
> ESLint flat config with `complexity: ["error", 10]` and
> `@typescript-eslint` strict, dependency-cruiser config encoding the rules in
> `docs/architecture.md`, and npm scripts `build/lint/typecheck/test/test:it/
> depcheck`. Create the empty module folders from the architecture doc with an
> `index.ts` barrel each. No business logic yet. Verify `pnpm lint`,
> `pnpm typecheck`, and `pnpm depcheck` all pass on the empty scaffold.

### S0-T2 — Domain types
> In `src/types/`, define the domain model: `DryRunEffects`, `NormalizedEvent`,
> `FeeEstimate`, `Hop`, `TraceResult`, `DiagnosisContext`, `Diagnosis`,
> `DiagnosticRule` (shapes per ADR-0001 and ADR-0003). `types/` imports nothing.
> No logic — types and small constructors only. Unit-test the constructors.

### S0-T3 — Client wrapper (verify the API first)
> In `src/client/`, wrap PAPI to expose `dryRunCall(origin, call)` and
> `estimateFees(xcm)`, returning `types/` domain models (do not leak PAPI types).
> FIRST verify the actual PAPI calling convention for `DryRunApi` and
> `XcmPaymentApi` against the official docs/examples; pin findings as comments
> referencing the source. If a detail can't be verified, add `TODO(verify:)` and
> stop for review rather than guessing. Integration test behind `test:it`.

### S0-T4 — Diagnostics engine + seed rules
> Implement the rule registry and `diagnose()` per ADR-0003 in `src/diagnostics/`.
> Add the six seed rules. Pure module — no network imports. Build fixtures under
> `__fixtures__/` (start with hand-built `DryRunEffects` samples; replace with
> real captures from S0-T3 once available). Unit-test each rule + the `unknown`
> path.

### S0-T5 — Report renderers
> In `src/report/`, render a single-hop `TraceResult` to (a) human text and
> (b) JSON. Pure module. Snapshot-test both renderers against fixtures.

### S0-T6 — Orchestrator + CLI
> Wire `src/orchestrator/trace()` (single hop: dryRunCall → estimateFees →
> diagnose → assemble `TraceResult`) and `src/cli/` (`cartographer trace` with
> `--rpc --origin --call --format`, plus an explicit guarded rejection for
> `--xcm` until `dryRunXcm` is verified). Integration test the happy path and a
> known failing `--call` path against a live API-capable chain.

> After Sprint 0, capture 5–10 real dry-run outputs (success + each failure mode)
> and commit them as the diagnostics regression corpus before starting V2.
