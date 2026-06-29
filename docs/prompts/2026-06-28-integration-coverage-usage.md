# Integration, Coverage, and Usage Documentation Spec

Date: 2026-06-28

## Goal

Add an enforceable coverage gate, extend the opt-in integration harness, and
document the current Sprint-0 user workflow without changing Cartographer's
runtime API scope.

## Scope

- Add a `pnpm coverage` command that measures production TypeScript under `src/`
  and enforces a global 70% floor.
- Keep unit tests network-free and continue excluding `*.it.test.ts` from
  `pnpm test` and `pnpm coverage`.
- Add a CLI-level live integration test that runs only when explicit live env
  vars are supplied.
- Document the current runnable CLI path: `trace --rpc --origin --call --format`.
- Document that `--xcm` remains guarded until the raw-XCM client path is verified.

## Non-Goals

- No change to the `DryRunApi` or `XcmPaymentApi` calling convention.
- No raw-XCM parser or `dryRunXcm` implementation.
- No synthetic claim of live behavior when `pnpm test:it` runs without env vars.
- No new production dependency.

## Acceptance Criteria

- `pnpm coverage` passes at or above 70% for statements, branches, functions,
  and lines.
- `pnpm test:it` collects the integration test files and passes in no-env mode
  by reporting skipped live cases.
- CI runs the coverage gate.
- Usage documentation gives exact commands and env var contracts for unit,
  coverage, and live integration runs.
