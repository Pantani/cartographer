# Debug-Flow Integration Build Spec

Date: 2026-06-29

## Goal

Add a dedicated opt-in integration build that proves Cartographer's complete
debug workflow through the CLI for both a known-good call and a known-failing
call.

## Scope

- Add a dedicated `pnpm test:debug-flow` command.
- Add a CLI-edge integration test that drives the real `cartographer trace`
  command with `--format json`.
- Keep live RPC execution behind explicit env vars.
- In no-env mode, pass only as harness proof and report the missing env vars.
- In live mode, assert:
  - the successful call produces at least one hop and `diagnosis.status =
    "success"`;
  - the failing call produces `diagnosis.status = "failure"`;
  - the failing call includes a non-empty `diagnosis.rootCause`.
- Update usage docs with the exact command and env var contract.
- Extend the local `.claude` harness with a dedicated debug-flow agent and skill.

## Non-Goals

- No `dryRunXcm` or `--xcm` implementation.
- No runtime API signature changes.
- No new production dependency.
- No claim that live behavior is proven when live cases are skipped.

## Acceptance Criteria

- `pnpm test:debug-flow` passes in no-env mode with an explicit missing-env
  setup test.
- `pnpm test:it` still passes in no-env mode.
- `pnpm lint`, `pnpm typecheck`, `pnpm depcheck`, `pnpm test`, and `pnpm build`
  pass.
- `docs/usage.md` documents the debug-flow command and live-proof
  interpretation.
