---
name: cartographer-next-steps-orchestrator
description: "Orchestrates Cartographer next-step implementation with parallel agents: live PAPI verification, dry-run corpus, diagnostics, raw --xcm, registry, multi-hop tracing, route reporting, debug-flow QA, reruns, updates, fixes, partial re-execution, previous result improvements, and final acceptance. Use this for any non-trivial Cartographer implementation continuation."
---

# Cartographer Next Steps Orchestrator

Coordinate the agent team that moves Cartographer from the current Sprint-0
single-hop surface through raw XCM and V2 multi-hop readiness.

## Execution Mode: Hybrid

- Claude Team mode: use TeamCreate, SendMessage, and TaskCreate when available.
  Team members must be called with `model: "opus"`.
- Codex fallback: use `spawn_agent` subagents in parallel for independent
  analysis or disjoint write scopes. In Codex `multi_agent_v1`, omit model
  overrides unless the user explicitly requests one because the tool has no
  `opus` alias and inherits the parent model by platform policy.

## Agent Team

| Agent | Type | Role | Skill | Primary Output |
| --- | --- | --- | --- | --- |
| `cartographer-source-verifier` | custom/Explore | Source truth for APIs | `cartographer-source-verification` | `_workspace/01_source_verification_findings.md` |
| `cartographer-live-corpus-builder` | custom/general-purpose | Live evidence and fixtures | `cartographer-live-corpus` | `_workspace/02_dry-run-corpus_evidence.md` |
| `cartographer-diagnostics-refiner` | custom/worker | Diagnostics rules and fixtures | `cartographer-diagnostics` | `_workspace/03_diagnostics_refinement.md` |
| `cartographer-raw-xcm-builder` | custom/worker | Raw `--xcm` support | `cartographer-raw-xcm` | `_workspace/04_raw_xcm_implementation.md` |
| `cartographer-debug-flow-builder` | custom/general-purpose | CLI debug-flow proof | `cartographer-debug-flow` | `_workspace/05_debug_flow_evidence.md` |
| `cartographer-multihop-planner` | custom/worker | Registry and hop loop | `cartographer-multihop` | `_workspace/06_multihop_implementation.md` |
| `cartographer-route-report-builder` | custom/worker | Route output rendering | `cartographer-route-report` | `_workspace/07_route_report.md` |
| `cartographer-qa-gatekeeper` | custom/general-purpose | Incremental and final QA | `cartographer-qa-gates` | `_workspace/08_qa_audit.md` |

## Launch Template

### Claude Team Mode

Use one active team and task list:

```text
TeamCreate(
  team_name: "cartographer-next-steps",
  members: [
    { name: "cartographer-source-verifier", agent_type: "cartographer-source-verifier", model: "opus" },
    { name: "cartographer-live-corpus-builder", agent_type: "cartographer-live-corpus-builder", model: "opus" },
    { name: "cartographer-diagnostics-refiner", agent_type: "cartographer-diagnostics-refiner", model: "opus" },
    { name: "cartographer-raw-xcm-builder", agent_type: "cartographer-raw-xcm-builder", model: "opus" },
    { name: "cartographer-debug-flow-builder", agent_type: "cartographer-debug-flow-builder", model: "opus" },
    { name: "cartographer-multihop-planner", agent_type: "cartographer-multihop-planner", model: "opus" },
    { name: "cartographer-route-report-builder", agent_type: "cartographer-route-report-builder", model: "opus" },
    { name: "cartographer-qa-gatekeeper", agent_type: "cartographer-qa-gatekeeper", model: "opus" }
  ]
)
```

Create tasks with explicit dependencies: source verification and baseline QA
first; raw XCM after source verification; diagnostics after corpus captures;
multi-hop after raw XCM and registry readiness; route report after trace shape;
final QA last.

### Codex Fallback

Use `spawn_agent` only for independent analysis or disjoint write scopes. Do not
run overlapping writers in parallel. A safe first fan-out is:

- source verifier: read-only source/API truth
- live corpus builder: env inspection and evidence plan
- QA gatekeeper: baseline command plan

After those return, dispatch implementation workers one lane at a time or with
non-overlapping ownership.

## Phase 0: Context Check

1. Read `CLAUDE.md`, `AGENTS.md`, `ROADMAP.md`, `docs/architecture.md`, and
   `docs/usage.md`.
2. Check `_workspace/`:
   - missing: initial run
   - present + partial user request: rerun only affected agent(s)
   - present + new broad input: move existing `_workspace/` to
     `_workspace_YYYYMMDD_HHMMSS/`, then create a fresh `_workspace/`
3. Check git state. If in a detached worktree, avoid branch/commit claims until
   a branch is created by explicit user request.

## Phase 1: Baseline and Source Truth

Run in parallel when possible:
- `cartographer-source-verifier`: verify current PAPI/runtime API facts for any API surface
  the next task will touch.
- `cartographer-qa-gatekeeper`: run a baseline non-live gate or the narrowest safe
  subset and record current status.
- `cartographer-live-corpus-builder`: inspect env availability and identify whether live
  proof can run now.

No implementation agent may remove a TODO(verify) or enable `--xcm` before the
source-verification output exists.

## Phase 2: Raw XCM Lane

Dependency: Phase 1 source verification.

1. Assign `cartographer-raw-xcm-builder` ownership of `src/client/**`, `src/cli/**`,
   `src/orchestrator/trace.ts`, `src/types/request.ts`, and focused tests.
2. Require failing tests before code changes.
3. Keep `--call` behavior unchanged.
4. Ask `cartographer-qa-gatekeeper` for incremental QA after client boundary and
   CLI boundary are both wired.
5. If runtime API details remain unverified, keep `--xcm` guarded and document
   the blocker.

## Phase 3: Corpus and Diagnostics Lane

Can run in parallel with pure implementation when env is available.

1. `cartographer-live-corpus-builder` captures success/failure output and
   `CARTOGRAPHER_IT_EVIDENCE`.
2. Promote only scrubbed fixtures.
3. Assign `cartographer-diagnostics-refiner` to refine diagnostics rules only
   against verified captures.
4. Report missing env vars as blocked live proof, not as a failed implementation.

## Phase 4: Multi-Hop Lane

Dependency: usable `client.dryRunXcm` or a pure fake-client test seam.

1. Assign `cartographer-multihop-planner` ownership of `src/registry/**`,
   `src/orchestrator/**`, registry fixtures, and multi-hop tests.
2. Implement registry resolution and cache before the hop loop.
3. Add hop queue, `maxDepth`, and cycle guard with fake-client tests.
4. Run incremental QA before live multi-hop proof.

## Phase 5: Route Report Lane

Dependency: stable multi-hop trace shape.

1. Assign `cartographer-route-report-builder` ownership of `src/report/**`,
   report fixtures, and snapshots.
2. Render the existing `TraceResult.hops` shape first.
3. Make ordered route, forwarded messages, and failing hop visible in human and
   JSON output.
4. If a branching tree shape becomes necessary, update `types/` and ADR-0001
   before changing report semantics.

## Phase 6: Final QA and Handoff

1. `cartographer-qa-gatekeeper` runs `pnpm run check`.
2. If env vars are present, run the relevant live proof commands from
   `docs/usage.md`.
3. Summarize:
   - code/files changed
   - commands and exit codes
   - live proof status
   - remaining TODO(verify) or env blockers
4. Preserve `_workspace/` for audit.

## Error Handling

| Situation | Strategy |
| --- | --- |
| Agent misses source truth | Stop that slice, rerun source verification, keep TODO(verify). |
| Missing live env | Continue non-live gates, record exact missing vars. |
| Two agents need same file | Serialize work; do not run overlapping writers in parallel. |
| Tests fail | Owner fixes once; QA reruns the exact failing command. |
| ADR mismatch | Update ADR in same PR before code diverges. |
| Local `actionlint` missing | Do not claim workflow lint locally; cite CI evidence or install/run it explicitly. |

## Data Flow

```text
source verification -> raw XCM -> multi-hop registry/hop loop -> route report
        |                  |                 |                     |
        v                  v                 v                     v
 live corpus --------> diagnostics fixtures --------------------> QA gate
```

## Test Scenarios

### Normal Flow
1. User asks to continue Cartographer implementation.
2. Phase 1 verifies source truth and baseline gates.
3. Raw XCM support lands behind tests.
4. Corpus captures live evidence when env is available.
5. Registry and hop loop land with fake-client tests.
6. Route report renders the stable hop shape.
7. QA runs `pnpm run check` and records live-proof status.

### Error Flow
1. `dry_run_xcm` call shape cannot be verified.
2. Raw XCM implementation keeps CLI guard in place and writes TODO(verify).
3. QA accepts only the guarded state, not raw XCM support.
4. Final report lists the exact source/live blocker.
