---
name: cartographer-local-xcm-orchestrator
description: "Use when Cartographer work involves local Chopsticks XCM infra, infra-up/status/down, xcm-send/test/cli, local/forked XCM evidence, reruns, updates, fixes, or proof-limit review."
---

# Cartographer Local XCM Orchestrator

Coordinate the local/forked XCM harness for Cartographer.

## Execution Mode: Sub-Agent Fan-Out/Fan-In

Use parallel sub-agents for independent research or review. Use direct implementation in the main session for tightly coupled code edits and TDD loops.

## Team

| Agent | Role | Primary Outputs |
| --- | --- | --- |
| `chopsticks-infra-engineer` | Chopsticks configs, process lifecycle, ports, state, teardown | infra config and health evidence |
| `xcm-transaction-engineer` | local call/submission path and signer/API verification | transaction recipe, tx evidence |
| `cartographer-local-integration-engineer` | scripts, Makefile/package, CLI compatibility, tests | wiring and pure unit tests |
| `local-xcm-qa-inspector` | end-to-end validation and proof limits | evidence report |
| `docs-runbook-owner` | README, usage, `.env.example`, ADR/prompt docs | runbook updates |

## Workflow

### Phase 0: Context Check

1. Read `AGENTS.md`, `CLAUDE.md`, README, architecture docs, ADRs, and `docs/usage.md`.
2. Check `.claude/agents`, `.claude/skills`, `package.json`, `Makefile`, and current git status.
3. If `_workspace/local-xcm/` or `.cartographer-local/` exists, preserve it and treat it as prior evidence/state unless the user asks to clean it.

### Phase 1: Source Verification

1. Record official primary source links in the spec or docs for every XCM, Chopsticks, PAPI, `DryRunApi`, or `XcmPaymentApi` claim.
2. Use Context7 as a discovery aid when it is available in the current environment.
3. If Context7 is unavailable, use official Polkadot docs, Chopsticks repo/package source, PAPI docs, and polkadot-sdk rustdoc directly.

### Phase 2: Plan And Scope

1. Write or update a spec in `docs/prompts/`.
2. Update ADRs before changing architectural boundaries.
3. Separate these modes:
   - runtime API dry-run: no committed chain state, no transaction submission
   - local/forked extrinsic: submitted only to Chopsticks/local endpoints
   - public network broadcast: out of scope

### Phase 3: Implementation

1. Use TDD for helper logic.
2. Keep unit tests process-free and network-free.
3. Keep local infra orchestration in scripts and config files.
4. Preserve live dry-run commands under explicit `live:*` names when changing default `xcm:*` commands.
5. Fail early for missing Chopsticks config, invalid call overrides, non-local endpoint, dead process, or failed local RPC health.

### Phase 4: QA

1. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm depcheck`, and `pnpm build`.
2. If local infra is available, run `make infra-up`, `make infra-status`, `make xcm-send`, `make xcm-test`, `make xcm-cli`, and `make infra-down`.
3. If local infra cannot run, report the missing binary/config/download/call and state which parts were validated without real XCM evidence.

## Error Handling

| Situation | Required Response |
| --- | --- |
| Context7 unavailable | Use official primary sources and mention the Context7 failure in the spec or handoff. |
| Missing local call | Generate the verified default call from local runtime metadata; fail only if generation cannot be verified. |
| Non-local endpoint | Refuse send/test/CLI local workflow. |
| Chopsticks process stale | Report stale state and avoid killing untracked processes. |
| Route/event not verified | Leave a TODO or docs limitation; do not invent a fact. |

## Test Scenarios

### Normal Flow

1. User asks to update local XCM infra.
2. Spec/ADR are updated first.
3. Helpers are tested before implementation.
4. Local commands start Chopsticks, submit a generated or configured local call, validate evidence, run Cartographer CLI locally, and tear down tracked processes.

### Error Flow

1. User runs `make xcm-send` with an invalid `CARTOGRAPHER_LOCAL_CALL`.
2. Command fails before submission.
3. Output states that the override must be a 0x-prefixed even-length SCALE call.
