# Debug-Flow Integration Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated opt-in integration command that proves the complete Cartographer debug flow through CLI success and failure paths.

**Architecture:** The live proof lives at the CLI edge so it can drive the same command a user runs without violating dependency-cruiser rules. It reuses the existing client/orchestrator/report pipeline and remains skipped unless all required live env vars are supplied.

**Tech Stack:** TypeScript, Vitest, Commander, existing Cartographer CLI/orchestrator/client modules, `rtk pnpm` commands.

---

## File Structure

- Modify `package.json`
  - Add `test:debug-flow` script targeting the dedicated debug-flow integration test.
- Create `src/cli/debug-flow.it.test.ts`
  - Drives the real CLI command in JSON mode for success and failure call data.
- Modify `docs/usage.md`
  - Documents command, env vars, and skipped-vs-live interpretation.
- Modify local ignored harness files under `.claude/`
  - Adds debug-flow agent/skill and registers them with the orchestrator.

## Task 1: Debug-Flow Command

**Files:**
- Modify: `package.json`
- Test: shell command

- [ ] **Step 1: Run the missing command first**

```bash
rtk pnpm test:debug-flow
```

Expected: FAIL because the script does not exist yet.

- [ ] **Step 2: Add the script**

```json
"test:debug-flow": "vitest run src/cli/debug-flow.it.test.ts"
```

- [ ] **Step 3: Run command to verify it now targets the missing test**

```bash
rtk pnpm test:debug-flow
```

Expected: FAIL because `src/cli/debug-flow.it.test.ts` does not exist yet.

## Task 2: CLI Debug-Flow Integration Test

**Files:**
- Create: `src/cli/debug-flow.it.test.ts`

- [ ] **Step 1: Add the integration test**

The test must:
- collect `CARTOGRAPHER_IT_RPC`, `CARTOGRAPHER_IT_ACCOUNT`,
  `CARTOGRAPHER_IT_CALL_OK`, and `CARTOGRAPHER_IT_CALL_FAIL`;
- pass in no-env mode with a setup test listing missing env vars;
- in live mode, run `buildProgram()` twice with `--format json`;
- assert success status for the known-good call;
- assert failure status and root cause text for the known-failing call.

- [ ] **Step 2: Run debug-flow test**

```bash
rtk pnpm test:debug-flow
```

Expected without env vars: PASS with the setup test and skipped live tests.

## Task 3: Usage Documentation

**Files:**
- Modify: `docs/usage.md`

- [ ] **Step 1: Document the debug-flow command**

Add a "Full Debug-Flow Proof" subsection with exact env vars and command.

- [ ] **Step 2: Verify docs stay honest**

Confirm docs say no-env success is harness proof only, and live proof requires
all four required env vars.

## Task 4: Final Verification

**Files:**
- All changed files

- [ ] **Step 1: Run gates**

```bash
rtk pnpm lint
rtk pnpm typecheck
rtk pnpm depcheck
rtk pnpm test
rtk pnpm test:debug-flow
rtk pnpm test:it
rtk pnpm build
```

- [ ] **Step 2: Report status**

Report whether `test:debug-flow` ran live cases or only no-env setup.
