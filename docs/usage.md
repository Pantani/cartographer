# Usage

Cartographer's current Sprint-0 runnable surface is single-hop `--call` tracing.
Raw XCM JSON input is intentionally rejected until the `dryRunXcm` client path
and input validation are verified.

## Install And Build

```bash
pnpm install
pnpm build
```

The built CLI entrypoint is `dist/cli/index.js`. For a clean CI-style install,
use `CI=true pnpm install --frozen-lockfile`.

## Live Env Setup

Live commands read environment variables from the shell process. `.env.example`
is the reference list; it is not loaded automatically by the CLI or tests.

Required for client-level live evidence:

- `CARTOGRAPHER_IT_RPC`
- `CARTOGRAPHER_IT_ACCOUNT`
- `CARTOGRAPHER_IT_CALL`

Required for the built CLI handoff (`pnpm run xcm:cli`):

- `CARTOGRAPHER_IT_RPC`
- `CARTOGRAPHER_IT_ACCOUNT`
- `CARTOGRAPHER_IT_CALL_OK` or `CARTOGRAPHER_IT_CALL`

Required for the full live suite (`pnpm run test:live`):

- `CARTOGRAPHER_IT_RPC`
- `CARTOGRAPHER_IT_ACCOUNT`
- `CARTOGRAPHER_IT_CALL`
- `CARTOGRAPHER_IT_CALL_OK`
- `CARTOGRAPHER_IT_CALL_FAIL`

Required for the debug-flow proof (`pnpm test:debug-flow`):

- `CARTOGRAPHER_IT_RPC`
- `CARTOGRAPHER_IT_ACCOUNT`
- `CARTOGRAPHER_IT_CALL_OK`
- `CARTOGRAPHER_IT_CALL_FAIL`

Optional:

- `CARTOGRAPHER_IT_RESULT_XCM_VERSION` (`2`, `3`, `4`, or `5`; defaults to `4`)
- `CARTOGRAPHER_IT_FORMAT` (`human` or `json`; defaults to `json` for `xcm:cli`)

## Run A Trace

Use an API-capable WebSocket RPC endpoint, an origin account, and a
SCALE-encoded call:

```bash
node dist/cli/index.js trace \
  --rpc wss://asset-hub-polkadot-rpc.example \
  --origin 5... \
  --call '0x...' \
  --format human
```

JSON output is available with `--format json`:

```bash
node dist/cli/index.js trace \
  --rpc wss://asset-hub-polkadot-rpc.example \
  --origin 5... \
  --call '0x...' \
  --format json
```

`--xcm` is parsed but not supported in this build:

```bash
node dist/cli/index.js trace \
  --rpc wss://asset-hub-polkadot-rpc.example \
  --origin 5... \
  --xcm ./program.json
```

Expected result:

```text
cartographer: Raw XCM input (--xcm) is not supported in this build; pass --call.
```

## Test And Coverage Commands

Unit tests never hit the network:

```bash
pnpm test
```

Coverage runs the same non-live test set and enforces a global 70% floor for
statements, branches, functions, and lines:

```bash
pnpm coverage
```

Integration tests are opt-in and live-RPC capable:

```bash
pnpm test:it
```

Without live inputs, `pnpm test:it` should pass only as harness proof: setup
tests report which env vars are missing and live cases are skipped.

The dedicated debug-flow build drives the real CLI through success and failure
paths:

```bash
pnpm test:debug-flow
```

Without live inputs, `pnpm test:debug-flow` should also pass only as harness
proof: the setup test reports missing env vars and the live cases are skipped.

Run the complete local non-live gate before committing:

```bash
pnpm run check
```

This runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`,
`pnpm depcheck`, and `pnpm build`.

## Make And Script Shortcuts

The repository exposes Make targets for local terminal use and equivalent
`pnpm` scripts for CI or shells without `make`.

| Goal | Make target | pnpm script |
| --- | --- | --- |
| Install/build and prove the integration harness | `make infra-up` | `pnpm run infra:up` |
| Run all local quality gates | `make check` | `pnpm run check` |
| Run client-level live dry-run evidence | `make xcm-test` | `pnpm run xcm:test` |
| Run the built CLI with live env vars | `make xcm-cli` | `pnpm run xcm:cli` |
| Run every live integration test with required env vars | `make test-live` | `pnpm run test:live` |
| Run ESLint auto-fix | `make lint-fix` | `pnpm lint:fix` |

Prepare local test infrastructure:

```bash
make infra-up
# equivalent:
CI=true pnpm install --frozen-lockfile
pnpm run infra:up
```

This installs dependencies, builds the CLI, and runs the integration harness.
Without live env vars, live cases are skipped; this proves setup, not a real
chain dry-run.

Run all local quality gates:

```bash
make check
# equivalent:
pnpm run check
```

Run the client-level live XCM dry-run evidence test:

```bash
make xcm-test
# equivalent:
pnpm run xcm:test
```

Run the built CLI against the live env:

```bash
make xcm-cli
# equivalent:
pnpm run xcm:cli
```

Run the full live integration suite:

```bash
make test-live
# equivalent:
pnpm run test:live
```

These live commands are read-only dry-runs. They do not broadcast an extrinsic
and they do not execute raw `--xcm` JSON. The current Sprint-0 surface accepts a
SCALE-encoded `--call` and follows the runtime API dry-run result.

`pnpm test:it` and `pnpm test:debug-flow` are permissive by design and skip live
cases when env vars are missing. `pnpm run xcm:test`, `pnpm run xcm:cli`, and
`pnpm run test:live` are handoff commands: they check required env vars first
and fail fast when an input is missing.

## Live Integration Inputs

Client-level dry-run evidence:

```bash
CARTOGRAPHER_IT_RPC='wss://asset-hub-polkadot-rpc.example' \
CARTOGRAPHER_IT_ACCOUNT='5...' \
CARTOGRAPHER_IT_CALL='0x...' \
pnpm exec vitest run src/client/dry-run.it.test.ts
```

Optional additional client call labels:

- `CARTOGRAPHER_IT_CALL_HAPPY`
- `CARTOGRAPHER_IT_CALL_FAIL`

Full orchestrator trace proof:

```bash
CARTOGRAPHER_IT_RPC='wss://asset-hub-polkadot-rpc.example' \
CARTOGRAPHER_IT_ACCOUNT='5...' \
CARTOGRAPHER_IT_CALL_OK='0x...' \
CARTOGRAPHER_IT_CALL_FAIL='0x...' \
pnpm exec vitest run src/orchestrator/trace.it.test.ts
```

CLI trace proof:

```bash
CARTOGRAPHER_IT_RPC='wss://asset-hub-polkadot-rpc.example' \
CARTOGRAPHER_IT_ACCOUNT='5...' \
CARTOGRAPHER_IT_CALL_OK='0x...' \
pnpm exec vitest run src/cli/trace.it.test.ts
```

Full debug-flow proof:

```bash
CARTOGRAPHER_IT_RPC='wss://asset-hub-polkadot-rpc.example' \
CARTOGRAPHER_IT_ACCOUNT='5...' \
CARTOGRAPHER_IT_CALL_OK='0x...' \
CARTOGRAPHER_IT_CALL_FAIL='0x...' \
pnpm test:debug-flow
```

This command runs the real CLI in JSON mode. The `CALL_OK` input must produce a
success diagnosis; the `CALL_FAIL` input must produce a failure diagnosis with a
non-empty root cause.

Run every integration test with one command after setting the relevant env vars:

```bash
pnpm test:it
```

## Interpreting Integration Results

- Passing `pnpm test:it` with skipped live cases means the harness is wired.
- Passing `pnpm test:it` with live env vars set is live product evidence for the
  supplied endpoint and call data.
- Passing `pnpm test:debug-flow` with skipped live cases means only the
  debug-flow harness is wired.
- Passing `pnpm test:debug-flow` with live env vars set is live proof that the
  supplied success/failure calls run through CLI output and diagnostics.
- Passing `pnpm run test:live` means the required full live env contract was
  present before Vitest started.
- The client evidence test prints `CARTOGRAPHER_IT_EVIDENCE` JSON. Use that
  output to close payload-shape `TODO(verify:)` items only after checking that
  the endpoint, call, and runtime target are the intended ones.

## Continuous Integration

The CI workflow runs on pull requests, pushes to `main`, and manual dispatch.

- `quality`: Node 20.x and 22.x matrix for lint/complexity, typecheck, unit
  tests, dependency boundaries, and build.
- `coverage`: global 70% floor for statements, branches, functions, and lines.
- `workflow-lint`: `actionlint` over `.github/workflows/*.yml`.
- `ci-success`: required rollup that fails if any required CI job failed.

The dependency audit workflow runs `pnpm audit --prod --audit-level moderate` on
dependency file changes, a weekly schedule, and manual dispatch.
