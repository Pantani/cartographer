---
name: debug-flow-integration-build
description: "Use for Cartographer full debug-flow integration builds: creating or updating opt-in integration tests that drive live inputs through client dry-run evidence, orchestrator trace, diagnostics root cause, report rendering, and CLI output. Trigger on full debug flow, fluxo completo de debug, test:debug-flow, end-to-end debug proof, integration build, live success/failure trace, rerun, update, fix, or improve the debug-flow harness."
---

# Debug Flow Integration Build

Use this skill when the task is to create, update, or verify Cartographer's complete debug-flow integration path.

## Goal
Produce reusable evidence that `cartographer trace` can run a complete debug workflow:

```text
live env input -> client dry-run/fees -> orchestrator trace -> diagnostics -> report -> CLI output
```

The skill must never present skipped live tests as live product proof.

## Required Context
1. Read `CLAUDE.md`, `docs/architecture.md`, ADR-0001, `docs/usage.md`, and current `*.it.test.ts` files.
2. Read `_workspace/01_papi_live_verification.md` when it exists.
3. Confirm the current env var contract before editing docs or tests:
   - `CARTOGRAPHER_IT_RPC`
   - `CARTOGRAPHER_IT_ACCOUNT`
   - `CARTOGRAPHER_IT_CALL_OK`
   - `CARTOGRAPHER_IT_CALL_FAIL`
   - optional `CARTOGRAPHER_IT_RESULT_XCM_VERSION`

## Workflow
1. Inventory current integration tests and scripts.
2. Write or update the failing integration test first when behavior changes.
3. Add a dedicated command when absent:

```bash
rtk pnpm test:debug-flow
```

4. The no-env path must assert missing env vars and skip live execution.
5. The live path must assert:
   - CLI JSON parses successfully
   - at least one hop is present
   - the known-good call returns `diagnosis.status = "success"`
   - the known-failing call returns `diagnosis.status = "failure"`
   - the failing path includes a non-empty `diagnosis.rootCause`
6. Update `docs/usage.md` with exact commands and env vars when the contract changes.
7. Write `_workspace/05_debug_flow_integration_report.md` with:
   - commands run
   - whether live cases ran or skipped
   - missing env vars, if any
   - output assertions
   - remaining live-data gaps

## Boundary Rules
- End-to-end tests may live at the CLI edge because CLI is the user-facing entrypoint.
- Production modules must keep the existing dependency direction from `docs/architecture.md`.
- Do not import `cli/` from a lower-layer test path that would violate dependency-cruiser.
- Do not add live RPC calls to unit tests.

## Acceptance Evidence
Run the relevant full set unless the user explicitly narrows scope:

```bash
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm depcheck
rtk pnpm test
rtk pnpm test:debug-flow
rtk pnpm test:it
rtk pnpm build
```

Interpretation:
- `test:debug-flow` passing without env vars means the debug-flow harness is wired.
- `test:debug-flow` passing with all env vars means live debug-flow proof for that endpoint and call pair.
- `test:it` passing without env vars remains harness proof, not live product proof.

## Stop Conditions
- A runtime API signature or payload shape differs from ADR-0001.
- The known-failing call cannot produce a failure diagnosis.
- The CLI contract requires enabling `--xcm` before `dryRunXcm` is verified.
- A live behavior claim depends on a skipped test.

## Test Scenarios

### Normal Flow
1. User supplies RPC, account, known-good call, and known-failing call.
2. `test:debug-flow` drives `cartographer trace --format json` through the real CLI.
3. The success case returns one or more hops and success diagnosis.
4. The failure case returns failure diagnosis with root cause text.
5. The report records the exact endpoint label, command, and live-run status.

### Error Flow
1. Env vars are missing.
2. `test:debug-flow` runs the setup test only.
3. The setup test reports exact missing env vars.
4. The report marks live proof as `skipped`, not `passed`.
