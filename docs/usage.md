# Usage

Cartographer's current Sprint-0 runnable surface is single-hop `--call` tracing.
Raw XCM JSON input is intentionally rejected until the `dryRunXcm` client path
and input validation are verified.

## Install And Build

```bash
pnpm install
pnpm build
```

The built CLI entrypoint is `dist/cli/index.js`.

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
- `CARTOGRAPHER_IT_RESULT_XCM_VERSION` (`2`, `3`, `4`, or `5`; defaults to `4`)

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
- The client evidence test prints `CARTOGRAPHER_IT_EVIDENCE` JSON. Use that
  output to close payload-shape `TODO(verify:)` items only after checking that
  the endpoint, call, and runtime target are the intended ones.
