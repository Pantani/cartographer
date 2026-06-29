# Local XCM Infrastructure With Chopsticks

- Date: 2026-06-29
- Status: Implemented with default generated-call submission boundary
- Owner: Cartographer local XCM harness

## Goal

Provide a local/forked XCM test workflow backed by Chopsticks so the default handoff commands can run without public RPC broadcast:

- `make infra-up` / `pnpm run infra:up`
- `make infra-status` / `pnpm run infra:status`
- `make xcm-send` / `pnpm run xcm:send`
- `make xcm-test` / `pnpm run xcm:test`
- `make xcm-cli` / `pnpm run xcm:cli`
- `make infra-down` / `pnpm run infra:down`

The workflow must keep the existing live runtime-API dry-run path available under explicit `live:*` commands, while moving the top-level `xcm:*` and `infra:*` handoff commands to the local Chopsticks workflow.

## Sources Of Record

- Polkadot Chopsticks reference: https://docs.polkadot.com/reference/tools/chopsticks/
- Polkadot parachain fork guide with Chopsticks: https://docs.polkadot.com/parachains/testing/fork-a-parachain/
- Official Chopsticks repository and example configs: https://github.com/AcalaNetwork/chopsticks
- Polkadot XCM debug and preview guide: https://docs.polkadot.com/chain-interactions/send-transactions/interoperability/debug-and-preview-xcms/
- Polkadot cross-chain asset transfer guide: https://docs.polkadot.com/chain-interactions/send-transactions/interoperability/transfer-assets-parachains/
- PAPI transaction docs: https://papi.how/typed/tx/
- PAPI signer docs: https://papi.how/signers/
- `DryRunApi` rustdoc: https://paritytech.github.io/polkadot-sdk/master/xcm_runtime_apis/dry_run/trait.DryRunApi.html
- `XcmPaymentApi` rustdoc: https://paritytech.github.io/polkadot-sdk/master/xcm_runtime_apis/fees/trait.XcmPaymentApi.html

Context7 was attempted for `polkadot-api` during planning but returned an expired OAuth token error. The implementation therefore uses the primary sources above.

## Mode Boundaries

| Mode | Target | State changes | Signing | Public broadcast |
| --- | --- | --- | --- | --- |
| Runtime API dry-run | API-capable RPC endpoint | No committed chain state | No submitted transaction | No |
| Local/forked extrinsic | Chopsticks local endpoints | Local fork state only | Local/dev signer or prebuilt local extrinsic | No |
| Public network broadcast | Public mainnet/testnet RPC | Public chain state if included | Real signer | Out of scope |

The local `xcm-send` command must never silently become a runtime API dry-run. If it cannot submit to a local/forked endpoint, it must fail with the missing dependency/configuration and explain that no real local evidence was produced.

## Decisions

1. Use `@acala-network/chopsticks` pinned to a verified version instead of `@latest`.
2. Prefer `chopsticks xcm` as the process entrypoint because the official CLI exposes relay/parachain XCM setup through that command.
3. Store active process state in `.cartographer-local/current.json`.
4. Preserve durable evidence under `_workspace/local-xcm/runs/<run-id>/`.
5. Keep `.cartographer-local/` gitignored and preserve `_workspace/` evidence for review.
6. Update ADR-0001 because the test harness will submit extrinsics to a local/forked endpoint while Cartographer's product CLI remains simulation-oriented and public broadcast stays out of scope.
7. Reconstruct the `.claude` harness because this checkout has no `.claude/` directory even though `CLAUDE.md` points to one.
8. Generate the default local SCALE call from runtime metadata for the selected Westend Asset Hub -> People topology; keep `CARTOGRAPHER_LOCAL_CALL` as an explicit override.

## Implementation Plan

1. Update tracking rules so `docs/prompts/` and the intended `.claude/agents` / `.claude/skills` harness files are versioned, while `.cartographer-local/` remains ignored.
2. Update ADR-0001 with the local/forked test-harness exception and the public-broadcast boundary.
3. Add the local XCM harness:
   - `.claude/skills/cartographer-local-xcm-orchestrator/SKILL.md`
   - `.claude/agents/chopsticks-infra-engineer.md`
   - `.claude/agents/xcm-transaction-engineer.md`
   - `.claude/agents/cartographer-local-integration-engineer.md`
   - `.claude/agents/local-xcm-qa-inspector.md`
   - `.claude/agents/docs-runbook-owner.md`
4. Add `infra/chopsticks/` with local config pointers and a runbook.
5. Write pure unit tests first for `scripts/cartographer-local-xcm.mjs` helpers:
   - local-only endpoint validation
   - state file handling
   - command argument construction
   - health-check request construction
   - evidence/run directory naming
   - fail-fast messages for missing local config and invalid call overrides
6. Implement `scripts/cartographer-local-xcm.mjs` with injectable I/O so unit tests do not start processes or hit the network.
7. Wire `package.json` and `Makefile` to the local commands, preserving existing live dry-run commands under `live:*`.
8. Update `.env.example`, README, and `docs/usage.md` with the local workflow and mode boundaries.
9. Validate with:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm depcheck`
   - `pnpm build`
10. If local Chopsticks setup is available, also run:
    - `make infra-up`
    - `make infra-status`
    - `make xcm-send`
    - `make xcm-test`
    - `make xcm-cli`
    - `make infra-down`

## Ready Criteria

- Commands fail early when Chopsticks/config is missing or a configured call override is invalid.
- Commands reject non-local RPC endpoints for local send/test/cli workflows.
- `infra-down` only tears down tracked local processes and does not erase durable evidence without saying so.
- Unit tests cover helper behavior without network or real processes.
- Documentation clearly separates runtime API dry-run, local/forked extrinsic submission, and public network broadcast.

## Implementation Note

The harness starts a real local/forked Chopsticks XCM topology and can submit a
generated or configured local SCALE call through PAPI. The generated default is
`PolkadotXcm.limited_teleport_assets` for the selected Westend Asset Hub ->
People topology. It is encoded through the local origin runtime metadata, reads
the destination parachain id from the local destination runtime, and stores the
generated SCALE call in evidence. `CARTOGRAPHER_LOCAL_CALL` remains an override
for prebuilt local calls.

`CARTOGRAPHER_LOCAL_ACCOUNT` stays a local dev SURI for transaction signing.
The local CLI wrapper derives the matching SS58 account for `DryRunApi` origins;
passing `//Alice` directly to `DryRunApi.dry_run_call` fails runtime AccountId
codec validation.
