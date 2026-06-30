---
name: cartographer-boundary-qa
description: "Use for Cartographer QA after any client, diagnostics, report, orchestrator, CLI, or docs change. Verifies layer boundaries, dependency-cruiser rules, TODO inventory, fixture-vs-live claims, and gate evidence. Trigger on review, QA, acceptance, done report, live integration, or release readiness."
---

# Cartographer Boundary QA

Use this skill to verify that Cartographer changes are coherent across module boundaries.

## Goal
Approve or reject a change with fresh evidence, not summaries from implementers.

## Checks
1. Read `CLAUDE.md`, `docs/architecture.md`, and the changed files.
2. Compare each producer/consumer boundary:
   - `client` normalized output vs `types`
   - `types` fields vs `diagnostics` matchers
   - `TraceResult` shape vs `report` output
   - `orchestrator.trace()` flow vs ADR-0001
   - CLI flags vs README/ROADMAP
3. Confirm pure modules stay pure.
4. Inventory `TODO(verify:)` and classify each as acceptable, stale, or blocking.
5. Run gates with `rtk`.
6. Write `_workspace/04_qa_acceptance.md`.

## Gate Commands
Run the relevant full set unless the user explicitly asks for a narrower check:

```bash
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm depcheck
rtk pnpm test
rtk pnpm test:it
rtk pnpm build
```

## Reporting
Report findings first, ordered by severity, with file/line references. Distinguish:
- passed with evidence
- skipped by design
- unverified
- failed

## Stop Conditions
- A pure module imports client/PAPI/network code.
- A live behavior claim is made while `test:it` only skipped.
- `src/types/` changes without contract re-sync notes.
