# Live Corpus Capture

## Goal

Capture scrubbed `CARTOGRAPHER_IT_EVIDENCE` logs from real API-capable runtime
dry-runs, then promote reviewed `normalizedEffects` fixtures into the
diagnostics corpus. This is the evidence gate for removing the remaining
`TODO(verify:)` notes around PAPI-decoded payload shapes and seed diagnostic
matchers.

## Preconditions

- Use an API-capable WebSocket RPC endpoint.
- Use read-only dry-run inputs only; do not broadcast an extrinsic.
- Export real values, not `.env.example` placeholders.
- Scrub endpoint, account, and call values before committing any captured log.

Required for client evidence:

- `CARTOGRAPHER_IT_RPC`
- `CARTOGRAPHER_IT_ACCOUNT`
- `CARTOGRAPHER_IT_CALL`

Additional labels for success/failure corpus:

- `CARTOGRAPHER_IT_CALL_HAPPY`
- `CARTOGRAPHER_IT_CALL_FAIL`

Required for raw-XCM CLI proof:

- `CARTOGRAPHER_IT_RPC`
- `CARTOGRAPHER_IT_XCM_ORIGIN`
- `CARTOGRAPHER_IT_XCM_FILE`

Optional for route proof:

- `CARTOGRAPHER_IT_REGISTRY`
- `CARTOGRAPHER_IT_MAX_DEPTH`

## Capture Commands

Client-level evidence:

```bash
pnpm run xcm:test | tee _workspace/live-corpus/client.scrub-me.log
```

Raw-XCM CLI handoff:

```bash
pnpm run xcm:cli | tee _workspace/live-corpus/raw-xcm.scrub-me.log
```

Full live gate, after all required call-mode env values are present:

```bash
pnpm run test:live | tee _workspace/live-corpus/full.scrub-me.log
```

After scrubbing:

```bash
pnpm --silent run evidence:fixture -- \
  _workspace/live-corpus/client.scrubbed.log \
  > src/diagnostics/__fixtures__/live-evidence.generated.ts
```

or:

```bash
pnpm --silent run evidence:fixture < _workspace/live-corpus/client.scrubbed.log \
  > src/diagnostics/__fixtures__/live-evidence.generated.ts
```

## TODO Verification Map

| Area | Current blocker | Evidence fields to inspect |
| --- | --- | --- |
| `src/client/papi-shapes.ts` `PapiEventEntry` | `emitted_events` may be nested pallet enum or flattened `{ phase, event }` record. | `rawShape.emittedEventSample`, `rawDryRun.value.emitted_events`, `normalizedEffects.events` |
| `src/client/papi-shapes.ts` `PapiVersionedXcm` | Version tag set and instruction-array shape need generated/live confirmation. | `rawShape.localXcmSample`, `rawShape.forwardedXcmSample`, `normalizedEffects.localXcm`, `normalizedEffects.forwardedXcms` |
| `src/client/normalize.ts` `normalizeEvent` | Event normalization assumes outer pallet enum and inner event enum. | `rawShape.emittedEventSample`, `normalizedEffects.events` |
| `src/client/papi.ts` `locationOriginToArg` | Raw-XCM origin version alignment with program version needs target-runtime proof. | Raw-XCM `pnpm run xcm:cli` result plus input `CARTOGRAPHER_IT_XCM_ORIGIN` and `CARTOGRAPHER_IT_XCM_FILE` |
| `src/diagnostics/rules.ts` seed matchers | Barrier, version, reserve/teleport, weight, fee, and trapped-asset substrings are synthetic until real failures are captured. | `normalizedEffects.executionResult`, `normalizedEffects.events`, `fees` |

## Acceptance Criteria

- At least one success capture and one failure capture are present as scrubbed
  logs under `_workspace/live-corpus/`.
- Each promoted fixture is generated from scrubbed `CARTOGRAPHER_IT_EVIDENCE`
  and reviewed before commit.
- Any removed `TODO(verify:)` is backed by a specific captured fixture or a
  checked generated descriptor.
- `pnpm run check` passes after fixture promotion and diagnostic updates.
- `pnpm run live:check:full` passes only when all required live env values are
  present; otherwise record the missing variables as an input blocker.
