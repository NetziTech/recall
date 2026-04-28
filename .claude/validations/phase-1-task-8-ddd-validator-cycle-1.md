# DDD Validator Report — Phase 1, Task 8 (Cycle 1, re-validation)

- **Validator**: ddd-validator
- **Phase**: phase-1-domain
- **Task**: Task 8 — `retrieval` module value-objects (re-validation focused on `MemoryRef`)
- **Cycle**: 1 (post-fix re-audit)
- **Scope**: `code/src/modules/retrieval/domain/value-objects/memory-ref.ts`
- **Verdict**: **APPROVED**

---

## 1. Summary

Cycle 0 rejected `MemoryRef` for a single blocker (#1): the JSDoc declared
`id` as a non-empty string but `MemoryRef.of(...)` did not enforce that
invariant, allowing `""` or `"   "` to slip through and silently break
cross-layer dedup in the bundle assembler (`docs/04-capas-contexto.md`
§4) and the JSON-RPC `MemoryEntry` non-empty `id` contract
(`docs/02-protocolo-mcp.md` §4.3).

The orchestrator applied the minimal fix mirroring the sibling pattern
already in `RankedEntry.of(...)`. The fix is in clean and the contract
is now self-consistent. Re-audit confirms no new violations were
introduced.

The five non-blocking observations from cycle 0 (#2 PriorityBoost ADR,
#3 ContextLayerKind ADR, #4 WORKSPACE_MODE_LABELS drift, #5 redundant
XOR check, #6 BundleId factory) were intentionally deferred to Phase 5
(architect review) as documented in the orchestrator's brief. After
re-reading the file my opinion has not changed on any of them — they
remain quality observations, not Phase-1 blockers — so I do not relist
them here.

---

## 2. Verification of the blocker fix

### Blocker #1 — `MemoryRef.of(...)` did not validate `id` invariant

**Status**: RESOLVED.

**Evidence** (`code/src/modules/retrieval/domain/value-objects/memory-ref.ts:69-73`):

```typescript
if (typeof input.id !== "string" || input.id.trim().length === 0) {
  throw new InvalidInputError("memory ref id must be a non-empty string", {
    field: "id",
  });
}
```

Checks performed:

1. **Code matches the JSDoc contract**. Lines 31-38 now state explicitly
   that `id` "Validated as a non-empty trimmed string in the factory to
   mirror the discipline of `RankedEntry.of(...)` and to prevent
   malformed refs from breaking cross-layer dedup in the bundle
   assembler (`docs/04-capas-contexto.md` §4) or violating the
   non-empty `id` contract of the JSON-RPC `MemoryEntry` payload
   (`docs/02-protocolo-mcp.md` §4.3)." The factory body now enforces
   exactly that. Contract drift gone.

2. **Pattern parity with the sibling VO**. `RankedEntry.of(...)` at
   `code/src/modules/retrieval/domain/aggregates/ranked-entry.ts:83-87`
   uses the identical predicate (`typeof input.id !== "string" ||
   input.id.trim().length === 0`), the identical error type
   (`InvalidInputError`), the identical `{ field: "id" }` metadata
   shape, and an analogous message ("ranked entry id must be a
   non-empty string" vs "memory ref id must be a non-empty string").
   Two VOs that carry the same kind of cross-aggregate id projection
   now reject malformed input the same way — DDD R7 (ubiquitous
   language) and SOLID consistency both happy.

3. **Error type is correct**. `InvalidInputError` extends `DomainError`
   (`code/src/shared/domain/errors/invalid-input-error.ts:17`) with
   `code = "invalid-input"` and an optional `field`. This is the
   canonical "this value cannot exist in our model" signal, which is
   exactly what an empty `id` is. R2 (VOs validate invariants in the
   constructor and lanzan `DomainError`) satisfied.

4. **Import is clean**. Line 5 adds:
   `import { InvalidInputError } from "../../../../shared/domain/errors/invalid-input-error.ts";`
   No other changes to imports; the path is the same module-relative
   form used by every other retrieval VO. No clean-architecture
   violation (`shared` is the only allowed cross-module import).

5. **No collateral damage**. The constructor signature, the `equals`
   method, the field ordering, and the `private constructor` discipline
   are all unchanged. Equality semantics (line 88: `kind.equals(other.kind)
   && this.id === other.id`) still match the JSDoc Equality section.

---

## 3. DDD checklist re-run on `MemoryRef`

| Rule | Check | Result |
|---|---|---|
| R2 — `private constructor` | line 48 `private constructor(...)` | OK |
| R2 — factory `static of(...)` | lines 59-84 | OK |
| R2 — invariants validated in factory | lines 69-73 (id), `NonEmptyString` (title/preview), `Confidence`, `Tags`, `Timestamp`, `RelevanceScore`, `QueryKind` enforce the rest | OK |
| R2 — `readonly` props | lines 49-56 all `public readonly` | OK |
| R2 — `equals(other): boolean` | lines 86-89 | OK |
| R2 — no setters | none present | OK |
| R2 — typed values, no raw strings/numbers with business meaning | `kind: QueryKind`, `title: NonEmptyString`, `preview: NonEmptyString`, `tags: Tags`, `confidence: Confidence`, `lastUsedAt: Timestamp \| null`, `relevanceScore: RelevanceScore` — `id` is intentionally `string` and the JSDoc justifies why (carries any aggregate kind without a type parameter; `kind` is the discriminator) | OK |
| R6 — events | N/A (VO, not an aggregate) | N/A |
| R7 — domain language | `MemoryRef` names a concept native to the `relevant_memory` layer of `ContextBundle` (`docs/04` §3.5); not generic. JSDoc explicitly contrasts it with the typed `*Ref` VOs and explains the modelling decision | OK |
| Imports — only `shared` and same-module | lines 1-7 — OK | OK |

---

## 4. Regression scan on neighbours

Ran a targeted scan on the rest of `retrieval/domain/value-objects/`
for anything the fix could have ripped:

- No other VO depends on `MemoryRef.of(...)` from inside `domain/`
  (it is consumed only by the future `ContextBundle` assembler in the
  application layer per the JSDoc).
- The `InvalidInputError` import was already present in three other
  VOs in this module (e.g. `query-text.ts`, `relevance-score.ts`),
  so no new shared-module surface was introduced.
- The orchestrator confirmed `tsc --strict` is green; spot check of
  the file confirms no type-level surprises (the new branch throws,
  so the assignment narrows to `MemoryRef` with no widening).

No regressions detected.

---

## 5. Deferred follow-ups (recorded, not re-blocking)

For traceability, the cycle-0 non-blocking observations remain open
and are deferred to Phase 5 (architect review) by orchestrator
decision:

- #2 `PriorityBoost` — missing ADR explaining the magic ceiling.
- #3 `ContextLayerKind` — missing ADR for the closed enum vs open set.
- #4 `WORKSPACE_MODE_LABELS` — drift risk vs `WorkspaceMode` enum.
- #5 Redundant XOR check in some VO factories.
- #6 `BundleId` factory ergonomics.

I have re-read the file in this cycle and have no new opinion on any
of them. They are correctly classified as quality / documentation
debt rather than DDD violations.

---

## 6. Verdict

```json
{
  "validator": "ddd-validator",
  "phase": "phase-1-domain",
  "task": "task-8",
  "cycle": 1,
  "verdict": "APPROVED",
  "scope": ["code/src/modules/retrieval/domain/value-objects/memory-ref.ts"],
  "blockers_resolved": [
    {
      "id": "cycle-0-blocker-1",
      "rule": "R2-vo-validates-invariants",
      "file": "code/src/modules/retrieval/domain/value-objects/memory-ref.ts",
      "lines": "69-73",
      "fix_summary": "MemoryRef.of(...) now rejects non-string and empty/whitespace ids via InvalidInputError, mirroring RankedEntry.of(...)."
    }
  ],
  "violations": [],
  "deferred_to_phase_5": [
    "priority-boost-adr",
    "context-layer-kind-adr",
    "workspace-mode-labels-drift",
    "redundant-xor-check",
    "bundle-id-factory-ergonomics"
  ]
}
```

`MemoryRef` is APPROVED for Phase 1 close.
