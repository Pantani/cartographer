---
name: cartographer-multihop
description: "Use for Cartographer V2 multi-hop work: registry endpoint resolution, metadata cache, forwarded_xcms queue, maxDepth, cycle guard, hop tree, route rendering, multi-hop fixtures, reruns, fixes, updates, and result improvements."
---

# Cartographer Multi-Hop

Use this skill for the V2 differentiator: following `forwarded_xcms` across hops.

## Preconditions
- `client.dryRunXcm` exists or the task is limited to pure planning/tests.
- Registry behavior is specified before network or endpoint assumptions are made.

## Workflow
1. Start with pure tests for registry resolution and hop-loop behavior.
2. Implement `registry/` as the endpoint and metadata-cache boundary.
3. Add orchestrator queue processing:
   - enqueue normalized `forwardedXcms`
   - resolve each destination through `registry/`
   - dry-run each forwarded XCM through `client.dryRunXcm`
   - stop on empty queue, `maxDepth`, unresolved destination, or cycle guard
4. Preserve single-hop behavior and report output.
5. Extend `report/` to show route order, forwarded destinations, and failing hop.
6. Add fixtures for known 2-3 hop traces before relying on live routes.

## File Ownership
- Primary: `src/registry/**`, `src/orchestrator/**`, `src/report/**`, route
  fixtures and tests.
- Coordinate with raw-XCM owner before using `client.dryRunXcm`.

## Done Criteria
- Hop loop is deterministic under fake clients.
- No chain metadata is refetched per hop when cached.
- Dependency-cruiser still accepts module boundaries.
- Unknown or unresolved routes are visible in the trace, not silently dropped.
