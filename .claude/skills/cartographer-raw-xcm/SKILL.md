---
name: cartographer-raw-xcm
description: "Use for implementing, fixing, testing, rerunning, or improving Cartographer raw --xcm support: JSON XCM validation, location origins, DryRunApi.dry_run_xcm, client.dryRunXcm, CLI --xcm enablement, and raw-XCM integration tests."
---

# Cartographer Raw XCM

Use this skill for the raw `--xcm` implementation lane.

## Preconditions
- Run `cartographer-source-verification` for `DryRunApi.dry_run_xcm` call shape.
- Keep `--xcm` rejected until parser validation and `client.dryRunXcm` are both
  covered by tests.

## Workflow
1. Write failing tests first:
   - CLI rejects invalid JSON and accepts a valid XCM file only when supported.
   - `trace()` dispatches `request.xcm` to `client.dryRunXcm`.
   - client boundary maps a location origin and versioned XCM without leaking PAPI
     types.
2. Implement smallest units:
   - domain parser/validator for the supported JSON shape
   - `ChainClient.dryRunXcm`
   - orchestrator dispatch
   - CLI file read and request conversion
3. Keep pure parsing out of `client/` if it does not perform RPC.
4. Preserve existing `--call` behavior and tests.
5. Add opt-in integration coverage behind the existing live env contract or a
   documented extension.
6. Update `README.md` and `docs/usage.md` when `--xcm` becomes runnable.

## File Ownership
- Primary: `src/client/**`, `src/cli/**`, `src/orchestrator/trace.ts`,
  `src/types/request.ts`, focused tests.
- Coordinate before touching `src/report/**` or `src/registry/**`.

## Done Criteria
- `pnpm lint`, `pnpm typecheck`, relevant tests, and `pnpm depcheck` pass.
- Any unverified API detail remains clearly marked TODO(verify).
- `--xcm` is either fully supported with docs or still guarded honestly.
