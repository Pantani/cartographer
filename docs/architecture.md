# Architecture

This document defines module boundaries and the dependency rules enforced in CI
(`pnpm depcheck`, dependency-cruiser). ADR-0001 fixes the high-level decision;
this is the operational detail.

## Module map

```
src/
├── cli/            # entrypoint, arg parsing, command wiring   (edge)
├── orchestrator/   # trace engine: drive dry-run, collect effects, (V2) chain hops
├── client/         # PAPI wrapper: DryRunApi + XcmPaymentApi over RPC   (only I/O)
├── diagnostics/    # effects → root cause; data-driven rule registry   (pure)
├── report/         # TraceResult → human text / JSON                    (pure)
├── registry/       # (V2) Location → endpoint resolution + metadata cache
└── types/          # shared domain types                                (leaf)
```

## Layering (allowed dependency direction)

```
cli ──▶ orchestrator ──▶ client ──▶ types
                │  │
                │  └──▶ diagnostics ──▶ types
                └─────▶ report ──────▶ types
                       registry ─────▶ types   (used by orchestrator in V2)
```

Read "A ──▶ B" as "A may import B".

## Rules (enforced)

1. **`types/` imports nothing.** It is the leaf. (No cycles can route through it.)
2. **Only `client/` performs network I/O.** `diagnostics/` and `report/` must not
   import `client/`, `orchestrator/`, PAPI, or any network library. They receive
   normalized data and stay pure.
3. **`client/` may not import `orchestrator/` or `cli/`.** Lower layers never
   depend on higher ones.
4. **Nothing imports `cli/`.** It is the top edge.
5. **No cycles** between any modules.
6. **PAPI types do not leak past `client/`.** Other modules consume `types/`
   domain models only, so an upstream PAPI change is contained.

Each rule exists to protect a property: testability without network (rule 2),
acyclic build and reasoning (rules 1, 5), contained blast radius for upstream
breakage (rule 6), and clean layering (rules 3, 4).

## Why this shape

The value of the product concentrates in `diagnostics/` and `report/` — the
readable explanations and the trace output. Those change most often and must be
unit-testable from fixtures with zero flakiness, which is exactly why they are
pure and isolated from I/O. `client/` is the thin, replaceable boundary to the
chain; `orchestrator/` is the conductor and the only place that knows the whole
flow.

## V2 note (multi-hop)

In V2, `orchestrator/` gains a hop loop: maintain a queue of
`(location, xcm)` from each hop's `forwarded_xcms`, resolve each `location` to an
endpoint via `registry/`, `client.dryRunXcm(location, xcm)` there, enqueue new
forwards, terminate on empty queue or `maxDepth`. The result is a hop tree, each
node carrying its own `Diagnosis`. This is additive: the `TraceResult` is already
hop-list-shaped (ADR-0001), so no restructuring of `diagnostics`/`report` is
required — they iterate hops.

Performance guard: cache chain metadata per endpoint in `registry/` so the hop
loop never refetches it (avoid N+1 metadata round-trips).
