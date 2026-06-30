# Local Chopsticks XCM Infrastructure

This directory contains the default local/forked topology used by Cartographer's local XCM harness.

## Default Topology

| Role | Config | Local endpoint |
| --- | --- | --- |
| Origin parachain | `westend-asset-hub.yml` | `ws://127.0.0.1:8000` |
| Destination parachain | `westend-people.yml` | `ws://127.0.0.1:8001` |
| Relay chain | `westend.yml` | `ws://127.0.0.1:8002` |

The configs are based on the official Chopsticks examples and add fixed local ports, local SQLite database paths, and `mock-signature-host: true`.

## Commands

```bash
make infra-up
make infra-status

# Generates the default local SCALE XCM call when CARTOGRAPHER_LOCAL_CALL is unset.
make xcm-send

make xcm-test
make xcm-cli
make infra-down
```

Equivalent `pnpm` scripts are available:

```bash
pnpm run infra:up
pnpm run infra:status
pnpm run xcm:send
pnpm run xcm:test
pnpm run xcm:cli
pnpm run infra:down
```

## What This Proves

- `infra-up` starts a local/forked relay/parachain XCM setup through `chopsticks xcm`.
- `xcm-send` signs and submits the generated or configured call to the local origin endpoint with a local dev signer.
- `xcm-test` checks local process/RPC health and reads the saved send evidence.
- `xcm-cli` runs the built Cartographer CLI against the local origin endpoint and the same call.

This is not public network broadcast. It changes only the local fork state managed by Chopsticks. Runtime API dry-runs remain a separate `live:*` workflow.

## Configuration

Override defaults with environment variables:

- `CARTOGRAPHER_LOCAL_RELAY_CONFIG`
- `CARTOGRAPHER_LOCAL_PARACHAIN_CONFIGS` (comma-separated)
- `CARTOGRAPHER_LOCAL_STATE_DIR`
- `CARTOGRAPHER_LOCAL_EVIDENCE_DIR`
- `CARTOGRAPHER_LOCAL_ORIGIN_RPC`
- `CARTOGRAPHER_LOCAL_DEST_RPC`
- `CARTOGRAPHER_LOCAL_RELAY_RPC`
- `CARTOGRAPHER_LOCAL_ACCOUNT`
- `CARTOGRAPHER_LOCAL_CALL`
- `CARTOGRAPHER_LOCAL_XCM_AMOUNT`

`CARTOGRAPHER_LOCAL_ACCOUNT` is a local dev SURI for signing. `xcm-cli` derives
the matching SS58 account string before calling `DryRunApi`, because the runtime
API origin is not a dev SURI.

`CARTOGRAPHER_LOCAL_CALL` is optional. When it is unset, the harness queries the
local destination parachain id, encodes a default
`PolkadotXcm.limited_teleport_assets` call through the local origin runtime
metadata, and stores the generated SCALE call in the run evidence. When set, it
must be a 0x-prefixed, even-length SCALE call valid on the origin chain.

`CARTOGRAPHER_LOCAL_XCM_AMOUNT` controls the generated call amount and defaults
to `10000000000`.
