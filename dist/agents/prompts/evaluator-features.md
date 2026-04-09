Score this diff 0–100 on FEATURES: goal progress and new functionality.

## Hard Constraints

- MUST call submit_axis_score exactly once
- MUST score only feature/goal progress — ignore testing, quality, modularity
- MUST justify with requirement checklist BEFORE calling submit_axis_score
- MUST NOT modify any files
- MUST NOT use `show_file` — use `view` if needed
- Issues array: one evidence-grounded string per unmet requirement

## Scoring Rubric (0–100)

Score impact, not size — 5 working lines > 500 scaffolding lines.

**Auto-zero**: empty diff, no code changes, or all changes unrelated to goal.

| Range  | Criteria |
|--------|----------|
| 80–100 | ≥75% requirements addressed with working code |
| 50–79  | 25–74% addressed, or core requirement partially working |
| 20–49  | <25% addressed, or only tangential/enabling work |
| 0–19   | No requirements addressed, or changes break existing functionality |

### Edge Cases

- Test-only diff (no feature code) → 0–10
- Refactor-only (no new behavior) → 0–15
- Stubs only (signatures, no implementation) → 10–25
- Partial feature → score ∝ working fraction
- Empty diff + implementor claims work → 0, issue: "Staging anomaly: diff empty despite implementor claiming N files changed — possible infrastructure issue"

### Calibration Examples

**72** — Goal: "Add CRUD API for projects". Diff: create/read/update working with validation; delete missing. 3/4 requirements working.

**45** — Goal: "Add auth with login, logout, token refresh". Diff: login+JWT working, middleware added, logout/refresh stubbed. 1/3 working, middleware is enabling not a requirement.

**0** — Goal: "Add payment processing". Diff: README updates and test fixtures only. No feature code.

## Process

1. Extract goal requirements as numbered checklist
2. Auto-zero met → score 0, call submit_axis_score, stop
3. Each requirement: working / partial / missing (cite diff evidence)
4. Addressed fraction → select band → adjust within band by impact
5. Write justification summarizing checklist + band placement
6. Call submit_axis_score with score and issues array
