# QA SonarQube Auditor — Phase 5 / Task 5.5 — Cycle 3

**Validator**: qa-sonarqube-auditor
**Date**: 2026-04-28
**Verdict**: REJECTED

---

## Summary

| Item | Value |
|---|---|
| Quality gate status | **FAILED** (status=ERROR) |
| Overall coverage | **96.2%** PASS (>= 95) |
| Line coverage | 97.2% |
| **New code coverage** | **75.5%** FAIL (>= 95 required) |
| Bugs | 0 |
| Vulnerabilities | 0 |
| Reliability rating | A |
| Security rating | A |
| Maintainability rating | A |
| Duplicated lines density | 1.3% |
| Technical debt ratio | 0.1% |
| Code smells (total) | 263 (none blocker/critical on new code) |

The `sonar.coverage.exclusions` change applied this cycle worked as expected for **overall** coverage: it climbed from previous failing values to **96.2%** and the `coverage` condition is now OK. However the **`new_coverage`** condition on new code is failing at **75.5%**.

## Quality gate breakdown

All 14 conditions:

- OK: new_reliability_rating, new_security_rating, new_maintainability_rating, coverage (96.2 >= 95), new_duplicated_lines_density, duplicated_lines_density, new_blocker_violations, new_bugs, new_critical_violations, new_security_review_rating, new_sqale_debt_ratio, new_violations, new_vulnerabilities
- ERROR: **new_coverage** (actual 75.5, threshold >= 95)

## Root cause of FAIL

Period analyzed: PREVIOUS_VERSION since 2026-04-28T10:39:13 (cycle 2 baseline).

- new_lines: 223
- new_lines_to_cover: 85
- new_uncovered_lines: 22  → 22/85 uncovered = 25.9% gap → 74.1% covered (matches 75.5% rounding)

100% of the deficit comes from a single file:

| File | new_lines_to_cover | new_uncovered_lines |
|---|---|---|
| `src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts` | 58 | 22 |

Only 36/58 new lines in that file are covered (62%). The infrastructure threshold (90%) is also violated globally for branches (86.79%) per local vitest output.

## Local vitest also fails thresholds

```
ERROR: Coverage for branches (92.55%) does not meet global threshold (95%)
ERROR: Coverage for lines (99.13%) does not meet "src/**/domain/**" threshold (100%)
ERROR: Coverage for functions (99.09%) does not meet "src/**/domain/**" threshold (100%)
ERROR: Coverage for branches (95.61%) does not meet "src/**/domain/**" threshold (100%)
ERROR: Coverage for lines (99.33%) does not meet "src/**/application/**" threshold (100%)
ERROR: Coverage for branches (93.77%) does not meet "src/**/application/**" threshold (100%)
ERROR: Coverage for branches (86.79%) does not meet "src/**/infrastructure/**" threshold (90%)
```

These confirm Sonar's verdict: domain/application are not at 100% (rule R8) and infra branches < 90%.

## Required fixes

1. Add tests for `src/modules/curator/infrastructure/persistence/sqlite-memory-entry-writer.ts` to cover the 22 uncovered new lines (target >= 95% on this file → eliminates new_coverage gap).
2. Bring `domain/` and `application/` files to 100% lines/branches/functions (uncovered branches at 95.61% domain / 93.77% application).
3. Lift infrastructure branch coverage from 86.79% to >= 90% (focus on `better-sqlite-database.ts` 92.12% lines / branches lower, `migrations-runner.ts` branches 91.37%, `dimensioned-embedder.ts` branches 93.54%).

No new issues were introduced by the `sonar-project.properties` change — the exclusions list is consistent with `vitest.config.ts` and was correctly honored by the scanner (overall coverage moved from sub-95 to 96.2%).

## Verdict

**REJECTED** — Quality gate FAILED on `new_coverage` (75.5% < 95%). Re-submit after adding tests for `sqlite-memory-entry-writer.ts` and reaching domain/application 100% per rule R8.
