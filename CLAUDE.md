# CLAUDE.md — Cartographer

Operating contract for AI agents (Claude Code / Codex) working in this repo.
Read this fully before touching code.

## Project in one paragraph

Cartographer is a TypeScript CLI that dry-runs XCM, follows the message across
every hop, and reports the outcome — including a human-readable root cause on
failure. It orchestrates existing runtime APIs (`DryRunApi`, `XcmPaymentApi`) via
PAPI and, later, Chopsticks for real-state forks. It does not re-implement the
XCVM. See `README.md`, `docs/architecture.md`, and `docs/adr/`.

## Non-negotiable rules

### Sources & truth
- **Never assert a fact about XCM, runtime APIs, PAPI, or Chopsticks without a
  verifiable source** (official docs, the polkadot-sdk source, the crate docs).
  If you cannot verify a method name, signature, or behaviour, say so and leave a
  `// TODO(verify): <what + where to check>` instead of inventing it.
- No unattributed claims in docs or comments. Prefer primary sources (specs,
  repos, docs.rs) over aggregators.
- The runtime API signatures of record are pinned in
  `docs/adr/0001-scope-and-architecture.md`. If reality differs from what is
  pinned, update the ADR in the same PR — do not silently diverge.

### Code quality
- **Cyclomatic complexity ceiling = 10**, enforced via ESLint
  (`complexity: ["error", 10]`). Refactor anything that exceeds it; do not
  disable the rule.
- Idiomatic, functional TypeScript. No clever hacks, no `any` to silence the
  compiler. `strict` is on and stays on.
- Code and comments in English.
- Small, pure, testable units. I/O (RPC) lives only in `client/`. `diagnostics/`
  and `report/` must stay pure — they receive data, never reach the network.

### Architecture & dependencies
- Respect the layering in `docs/architecture.md`. The boundaries are enforced by
  dependency-cruiser (`pnpm depcheck`); a violating import fails CI.
- No cycles between modules. If you need a shared type, put it in `types/`, which
  imports nothing.
- Before adding a dependency, justify it in the PR description: what it does,
  why a stdlib/existing approach is insufficient, and its transitive weight.

### Performance (profile-first)
- Default to the simple, readable path. The hot path here is I/O-bound (RPC
  round-trips), not CPU. Do not micro-optimize without a measured bottleneck.
- Where it matters: batch RPC calls, avoid N+1 round-trips across hops, stream
  rather than buffer large traces. Multi-hop (V2) must not refetch chain
  metadata per hop — cache it in the registry.

## Workflow

1. **Spec before code.** Non-trivial work starts from an ADR or a task spec in
   `docs/prompts/`. If a task implies an architectural decision not yet recorded,
   write/extend the ADR first and stop for review.
2. **One concern per PR.** Keep diffs reviewable and atomic.
3. **Tests are part of "done".** Pure modules (`diagnostics`, `report`,
   `orchestrator` logic) get unit tests with fixtures — no live network in unit
   tests. Network paths get integration tests behind a flag.
4. **Update docs in the same PR** when behaviour or decisions change.

## Definition of done (per task)
- [ ] ESLint clean (incl. `complexity`), `tsc --noEmit` clean.
- [ ] `pnpm depcheck` clean (no layering violations, no cycles).
- [ ] Unit tests for new pure logic, with fixtures.
- [ ] Public functions have a one-line doc comment stating intent + invariants.
- [ ] Relevant ADR / architecture doc updated if a decision changed.

## Commands

```bash
pnpm install
pnpm build          # tsc
pnpm lint           # eslint (complexity gate)
pnpm typecheck      # tsc --noEmit
pnpm test           # unit tests (no network)
pnpm test:it        # integration tests (hits live RPC; opt-in)
pnpm depcheck       # dependency-cruiser: layering + cycles
```

## Harness: Cartographer Next Steps

**Goal:** Coordinate the post-Sprint-0 work needed to close live PAPI truth,
real diagnostics fixtures, CLI honesty, and final QA evidence.

**Trigger:** For Cartographer next-step work involving PAPI live verification,
dry-run corpus capture, diagnostics refinement, `--xcm`/CLI decisions,
integration tests, full debug-flow builds, `test:debug-flow`, QA acceptance,
reruns, updates, fixes, or result improvements, use the
`cartographer-next-steps-orchestrator` skill. Simple questions can be answered
directly.

**Change History:**

| Date | Change | Target | Reason |
|------|--------|--------|--------|
| 2026-06-28 | Initial next-steps harness | `.claude/agents`, `.claude/skills`, `CLAUDE.md` | Coordinate post-Sprint-0 live verification and integration work |
| 2026-06-29 | Added debug-flow integration builder | `.claude/agents`, `.claude/skills`, `CLAUDE.md` | Create a dedicated harness lane for complete debug-flow integration tests |

## Glossary (for agents not native to Polkadot)
- **XCM**: a program of instructions executed by the destination chain's VM.
- **XCVM**: the virtual machine that runs XCM instructions.
- **Instruction**: an opcode (`WithdrawAsset`, `BuyExecution`, `DepositAsset`,
  `Transact`, …).
- **Holding register**: temporary asset buffer during execution; leftovers get
  *trapped*.
- **Location** (MultiLocation): hierarchical, *relative* addressing of chains/accounts.
- **Barrier**: entry filter deciding whether a message may execute.
- **Reserve / Teleport**: two asset-movement models, each with its own trust
  configuration.
- **DryRunApi / XcmPaymentApi**: runtime APIs returning execution effects and fee
  estimates respectively.
