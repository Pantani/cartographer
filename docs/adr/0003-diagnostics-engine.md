# ADR-0003 — Diagnostics Engine

- Status: Accepted
- Date: 2026-06-27
- Deciders: project owner

## Context

The product's differentiator is translating raw XCM effects into a human root
cause. A naive implementation is a large branching function over error variants —
which would blow the cyclomatic-complexity ceiling (10) and be painful to extend.

## Decision

Model diagnostics as a **data-driven rule registry**: an ordered list of small,
pure rules. The engine walks the list and returns the first match; if none match,
it returns a structured `unknown` diagnosis carrying the raw effects for the user
to inspect.

```ts
// types/ (sketch — finalize during implementation)
interface DiagnosisContext {
  readonly effects: DryRunEffects;   // normalized from CallDryRunEffects
  readonly events: NormalizedEvent[];
  readonly fees?: FeeEstimate;
}

interface Diagnosis {
  readonly status: "success" | "failure" | "unknown";
  readonly ruleId?: string;
  readonly rootCause?: string;        // human sentence
  readonly explanation?: string;      // why it happened, in plain language
  readonly suggestions?: string[];    // concrete next steps
}

interface DiagnosticRule {
  readonly id: string;
  readonly matches: (ctx: DiagnosisContext) => boolean;
  readonly explain: (ctx: DiagnosisContext) => Diagnosis;
}
```

The engine:

```ts
// diagnostics/engine.ts (sketch)
export function diagnose(
  ctx: DiagnosisContext,
  rules: readonly DiagnosticRule[],
): Diagnosis {
  for (const rule of rules) {
    if (rule.matches(ctx)) return rule.explain(ctx);
  }
  return unknownDiagnosis(ctx);
}
```

Per-rule complexity stays trivially under 10. Adding a diagnosis means adding a
rule object, never editing a switch. Order encodes specificity (most specific
first).

## Initial rule set (failure modes of record)

Each maps to a known XCM failure mode. Seed these; refine matchers against real
fixtures captured from dry-runs.

| id                     | Failure mode                                   | Suggestion direction                          |
|------------------------|------------------------------------------------|-----------------------------------------------|
| `barrier-blocked`      | Entry barrier rejected the message             | Check origin trust / allowed-origin config    |
| `insufficient-weight`  | `BuyExecution` bought too little weight        | Raise weight limit; show needed vs bought     |
| `asset-trapped`        | Assets left in holding (missing `DepositAsset`)| Add deposit; surface trapped asset + location |
| `untrusted-reserve`    | Reserve/teleport trust mismatch                | Show expected trusted reserve for the asset   |
| `version-mismatch`     | XCM version conversion failed                  | Align versions; show source/target version    |
| `fees-unpayable`       | Fee asset not accepted / balance too low       | Show accepted fee assets on destination       |

## Testing strategy

- Each rule gets a fixture: a captured `DryRunEffects` (success and failing
  variants) → asserted `Diagnosis`. Pure, no network.
- A small corpus of real dry-run outputs is committed under
  `diagnostics/__fixtures__/` as the regression baseline.
- `unknown` is a first-class outcome and is tested too: an unrecognized failure
  must still produce a useful raw dump, never a crash.

## Consequences

- Extensible by contributors without touching the engine.
- Honest by construction: when we don't know, we say `unknown` and show the raw
  effects rather than guessing a cause.
- The matchers depend on the exact shape of normalized effects/events; that
  normalization (in `client/` → `types/`) is the contract the rules rely on, and
  must be versioned with care.

## Alternatives considered

- **Big `switch` over error enums.** Rejected: violates CC ceiling, hard to
  extend, couples all diagnoses into one unit.
- **ML/heuristic classification.** Rejected: opaque, unverifiable, and overkill —
  the failure modes are finite and well-defined.
