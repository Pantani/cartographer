---
name: cli-integration-hardening
description: "Use for Cartographer CLI and orchestrator next steps: trace command behavior, --call vs --xcm support, dryRunCall to estimateFees to diagnose wiring, opt-in integration tests, README/ROADMAP consistency, and end-to-end command proof."
---

# CLI Integration Hardening

Use this skill when the task touches Cartographer's user-facing `trace` command or orchestrator pipeline.

## Goal
Make the CLI honest and runnable end to end against verified client capabilities.

## Workflow
1. Read `CLAUDE.md`, `docs/architecture.md`, ADR-0001, `README.md`, and `ROADMAP.md`.
2. Compare the documented CLI surface with actual behavior in `src/cli/**` and `src/orchestrator/**`.
3. Decide the smallest honest path:
   - If `dryRunXcm` is not verified, keep `--xcm` rejected and update docs.
   - If `dryRunXcm` is verified, add parser, client method, tests, and docs in one scoped change.
4. For behavior changes, write failing unit tests first.
5. Keep live tests opt-in with env vars and clear skip behavior.
6. Produce `_workspace/03_cli_integration_report.md` with exact commands and env vars.

## Boundary Rules
- Orchestrator may import `client/`, `diagnostics/`, `report/`, and `types/`.
- CLI is the top edge. Nothing imports `cli/`.
- Do not put network access outside `client/`.

## Acceptance Evidence
- `rtk pnpm lint`
- `rtk pnpm typecheck`
- `rtk pnpm depcheck`
- `rtk pnpm test`
- `rtk pnpm test:it`
- `rtk pnpm build`

## Stop Conditions
- CLI docs promise behavior that the client cannot verify.
- An integration test needs real call data that has not been provided or captured.
- A runtime API decision would change ADR-0001 scope.
