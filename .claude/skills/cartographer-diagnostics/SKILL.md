---
name: cartographer-diagnostics
description: "Use for Cartographer diagnostics rule work: seed rule refinement, root-cause wording, fixture promotion from live dry-run captures, unknown diagnosis behavior, ADR-0003 alignment, reruns, updates, fixes, and result improvements. Do not use for unrelated report formatting."
---

# Cartographer Diagnostics

Use this skill when changing `src/diagnostics/**` or diagnostics fixtures.

## Workflow
1. Read `docs/adr/0003-diagnostics-engine.md`, `src/diagnostics/rules.ts`, and
   the relevant fixtures.
2. Only refine matchers or human wording from verified dry-run captures or
   primary source evidence.
3. Add or update a fixture before changing a rule.
4. Keep the engine data-driven: add rule objects and helpers, not a large switch.
5. Preserve `unknown` as a first-class outcome with raw evidence for inspection.
6. Run the focused diagnostics tests before broader gates.

## File Ownership
- `src/diagnostics/**`
- `src/diagnostics/__fixtures__/**`
- diagnostics-focused tests

## Output
Write `_workspace/03_diagnostics_refinement.md` with captures used, rules changed,
tests run, and TODO(verify) items that remain.

## Done Criteria
- Every named rule has a fixture.
- No matcher relies on invented event/error names.
- Complexity remains below the repo ceiling.
