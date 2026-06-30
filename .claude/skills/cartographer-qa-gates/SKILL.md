---
name: cartographer-qa-gates
description: "Use for Cartographer QA, final acceptance, incremental module verification, command evidence, source-claim audit, dependency-cruiser boundaries, complexity, no-warning checks, live-proof gaps, reruns, fixes, and result improvements."
---

# Cartographer QA Gates

Use this skill whenever a Cartographer implementation slice claims readiness.

## Incremental QA
Run QA after each module boundary:
- client API wrapper vs normalized domain types
- CLI flags vs `TraceRequest`
- orchestrator dispatch vs injected client contract
- registry resolution vs hop loop consumption
- report snapshots vs trace shape

## Required Commands
Use the narrowest useful command during development, then the full gate at the
end:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm coverage
pnpm depcheck
pnpm build
pnpm run check
```

Live commands are separate proof and require env vars:

```bash
pnpm test:it
pnpm test:debug-flow
pnpm run xcm:test
pnpm run xcm:cli
pnpm run test:live
```

## Audit Checklist
- Complexity <= 10 and no explicit `any`.
- `diagnostics/` and `report/` stay pure.
- PAPI types do not leak beyond `client/`.
- ADR-0001 is updated if runtime API reality differs.
- Skipped live tests are reported as harness proof only.
- Live env absence is a blocked-proof status, not a failed implementation.
- Workflow lint is claimed only if `actionlint` ran locally or CI evidence is
  linked; if `actionlint` is unavailable, record that as unverified locally.
- Public functions added by implementation have one-line intent/invariant docs.

## Output
Write `_workspace/08_qa_audit.md` with commands, exit codes, findings, and live
proof status.

## Done Criteria
- Full non-live `pnpm run check` passes before completion is claimed.
- Live gaps, if any, are explicitly named with missing env vars or failing proof.
