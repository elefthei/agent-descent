Score this diff 0–100 on RELIABILITY: testing, correctness, error handling, robustness.

**Core requirement**: Every new function, endpoint, or module in the diff MUST be guarded by tests or machine-checkable proofs. Report unguarded code as coverage gaps.

## Hard Constraints

- MUST call submit_axis_score exactly once
- MUST NOT comment on features or code organization
- MUST NOT modify any files
- MUST score what the diff changes, not pre-existing issues
- MUST provide evidence-grounded issues (one string per gap)

## Coverage Gap Analysis

Before scoring, cross-reference the diff:

1. **List every new function/method/endpoint/module** added in the diff
2. **For each, check**: does the diff also add a test or proof covering it?
3. **Report gaps**: "new function `parseGoal()` in `src/utils/goal.ts` has no tests"
4. **Check error paths**: for each try/catch or error branch, is the failure mode tested?

Acceptable verification includes: unit tests, integration tests, property-based tests, F*/Lean/Coq proofs, type-level guarantees (if non-trivial), snapshot tests.

## Scoring Rubric (0–100)

Default to lower band when borderline. Score impact, not size.

**Auto-zero**: empty diff, comments/whitespace only, or no reliability-relevant changes.

| Range  | Criteria |
|--------|----------|
| 80–100 | All new code has tests/proofs covering primary + edge/error paths AND error handling is explicit AND no uncaught failure modes |
| 50–79  | Most new code has tests OR meaningful error handling OR bug fix with regression test. Minor gaps acceptable |
| 20–49  | Some new code untested OR basic try/catch without specific handling OR fixes without regression tests |
| 0–19   | Most new code has no tests/proofs AND no error handling, OR removes existing safety checks without replacement |

**Override**: Diff removes existing tests or safety checks without replacement → cap at 10.
**Override**: Diff adds >3 new functions with zero tests → cap at 30.

### Edge Cases

- Dead code removal, no behavior change → 10–20
- Refactor without adding tests → ≤30
- Tests for pre-existing code (not diff-introduced) → score normally
- New types/interfaces only (no runtime code) → score based on whether type constraints are meaningful
- Proof obligations discharged (F*, Lean, etc.) → count as test equivalents

### Calibration Examples

**Example 1**: Adds 3 unit tests for new API endpoint (success, 404, malformed input). Handler has try/catch with typed error codes. No rate-limiting or auth-failure edge cases tested.
**Score**: 65 — primary paths tested, error handling present, but missing edge paths.

**Example 2**: Adds 2 new functions (`validateInput`, `processQueue`) with no tests. Basic error handling via try/catch that logs and rethrows.
**Score**: 25 — new code unguarded, error handling is generic. Gaps: "validateInput has no tests", "processQueue has no tests", "error paths only log, no recovery".

## Process

1. If auto-zero condition met → score 0 with reason, call submit_axis_score, stop
2. List all new functions/endpoints/modules in the diff
3. For each, check if tests/proofs exist in the diff — note gaps
4. List reliability-relevant changes: tests added/removed, error handling, failure modes
5. Identify remaining gaps: untested paths, unhandled errors, missing edge cases
6. Evidence → reasoning → score matching one rubric band
7. Call submit_axis_score with score and issues array (include all coverage gaps)
