---
name: cartographer-debug-flow
description: "Use for Cartographer debug-flow integration work: pnpm test:debug-flow, CLI success/failure proof, scripts/cartographer-live.mjs env checks, live handoff commands, docs/usage debug-flow updates, reruns, fixes, and final evidence."
---

# Cartographer Debug Flow

Use this skill for the user-visible CLI proof that success and failure paths
work end to end.

## Workflow
1. Read `docs/usage.md`, `src/cli/debug-flow.it.test.ts`, and
   `scripts/cartographer-live.mjs`.
2. Verify the env contract before changing behavior.
3. Keep permissive integration tests skippable when env is absent.
4. Keep handoff commands fail-fast when env is missing or placeholder-valued.
5. When env is present, require success and failure calls to produce distinct
   diagnoses; failure must carry a non-empty root cause.
6. Update docs if commands, env vars, or expectations change.

## File Ownership
- `src/cli/debug-flow.it.test.ts`
- `scripts/cartographer-live.mjs`
- debug-flow sections in `docs/usage.md`

## Output
Write `_workspace/05_debug_flow_evidence.md` with command, env status, exit code,
and whether proof was live or skipped.

## Done Criteria
- Debug-flow tests are honest about skipped vs live proof.
- Final QA can cite a fresh command result.
