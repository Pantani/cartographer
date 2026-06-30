# Usage

Cartographer's current runnable surface supports single-hop `--call` tracing,
raw `--xcm` JSON tracing, and static-registry multi-hop tracing. The live
handoff script can assemble `--call`, raw-XCM, and registry-backed CLI runs;
they become product evidence only when the required env/file inputs point at a
real route under test.

## Workflow Modes

| Mode | Network target | State changes | Requires signing | Public broadcast |
| --- | --- | --- | --- | --- |
| Runtime API dry-run | API-capable RPC endpoint | No committed chain state | No submitted transaction | No |
| Local/forked extrinsic | Chopsticks local endpoints | Local fork state only | Local/dev signer or configured call material | No |
| Public network broadcast | Public mainnet/testnet RPC | Public chain state if included | Real signer | Out of scope |

The default `infra:*` and `xcm:*` commands use the local/forked Chopsticks mode.
The live dry-run workflow is still available under explicit `live:*` commands.

## Install And Build

```bash
pnpm install
pnpm build
```

The built CLI entrypoint is `dist/cli/index.js`. For a clean CI-style install,
use `CI=true pnpm install --frozen-lockfile`.

## Local Chopsticks Env Setup

Local commands read environment variables from the shell process. `.env.example`
is the reference list; it is not loaded automatically.

Defaults:

- `CARTOGRAPHER_LOCAL_RELAY_CONFIG=infra/chopsticks/westend.yml`
- `CARTOGRAPHER_LOCAL_PARACHAIN_CONFIGS=infra/chopsticks/westend-asset-hub.yml,infra/chopsticks/westend-people.yml`
- `CARTOGRAPHER_LOCAL_ORIGIN_RPC=ws://127.0.0.1:8000`
- `CARTOGRAPHER_LOCAL_DEST_RPC=ws://127.0.0.1:8001`
- `CARTOGRAPHER_LOCAL_RELAY_RPC=ws://127.0.0.1:8002`
- `CARTOGRAPHER_LOCAL_ACCOUNT=//Alice` (local dev SURI used for signing; `xcm-cli` derives the matching SS58 account for `DryRunApi`)

Default local transaction submission:

- `make xcm-send` generates a SCALE-encoded `PolkadotXcm.limited_teleport_assets` call when `CARTOGRAPHER_LOCAL_CALL` is unset.
- The destination parachain id is read from `ParachainInfo.ParachainId` on `CARTOGRAPHER_LOCAL_DEST_RPC`.
- The call shape is encoded through the local origin runtime metadata; generation fails if the selected runtime does not expose that transaction.
- The generated call and transaction result are stored under `_workspace/local-xcm/runs/<run-id>/`.

Optional local transaction knobs:

- `CARTOGRAPHER_LOCAL_CALL`: 0x-prefixed, even-length SCALE call override valid on the local origin chain.
- `CARTOGRAPHER_LOCAL_XCM_AMOUNT`: non-negative integer amount used by the generated default call; defaults to `10000000000`.
- `CARTOGRAPHER_LOCAL_BOOT_TIMEOUT_MS`: total `infra-up` wait budget; defaults to `120000`.
- `CARTOGRAPHER_LOCAL_HEALTH_TIMEOUT_MS`: per-RPC health probe timeout; defaults to `5000`.
- `CARTOGRAPHER_LOCAL_SEND_TIMEOUT_MS`: local transaction finalization timeout; defaults to `120000`.

The harness submits the generated or configured call with PAPI
`txFromCallData(...).signAndSubmit(...)`. This is a local/forked extrinsic
submission, not a runtime API dry-run and not public network broadcast.

## Live Dry-Run Env Setup

Live commands read environment variables from the shell process. `.env.example`
is the reference list; it is not loaded automatically by the CLI or tests.

Required for client-level live evidence:

- `CARTOGRAPHER_IT_RPC`
- `CARTOGRAPHER_IT_ACCOUNT`
- `CARTOGRAPHER_IT_CALL`

Required for the built live CLI handoff (`pnpm run live:xcm:cli`):

- `CARTOGRAPHER_IT_RPC`

Call mode:

- `CARTOGRAPHER_IT_ACCOUNT`
- `CARTOGRAPHER_IT_CALL_OK` or `CARTOGRAPHER_IT_CALL`

Raw-XCM mode, selected when `CARTOGRAPHER_IT_XCM_FILE` is set:

- `CARTOGRAPHER_IT_XCM_ORIGIN`
- `CARTOGRAPHER_IT_XCM_FILE`

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
- `CARTOGRAPHER_IT_FORMAT` (`human` or `json`; defaults to `json` for `live:xcm:cli`)
- `CARTOGRAPHER_IT_REGISTRY` (static registry JSON path passed as `--registry`)
- `CARTOGRAPHER_IT_MAX_DEPTH` (positive integer passed as `--max-depth`)

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

JSON output preserves the full `TraceResult` payload and adds two top-level route
helpers:

- `route`: ordered hop summaries with index, display label, chain reference, and
  status.
- `failingHop`: the first failing hop summary, or `null` when no hop failed.

Raw XCM JSON input is available with `--xcm`. For this path, `--origin` must be
a JSON XCM `Location`, not an account:

```bash
cat > program.json <<'JSON'
{
  "version": 4,
  "instructions": [
    { "kind": "ClearOrigin" },
    { "kind": "BuyExecution", "args": { "fees": "DOT" } }
  ]
}
JSON

node dist/cli/index.js trace \
  --rpc wss://asset-hub-polkadot-rpc.example \
  --origin '{"parents":1,"interior":"Here"}' \
  --xcm ./program.json \
  --format json
```

The raw JSON shape is Cartographer's domain model: `version` is `2`, `3`, `4`,
or `5`; `instructions` is an array of `{ "kind": string, "args"?: JSON }`.

## Run A Multi-Hop Trace

Multi-hop tracing follows `forwardedXcms` only when a static registry is
provided. The registry maps normalized XCM destination locations to endpoints:

```bash
cat > registry.json <<'JSON'
{
  "chains": [
    {
      "name": "Asset Hub",
      "rpc": "wss://asset-hub-polkadot-rpc.example",
      "location": { "parents": 1, "interior": { "X1": { "Parachain": 1000 } } }
    }
  ]
}
JSON
```

Then pass it to the trace command:

```bash
node dist/cli/index.js trace \
  --rpc wss://relay.example \
  --origin 5... \
  --call '0x...' \
  --registry ./registry.json \
  --max-depth 4 \
  --format human
```

`--max-depth` is the maximum total hop count, including the origin hop. If the
route repeats an already-seen forwarded destination/message, Cartographer fails
with a cycle error instead of re-running the same route edge.

## Test And Coverage Commands

Unit tests never hit the network:

```bash
pnpm test
```

Coverage runs the same non-live test set over `src/` and non-test `scripts/`,
then enforces a global 70% floor for statements, branches, functions, and lines:

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
| Start local Chopsticks XCM infra | `make infra-up` | `pnpm run infra:up` |
| Show local infra status and RPC health | `make infra-status` | `pnpm run infra:status` |
| Submit generated or configured local XCM test call | `make xcm-send` | `pnpm run xcm:send` |
| Validate local XCM evidence | `make xcm-test` | `pnpm run xcm:test` |
| Run built CLI against local Chopsticks | `make xcm-cli` | `pnpm run xcm:cli` |
| Stop tracked local infra | `make infra-down` | `pnpm run infra:down` |
| Run all local quality gates | `make check` | `pnpm run check` |
| Run client-level live dry-run evidence | `make live-xcm-test` | `pnpm run live:xcm:test` |
| Run the built CLI with live env vars | `make live-xcm-cli` | `pnpm run live:xcm:cli` |
| Run every live integration test with required env vars | `make test-live` | `pnpm run test:live` |
| Generate a diagnostics fixture module from scrubbed evidence | `make evidence-fixture INPUT=path` | `pnpm --silent run evidence:fixture -- path` |
| Run ESLint auto-fix | `make lint-fix` | `pnpm lint:fix` |

Start local/forked Chopsticks XCM infrastructure:

```bash
make infra-up
# equivalent:
CI=true pnpm install --frozen-lockfile
pnpm run infra:up
```

This installs dependencies through the Make target and starts `chopsticks xcm`
with the default Westend relay + Asset Hub + People topology.

Check endpoints, process state, and local RPC health:

```bash
make infra-status
```

Submit the default generated local call:

```bash
make xcm-send
```

Submit an explicit prebuilt local call instead:

```bash
CARTOGRAPHER_LOCAL_CALL='0x...' make xcm-send
```

This is a real extrinsic submission to the local/forked origin endpoint. It is
not a runtime API dry-run and it is not public network broadcast.

Run all local quality gates:

```bash
make check
# equivalent:
pnpm run check
```

Validate the local XCM evidence:

```bash
make xcm-test
# equivalent:
pnpm run xcm:test
```

Run the built CLI against the local origin endpoint and the saved/configured call:

```bash
make xcm-cli
# equivalent:
pnpm run xcm:cli
```

Stop local infra:

```bash
make infra-down
```

`infra-down` only stops the tracked process from `.cartographer-local/current.json`
and preserves evidence under `_workspace/local-xcm/`.

Run the client-level live XCM dry-run evidence test:

```bash
make live-xcm-test
# equivalent:
pnpm run live:xcm:test
```

Run the built CLI against the live dry-run env:

```bash
make live-xcm-cli
# equivalent:
pnpm run live:xcm:cli
```

Run the full live integration suite:

```bash
make test-live
# equivalent:
pnpm run test:live
```

These live commands are read-only dry-runs. They do not broadcast an extrinsic.
The `live:xcm:cli` handoff supports SCALE-encoded `--call` input by default and
raw `--xcm` input when `CARTOGRAPHER_IT_XCM_FILE` is set. It also passes
`CARTOGRAPHER_IT_REGISTRY` and `CARTOGRAPHER_IT_MAX_DEPTH` through to the CLI
when configured. Treat it as raw-XCM or multi-hop proof only when those inputs
are real files/env values for the route under test.

`pnpm test:it` and `pnpm test:debug-flow` are permissive by design and skip live
cases when env vars are missing. `pnpm run live:xcm:test`,
`pnpm run live:xcm:cli`, and `pnpm run test:live` are live handoff commands:
they check required env vars first and fail fast when an input is missing or
still set to an example placeholder.

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

Raw-XCM CLI handoff:

```bash
CARTOGRAPHER_IT_RPC='wss://asset-hub-polkadot-rpc.example' \
CARTOGRAPHER_IT_XCM_ORIGIN='{"parents":1,"interior":"Here"}' \
CARTOGRAPHER_IT_XCM_FILE='./program.json' \
pnpm run live:xcm:cli
```

Raw-XCM or call handoff with a static multi-hop registry:

```bash
CARTOGRAPHER_IT_REGISTRY='./registry.json' \
CARTOGRAPHER_IT_MAX_DEPTH='4' \
pnpm run live:xcm:cli
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
- For the field-level capture checklist, see
  [`docs/prompts/0002-live-corpus-capture.md`](./prompts/0002-live-corpus-capture.md).

## Promoting Scrubbed Evidence

After capturing live evidence, scrub endpoint, account, and call values before
promotion. The fixture helper reads mixed command logs and extracts
`CARTOGRAPHER_IT_EVIDENCE` blocks:

```bash
pnpm --silent run evidence:fixture -- \
  _workspace/live-corpus/example.scrubbed.log \
  > src/diagnostics/__fixtures__/live-evidence.generated.ts
```

It also reads from stdin when no log path is provided:

```bash
pnpm --silent run evidence:fixture < _workspace/live-corpus/example.scrubbed.log \
  > src/diagnostics/__fixtures__/live-evidence.generated.ts
```

The same helper is available through `make evidence-fixture INPUT=<log-path>`
when using the local Make shortcuts, or through `make evidence-fixture < <log>`
for stdin-based promotion.

Review the generated fixture before committing. It preserves the captured
`normalizedEffects` payload and does not treat unreviewed raw payloads as source
truth.

## Continuous Integration

The CI workflow runs on pull requests, pushes to `main`, and manual dispatch.

- `quality`: Node 22.x and 24.x matrix for lint/complexity, typecheck, unit
  tests, dependency boundaries, and build.
- `coverage`: global 70% floor for statements, branches, functions, and lines
  over `src/` and non-test `scripts/`.
- `workflow-lint`: `actionlint` over `.github/workflows/*.yml`.
- `ci-success`: required rollup that fails if any required CI job failed.

The dependency audit workflow runs `pnpm audit --prod --audit-level moderate` on
dependency file changes, a weekly schedule, and manual dispatch.
