# Architecture

This document defines module boundaries and the dependency rules enforced in CI
(`pnpm depcheck`, dependency-cruiser). It also names the quality gates that keep
the Sprint-0 CLI surface shippable. ADR-0001 fixes the high-level decision; this
is the operational detail.

## Module map

```
src/
├── cli/            # entrypoint, arg parsing, command wiring, static registry input
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
 │             │  │
 │             │  └──▶ diagnostics ──▶ types
 │             └─────▶ registry ─────▶ types
 ├──▶ report ───────────────────────▶ types
 └──▶ registry   (static CLI registry input)
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

## Quality gates

The local all-up gate is `pnpm run check` or `make check`. It runs:

1. `pnpm lint` — ESLint over `src/` and `scripts/`; TypeScript sources use
   type-aware rules. Cyclomatic complexity <= 10, cognitive complexity <= 10,
   max nesting depth <= 4, and no explicit `any`.
2. `pnpm typecheck` — `tsc --noEmit` against `tsconfig.json`.
3. `pnpm test` — non-live unit tests only.
4. `pnpm coverage` — non-live coverage over `src/` and `scripts/` with a global
   70% floor for statements, branches, functions, and lines.
5. `pnpm depcheck` — dependency-cruiser layering and cycle checks.
6. `pnpm build` — production TypeScript build.

CI runs the same quality chain on Node 22.x and 24.x, runs coverage as its own
job, lints GitHub Actions workflows with `actionlint`, and rolls those checks up
through `CI Success`. Production dependency audit is separate:
`.github/workflows/dependency-audit.yml` runs `pnpm audit --prod --audit-level
moderate` on dependency changes, on a weekly schedule, and by manual dispatch.

## Why this shape

The value of the product concentrates in `diagnostics/` and `report/` — the
readable explanations and the trace output. Those change most often and must be
unit-testable from fixtures with zero flakiness, which is exactly why they are
pure and isolated from I/O. `client/` is the thin, replaceable boundary to the
chain; `orchestrator/` is the conductor and the only place that knows the whole
flow.

## V2 note (multi-hop)

In V2, `orchestrator/` maintains a hop queue of `(location, xcm)` from each
hop's `forwarded_xcms`, resolves each `location` to an endpoint via `registry/`,
calls `client.dryRunXcm(location, xcm)` there, enqueues new forwards, and
terminates on an empty queue, `maxDepth`, unresolved destination, or repeated
destination/message cycle. The CLI may instantiate a static registry from JSON
and pass it as a trace dependency; endpoint probing and network I/O remain in
`client/`. The result is hop-list-shaped, each hop carrying its own `Diagnosis`.
This is additive: the `TraceResult` is already hop-list-shaped (ADR-0001), so no
restructuring of `diagnostics`/`report` is required — they iterate hops.

Performance guard: cache chain metadata per endpoint in `registry/` so the hop
loop never refetches it (avoid N+1 metadata round-trips).
