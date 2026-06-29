# Go Runtime API Smoke Spike

This is an isolated Go spike for testing whether Go can become a credible
Cartographer runtime API client stack. It must not modify the main TypeScript
implementation under `src/`.

Current acceptance is scaffolding only unless a live run returns real decoded
evidence from the required runtime APIs. A passing unit-test run proves the spike
is wired correctly; it does not prove Go can replace the PAPI client layer.

## Current State

Proven by the integrated spike so far:

- environment parsing and invalid-env guardrails for the smoke CLI;
- stable JSON evidence envelope rendering;
- raw `state_call` transport helper that can return `rawHex`;
- projected runtime API metadata lookup logic for an already-decoded V15-style
  metadata shape;
- an opt-in `state_getMetadata` diagnostic probe that reports the metadata
  envelope version before accepting or rejecting the decode path;
- an opt-in `Metadata_metadata_at_version` diagnostic probe that can request
  V15/V16 metadata through `state_call`;
- live Polkadot Asset Hub metadata API evidence for V15 and V16 locating
  `XcmPaymentApi.query_acceptable_payment_assets` type IDs;
- candidate acceptable-assets runtime API arguments for pinned XCM versions
  `2..5`, including `xcm_version = 4` as `0x04000000`;
- a committed no-network Polkadot Asset Hub V16 metadata fixture;
- live Polkadot Asset Hub `XcmPaymentApi_query_acceptable_payment_assets`
  evidence for V16 metadata and `xcm_version = 5`;
- decoded `Ok(Vec<VersionedAssetId>)` return evidence for the live
  acceptable-assets response.

Not proven:

- proving a V14 route for runtime API `apis[].methods[].inputs/output`;
- full `DryRunApi` and fee runtime API coverage;
- live Go support for Cartographer's runtime API client boundary.

Trusted endpoints checked for this spike currently return RuntimeMetadata V14
from `state_getMetadata`. The probe reporting `status: "blocked"` with
`metadataVersion: 14` is expected diagnostic behavior from the current decoder,
not a failed command. V14 is retained only as a rejection guardrail because the
source-backed V14 metadata shape has `types`, `pallets`, `extrinsic`, and `ty`,
but no runtime API `apis` section. The viable path is requesting V15/V16
metadata through the `Metadata` runtime API via `state_call`, then using the
decoded type IDs to drive the next runtime API call/decode gate.

The current gate has moved past runtime API metadata method lookup and the live
acceptable-assets runtime call/decode for Polkadot Asset Hub. Raw transport is
not the blocker.

This step covers only the current acceptable-assets live-probe pendencies:

1. fixture status;
2. Asset Hub metadata lookup status;
3. the next live acceptable-assets call/decode gate;
4. explicit boundaries for what this step does not decide.

Comparison with the TypeScript/PAPI implementation and any ADR decision about a
Go migration or Go/TypeScript split are out of scope for this step.

## Metadata Fixture Gate

This spike includes one real V14 rejection fixture and one real V16 runtime API
fixture from Polkadot Asset Hub:

- `internal/metadatadecode/testdata/polkadot_asset_hub_runtime_metadata_v14.hex`
- `internal/metadatadecode/testdata/polkadot_asset_hub_runtime_metadata_v14.manifest.json`
- `internal/metadatadecode/testdata/polkadot_asset_hub_runtime_metadata_v16.hex`
- `internal/metadatadecode/testdata/polkadot_asset_hub_runtime_metadata_v16.manifest.json`

The V14 fixture is a no-network guardrail proving that the current decoder
rejects the RuntimeMetadata V14 returned by trusted endpoints. It is not V14
support and it is not migration evidence.

The V16 fixture was captured with `Metadata_metadata_at_version(16)` and stripped
to the inner complete SCALE-encoded `OpaqueMetadata` payload. Its manifest pins
the exact bytes:

- decoded metadata version: `16`;
- runtime API count in the current projection: `28`;
- method evidence:
  `XcmPaymentApi.query_acceptable_payment_assets(xcm_version: TypeID 14) ->
  TypeID 1020`;
- SHA-256:
  `1686a6b95a3734b05fe73f09cd7c7e5c24fbb2dd60a8619d11b608c107790c31`.

Any future fixture must be a real, complete SCALE-encoded runtime metadata
payload. Synthetic projections are useful unit-test fixtures, but they do not
count as migration evidence. Commit or reference the fixture with:

- source endpoint, chain, and capture date;
- SHA-256 of the exact SCALE metadata bytes;
- decoded metadata version;
- a no-network reuse path for Go unit tests.

The current source-backed decision is that V14 does not carry the runtime API
method input/output metadata needed by this spike. Do not implement a blind V14
runtime API parser. Keep looking for a verified V15/V16 source or use a
PAPI/descriptor bridge for the runtime API metadata boundary.

Primary source anchors for this gate:

- `sp_api::Metadata` exposes `metadata_versions()` and
  `metadata_at_version(version: u32) -> Option<OpaqueMetadata>`:
  <https://raw.githubusercontent.com/paritytech/polkadot-sdk/master/substrate/primitives/api/src/lib.rs>
- `frame-metadata` V14 has no `apis` field:
  <https://raw.githubusercontent.com/paritytech/frame-metadata/main/frame-metadata/src/v14.rs>
- `frame-metadata` V15/V16 include `apis`, runtime API methods, method inputs,
  and method output type metadata:
  <https://raw.githubusercontent.com/paritytech/frame-metadata/main/frame-metadata/src/v15.rs>
  and
  <https://raw.githubusercontent.com/paritytech/frame-metadata/main/frame-metadata/src/v16.rs>

The standalone `state_getMetadata` probe is:

```bash
cd spikes/go-runtime-api-smoke
rtk proxy go run ./cmd/cartographer-go-metadata-probe --rpc https://...
```

Exact Polkadot Asset Hub diagnostic command:

```bash
cd spikes/go-runtime-api-smoke
rtk proxy go run ./cmd/cartographer-go-metadata-probe \
  --rpc https://polkadot-asset-hub-rpc.polkadot.io
```

Expected current interpretation when it returns V14:

```json
{
  "status": "blocked",
  "metadataVersion": 14,
  "error": "unsupported metadata version: 14"
}
```

or:

```bash
cd spikes/go-runtime-api-smoke
CARTOGRAPHER_METADATA_RPC_HTTP='https://...' \
  rtk proxy go run ./cmd/cartographer-go-metadata-probe
```

It is an opt-in diagnostic that performs only HTTP JSON-RPC
`state_getMetadata`. It exits with `status: "blocked"` when the endpoint,
response shape, metadata version, or decode path is not proven. A blocked probe
result with `metadataVersion: 14` is the expected result for the currently
trusted endpoints. A partial or network-only response is not acceptance
evidence.

## Metadata Runtime API Probe

The metadata-version probe command calls the runtime's `Metadata` API through
HTTP JSON-RPC `state_call`:

```bash
cd spikes/go-runtime-api-smoke
rtk proxy go run ./cmd/cartographer-go-metadata-version-probe \
  --rpc https://polkadot-asset-hub-rpc.polkadot.io \
  --version 16
```

Current Polkadot Asset Hub V16 result:

```json
{
  "status": "ok",
  "requestedVersion": 16,
  "returnedMetadataVersion": 16,
  "runtimeApiCount": 28,
  "method": {
    "api": "XcmPaymentApi",
    "name": "query_acceptable_payment_assets",
    "params": [
      {
        "name": "xcm_version",
        "typeId": 14
      }
    ],
    "outputTypeId": 1020
  }
}
```

V15 also works against the same endpoint, but with a different output type ID:
`1003`. Prefer V16 for new evidence unless a target runtime only exposes V15.

A successful metadata-version probe decodes the returned V15/V16 metadata into
`metadata.apis`, then shows the target runtime API method name, method inputs,
and output type ID. This is necessary metadata evidence, but it is not yet full
Go migration evidence because it does not call or decode the target runtime API
business result.

Go starts to count as migration evidence only after the spike decodes all of
the following from real metadata and live/runtime output:

- runtime API method name plus input and output type IDs for the method under
  test;
- SCALE return bytes into the outer runtime API result;
- inner runtime API return value, including a decoded typed error when the
  runtime reports one.

## Current Acceptable-Assets Gate

The current passed gate for Polkadot Asset Hub covers metadata lookup plus the
live acceptable-assets runtime call:

- `Metadata_metadata_at_version(16)` returns RuntimeMetadata V16;
- the decoded metadata exposes `XcmPaymentApi.query_acceptable_payment_assets`;
- the method parameter is `xcm_version` with type ID `14`;
- the method output type ID is `1020`;
- the probe uses the discovered method shape before encoding
  `xcm_version = 5` as `0x05000000`;
- `XcmPaymentApi_query_acceptable_payment_assets` returns `Ok`;
- the live return decodes to `83` V5 `VersionedAssetId` entries on the checked
  Polkadot Asset Hub endpoint.

Reproduce the live gate:

```bash
cd spikes/go-runtime-api-smoke
rtk proxy go run ./cmd/cartographer-go-acceptable-assets-probe \
  --rpc https://polkadot-asset-hub-rpc.polkadot.io \
  --metadata-version 16 \
  --xcm-version 5
```

The command performs two HTTP JSON-RPC `state_call` requests:

1. `Metadata_metadata_at_version` with args `0x10000000`;
2. `XcmPaymentApi_query_acceptable_payment_assets` with args `0x05000000`.

It decodes the `Result<Vec<VersionedAssetId>, Error>` response. The current
decoder records source-backed XCM `Location` evidence for the returned V3/V4/V5
asset IDs, including `Junctions`, `PalletInstance`, `GeneralIndex`,
`Parachain`, `GlobalConsensus`, `AccountKey20`, and `GeneralKey` payloads.

## Scope

The spike should answer one narrow question:

Can Go call and decode the Cartographer-critical runtime APIs against a live
API-capable chain without falling back to lossy strings or hand-wavy placeholders?

Runtime APIs in scope:

- `DryRunApi_dry_run_call`
- `XcmPaymentApi_query_xcm_weight`
- `XcmPaymentApi_query_acceptable_payment_assets`
- `XcmPaymentApi_query_weight_to_asset_fee`

If a method name, argument encoding, return type, or decoded field shape is not
verified from primary sources or live evidence, the spike output must keep a
`TODO(verify:)` marker instead of pretending the behavior is known.

## Unit Tests

From the isolated module:

```bash
cd spikes/go-runtime-api-smoke
rtk proxy go test -count=1 ./...
```

Expected result for scaffolding acceptance: all Go unit tests pass. These tests
cover local parsing, evidence rendering, and coordinator behavior. They do not
prove live runtime API compatibility.

Run the repo lint gate from the repository root after README edits:

```bash
rtk proxy pnpm lint
```

The metadata probe command is diagnostic only:

```bash
cd spikes/go-runtime-api-smoke
rtk proxy go run ./cmd/cartographer-go-metadata-probe
# {"status":"error","error":"missing --rpc or CARTOGRAPHER_METADATA_RPC_HTTP"}
```

Do not substitute the smoke CLI below for `state_getMetadata`; it currently
emits blocked runtime API evidence until metadata-driven encoding and return
decoding are proven.

## Invalid Environment Check

Run the CLI without integration-test environment variables:

```bash
cd spikes/go-runtime-api-smoke
rtk proxy go run ./cmd/cartographer-go-smoke
```

Expected invalid-env behavior:

- exits non-zero before any live RPC call;
- reports the missing required inputs;
- does not emit successful runtime API evidence.

Required inputs for a live smoke run are:

- `CARTOGRAPHER_IT_RPC`: WebSocket RPC endpoint for an API-capable chain.
- `CARTOGRAPHER_IT_ACCOUNT`: account/address used as the dry-run origin.
- `CARTOGRAPHER_IT_CALL`: `0x`-prefixed encoded call bytes.

## Live Smoke Run

Run with explicit live inputs:

```bash
cd spikes/go-runtime-api-smoke
CARTOGRAPHER_IT_RPC='wss://example.invalid' \
CARTOGRAPHER_IT_ACCOUNT='5ExampleAccount' \
CARTOGRAPHER_IT_CALL='0x00000000' \
rtk proxy go run ./cmd/cartographer-go-smoke
```

`CARTOGRAPHER_IT_RESULT_XCM_VERSION` is optional. When omitted, the spike should
use its default result XCM version:

```bash
cd spikes/go-runtime-api-smoke
CARTOGRAPHER_IT_RPC='wss://example.invalid' \
CARTOGRAPHER_IT_ACCOUNT='5ExampleAccount' \
CARTOGRAPHER_IT_CALL='0x00000000' \
CARTOGRAPHER_IT_RESULT_XCM_VERSION='4' \
rtk proxy go run ./cmd/cartographer-go-smoke
```

Replace the example endpoint, account, and call bytes with values already used
for Cartographer live integration testing. Do not treat a network connection or
raw RPC response as success by itself.

## Evidence Interpretation

A useful live result must include decoded evidence for the runtime APIs in scope.
For `DryRunApi_dry_run_call`, that means decoded dry-run effects rather than a
plain raw blob. For `XcmPaymentApi`, that means decoded payment/weight evidence
for the queried methods rather than placeholder text.

A successful `state_call` round trip is only the next transport/SCALE proof
point. It proves migration value only after the spike shows the exact runtime
API arguments are SCALE-encoded correctly and the returned bytes are decoded
into the expected runtime API shapes.

`rawHex` alone is not acceptance or migration evidence. A raw response is useful
only as a transport artifact while the spike is still blocked on return
decoding. Partial raw payload preservation is acceptable only when the field is
clearly labeled as raw/partial diagnostic data and the decoded acceptance fields
remain visibly absent.

## Recommended Next Probe

Start with `XcmPaymentApi_query_acceptable_payment_assets` before attempting
`DryRunApi_dry_run_call`. The Polkadot SDK rustdoc for
`xcm_runtime_apis::fees::XcmPaymentApi::query_acceptable_payment_assets`
documents the smallest useful payment API shape: it takes `xcm_version:
Version` and returns `Result<Result<Vec<VersionedAssetId>, Error>, ApiError>`.

For the Go spike, success means:

- live metadata locates the runtime API method and its input/output type IDs;
- the `Version` argument is encoded as the runtime API SCALE argument tuple;
- `state_call` returns bytes for `XcmPaymentApi_query_acceptable_payment_assets`;
- the returned bytes are decoded into the outer runtime API result and inner
  acceptable-assets result, including any typed `Error`;
- evidence contains decoded `VersionedAssetId` values or a decoded typed error,
  not only `rawHex`.

Treat the probe as blocked or failed if the spike cannot locate the method in
metadata, cannot encode/decode without brittle hand-written runtime-specific
types, only returns `rawHex`, or cannot distinguish transport failure, outer
`ApiError`, and inner `XcmPaymentApi` `Error`.

Interpret output this way:

- `status: "ok"` with decoded fields: potential Go migration evidence.
- `status: "blocked"` with `TODO(verify:)`: known gap, not migration evidence.
- `rawHex` without decoded fields: transport evidence only, not acceptance.
- invalid-env output: expected guardrail behavior, not live evidence.
- test pass without live env: scaffolding acceptance only.

Any `TODO(verify:)` result must be preserved until the exact method name,
argument encoding, SCALE decode shape, and source of truth are verified. Do not
remove a marker because the output "looks plausible".

## Out of Scope for This Step

This acceptable-assets live-probe step does not compare the Go spike output with
the TypeScript/PAPI evidence contract and does not make an ADR-level client
language decision. Those remain later gates after the acceptable-assets live call
and return decode produce decoded evidence.
