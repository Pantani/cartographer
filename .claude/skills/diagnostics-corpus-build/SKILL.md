---
name: diagnostics-corpus-build
description: "Use for Cartographer diagnostics corpus work: converting real dry-run outputs into fixtures, replacing speculative rule samples, refining ADR-0003 seed rules, and capturing success/failure regression cases. Trigger on corpus, fixtures, diagnostics rules, failure modes, root cause quality, or post-Sprint-0 captures."
---

# Diagnostics Corpus Build

Use this skill when working on real dry-run fixtures or diagnostic rule quality.

## Goal
Make diagnostics evidence-backed by replacing hand-built samples with real payload-derived fixtures while preserving pure unit tests.

## Workflow
1. Read `CLAUDE.md`, ADR-0001, ADR-0003, and `src/diagnostics/**`.
2. Read `_workspace/01_papi_live_verification.md` or the provided capture files.
3. Build a coverage matrix for:
   - success
   - `barrier-blocked`
   - `insufficient-weight`
   - `asset-trapped`
   - `untrusted-reserve`
   - `version-mismatch`
   - `fees-unpayable`
   - unknown fallback
4. For each real capture, add a fixture and a failing test before adjusting a matcher.
5. Keep matchers small and ordered by specificity.
6. If a failure mode lacks real evidence, keep it defensive and document the gap.
7. Write `_workspace/02_diagnostics_corpus_report.md` with coverage and remaining gaps.

## Purity Rules
- No imports from `client/`, `orchestrator/`, or `cli/`.
- No PAPI or network library imports.
- No live RPC in unit tests.

## Acceptance Evidence
- `rtk pnpm lint`
- `rtk pnpm typecheck`
- `rtk pnpm depcheck`
- `rtk pnpm test`

## Stop Conditions
- A capture requires a missing `src/types/` field.
- A proposed rule cannot be tied to a real payload or primary source.
- A matcher would become broad enough to over-match another seeded failure mode.
