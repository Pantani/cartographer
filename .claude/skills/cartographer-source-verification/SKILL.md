---
name: cartographer-source-verification
description: "Use for every Cartographer task that mentions PAPI, polkadot-api, DryRunApi, XcmPaymentApi, Chopsticks, runtime APIs, XCM versions, payload shapes, docs verification, TODO(verify), or ADR source truth. Mandatory before changing API call shapes or removing verification TODOs."
---

# Cartographer Source Verification

Use this skill before code or docs make claims about XCM, runtime APIs, PAPI, or
Chopsticks. The repo explicitly forbids unattributed protocol claims.

## Workflow
1. Read `CLAUDE.md`, `docs/adr/0001-scope-and-architecture.md`, and the affected
   source file.
2. For library/API documentation, use Context7 first: resolve the library ID with
   the library name and the full question, then query docs with the same question.
3. Prefer primary sources: official PAPI docs, polkadot-sdk source, crate docs,
   or docs.rs. Use secondary sources only to locate primary material.
4. Record each verified fact with:
   - method or type name
   - source URL/path
   - exact local impact
   - whether ADR-0001 still matches
5. If reality differs from ADR-0001, update the ADR in the same PR or stop that
   implementation slice.
6. If a detail remains unverified, leave `TODO(verify): <what + where to check>`
   in the narrowest affected file.

## Output
Write findings to `_workspace/01_source_verification_findings.md`:

```markdown
# Source Verification Findings

## Verified
- Fact:
- Source:
- Local impact:

## Differs From ADR
- Fact:
- Required ADR update:

## Unverified
- Unknown:
- Next source to check:
- Local TODO:
```

## Done Criteria
- Every implementation-facing claim is backed by a source or marked TODO(verify).
- No downstream agent needs to guess a runtime API method shape.
