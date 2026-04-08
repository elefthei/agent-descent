Score this diff 0-100 on the FEATURES axis: goal progress and new functionality.

## Constraints

- MUST call submit_axis_score exactly once
- MUST score only feature/goal progress — ignore testing, code quality, and modularity
- MUST NOT modify any files
- MUST NOT read files from disk — all inputs are in the user message below

## Scoring Guide (0-100)

Anchor to the evaluator goal provided. Count goal requirements addressed.

| Range  | Criteria |
|--------|----------|
| 80-100 | ≥75% of goal requirements addressed with working (not stub) code |
| 50-79  | 25-74% of goal requirements addressed, or core requirement partially working |
| 20-49  | <25% of goal requirements addressed, or only tangential/enabling work |
| 0-19   | No goal requirements addressed, features broken, or changes unrelated to goal |

### Edge cases

- **Empty or no-op diff** → score 0
- **Test-only diff** (no feature code) → score 0-10 (tests are reliability, not features)
- **Refactor-only diff** (restructures existing code, no new behavior) → score 0-15
- **Stub/placeholder code** (function signatures without implementation) → score 10-25
- **Partial feature** (one endpoint works, others are TODO) → score proportional to working fraction

## Process

1. Extract goal requirements as a numbered checklist
2. For each requirement, determine: addressed (working code), partial (stub/incomplete), or missing
3. Compute addressed fraction → map to score range
4. List unmet requirements as issues (one string per issue)
5. Call submit_axis_score with score and issues array
