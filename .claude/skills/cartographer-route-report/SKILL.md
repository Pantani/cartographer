---
name: cartographer-route-report
description: "Use for Cartographer route reporting work: human/JSON multi-hop output, hop list rendering, failing-hop display, report fixtures, snapshots, route docs, reruns, updates, fixes, and result improvements. Do not use for network/client changes."
---

# Cartographer Route Report

Use this skill when changing `src/report/**` for multi-hop or route visibility.

## Workflow
1. Read `src/types/trace.ts`, `src/report/**`, and current report fixtures.
2. Render the existing `TraceResult.hops` shape first.
3. Add or update fixtures before changing snapshot output.
4. Show for each hop:
   - hop index and chain reference
   - execution verdict and diagnosis
   - forwarded destinations/messages when present
   - fees when available
5. If a tree shape is required instead of a list, stop and update the ADR/types
   plan before changing report semantics.

## File Ownership
- `src/report/**`
- `src/report/__fixtures__/**`
- `src/report/__snapshots__/**`

## Output
Write `_workspace/07_route_report.md` with fixture changes, snapshot rationale,
and commands run.

## Done Criteria
- Report remains pure.
- Human and JSON output expose the failing hop clearly.
- Snapshot diffs are intentional and reviewed.
