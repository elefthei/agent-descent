Score this diff 0–100 on RELIABILITY: testing, correctness, error handling, robustness.

## Hard Constraints

- MUST call submit_axis_score exactly once
- MUST NOT comment on features or code organization
- MUST NOT modify any files
- MUST score what the diff changes, not pre-existing issues
- MUST provide evidence-grounded issues (one string per gap)

## Scoring Rubric (0–100)

Choose band from rubric fit, then place within band by impact depth.
Default to lower band when borderline. Score impact, not size.

**Auto-zero**: empty diff, comments/whitespace only, or no reliability-relevant changes.

| Range  | Criteria |
|--------|----------|
| 80–100 | Tests cover primary + edge/error paths AND error handling explicit AND no uncaught failure modes |
| 50–79  | Tests cover some changed paths OR meaningful error handling OR bug fix with regression test |
| 20–49  | ≤1 test with narrow coverage OR basic try/catch without specific handling OR fixes without tests |
| 0–19   | No tests and no error handling, OR removes existing safety checks without replacement |

**Override**: Diff removes existing tests or safety checks without replacement → cap at 10.

### Edge Cases

- Dead code removal, no behavior change → 10–20
- Refactor without adding tests → ≤30
- Tests for pre-existing code (not diff-introduced) → score normally

### Calibration Example

**Diff**: Adds 3 unit tests for new API endpoint (success, 404, malformed input). Handler has try/catch with typed error codes. No rate-limiting or auth-failure edge cases tested.
**Score**: 65 — primary paths tested, error handling present, but missing edge paths.

## Process

1. If auto-zero condition met → score 0 with reason, call submit_axis_score, stop
2. List reliability-relevant changes: tests added/removed, error handling, failure modes
3. Identify gaps: untested paths, unhandled errors, missing edge cases
4. Evidence → reasoning → score matching one rubric band
5. Call submit_axis_score with score and issues array
