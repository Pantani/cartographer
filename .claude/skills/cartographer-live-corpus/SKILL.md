---
name: cartographer-live-corpus
description: "Use for Cartographer live dry-run evidence, CARTOGRAPHER_IT_* env checks, debug-flow proof, diagnostics fixture capture, payload-shape evidence, xcm:test, xcm:cli, test:live, reruns, updates, and corpus improvements. Do not use for non-live unit-only refactors."
---

# Cartographer Live Corpus

Use this skill when a task needs real dry-run evidence or fixture promotion from
live RPC output.

## Workflow
1. Read `docs/usage.md`, `.env.example`, `scripts/cartographer-live.mjs`, and the
   target integration test.
2. Create `_workspace/live-corpus/` if missing.
3. Check env vars before live commands. Required sets:
   - client smoke: `CARTOGRAPHER_IT_RPC`, `CARTOGRAPHER_IT_ACCOUNT`,
     `CARTOGRAPHER_IT_CALL`
   - CLI handoff: `CARTOGRAPHER_IT_RPC`, `CARTOGRAPHER_IT_ACCOUNT`,
     `CARTOGRAPHER_IT_CALL_OK` or `CARTOGRAPHER_IT_CALL`
   - full live: `CARTOGRAPHER_IT_RPC`, `CARTOGRAPHER_IT_ACCOUNT`,
     `CARTOGRAPHER_IT_CALL`, `CARTOGRAPHER_IT_CALL_OK`,
     `CARTOGRAPHER_IT_CALL_FAIL`
4. Run the narrowest command that proves the target:
   - `pnpm test:it`
   - `pnpm test:debug-flow`
   - `pnpm run xcm:test`
   - `pnpm run xcm:cli`
   - `pnpm run test:live`
5. Capture command, exit code, skipped/live status, and evidence paths.
6. Tee `CARTOGRAPHER_IT_EVIDENCE` output into `_workspace/live-corpus/`, then
   create a scrubbed copy before any fixture promotion.
7. Scrub sensitive values before promoting any fixture into `src/**/__fixtures__`.
8. Do not call skipped live tests product proof. Mark missing env explicitly.

## Output
Write `_workspace/02_dry-run-corpus_evidence.md` with:

```markdown
# Dry-Run Corpus Evidence

## Env
- Present:
- Missing:

## Commands
- Command:
- Exit:
- Result:

## Captures
- Raw:
- Scrubbed:
- Fixture recommendation:

## Blockers
- Missing live proof:
```

## Done Criteria
- Evidence is reproducible from commands.
- Fixtures are scrubbed and deterministic.
- Live-proof gaps are named, not hidden.
