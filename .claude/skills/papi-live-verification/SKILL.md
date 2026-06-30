---
name: papi-live-verification
description: "Use for Cartographer PAPI live-truth work: verifying polkadot-api DryRunApi/XcmPaymentApi calls, descriptor setup, decoded payload capture, TODO(verify:) closure, and client normalizer fixes. Trigger on PAPI, live RPC, dry_run_call, XcmPaymentApi, descriptors, payload shapes, or client boundary next steps."
---

# PAPI Live Verification

Use this skill when the task touches Cartographer's live PAPI boundary.

## Goal
Replace assumptions in `src/client/` with source-backed and live-captured truth while keeping PAPI contained to the client layer.

## Required Sources
1. Read `CLAUDE.md`, `docs/architecture.md`, ADR-0001, and ADR-0002.
2. Use Context7 for `polkadot-api` docs when available.
3. If Context7 is unavailable, use official PAPI docs and polkadot-sdk rustdoc. Record URLs in `_workspace/01_papi_live_verification.md`.

## Workflow
1. Inventory current `TODO(verify:)` items under `src/client/**` and integration tests.
2. Select one API-capable system chain and record endpoint, descriptor source, runtime version, and commands.
3. Verify PAPI setup:
   - connection creation
   - descriptor or unsafe API path
   - `txFromCallData` or equivalent call decoding
   - `DryRunApi.dry_run_call` argument order
   - `XcmPaymentApi` fee sequence
4. Run unit tests before live changes. If behavior changes, write or update a failing unit test first.
5. Run live integration only through opt-in env vars and `rtk pnpm test:it`.
6. Store captured payload evidence in `_workspace/` first. Commit fixture changes only after removing secrets/endpoints that should not be committed.
7. Patch only `src/client/**` unless the orchestrator approves a contract re-sync.

## Acceptance Evidence
- `rtk pnpm lint`
- `rtk pnpm typecheck`
- `rtk pnpm depcheck`
- `rtk pnpm test`
- `rtk pnpm test:it` with clear distinction between skipped and live-run tests

## Stop Conditions
- A runtime API signature differs from ADR-0001.
- A needed domain field is missing from `src/types/`.
- Official docs and live payload disagree.

In each case, stop and ask the orchestrator for a decision. Do not guess.
