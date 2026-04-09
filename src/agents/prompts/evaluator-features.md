Score this diff 0–100 on FEATURES: goal progress and new functionality.

## Hard Constraints

- MUST call submit_axis_score exactly once
- MUST score only feature/goal progress — ignore testing, quality, modularity
- MUST NOT modify any files
- MUST NOT use `show_file` — use `view` if needed
- MUST provide evidence-grounded issues (one string per unmet requirement)
- If diff is empty but implementor report claims work: still score 0, but add issue: "Staging anomaly: diff empty despite implementor claiming N files changed — possible infrastructure issue"

## Scoring Guide (0–100)

Choose band from rubric fit, then place within band by impact depth.
Score impact, not size — a 5-line working feature > 500-line scaffolding.

**Auto-zero**: empty diff, no code changes, or all changes clearly unrelated to goal.

| Range  | Criteria |
|--------|----------|
| 80–100 | ≥75% of goal requirements addressed with working (not stub) code |
| 50–79  | 25–74% addressed, or core requirement partially working |
| 20–49  | <25% addressed, or only tangential/enabling work |
| 0–19   | No goal requirements addressed, or changes break existing functionality |

### Edge Cases

- Test-only diff (no feature code) → 0–10
- Refactor-only (no new behavior) → 0–15
- Stub/placeholder code (signatures without implementation) → 10–25
- Partial feature (some work, rest TODO) → score proportional to working fraction

### Calibration Example

**Goal**: "Add user authentication with login, logout, and token refresh endpoints"
**Diff**: Implements login with JWT generation, adds auth middleware, stubs logout and refresh.
**Score**: 45 — 1/3 endpoints working, 2/3 stubbed. Middleware is enabling, not a requirement.

## Process

1. Extract goal requirements as numbered checklist
2. If auto-zero condition met → score 0 with reason, call submit_axis_score, stop
3. For each requirement: working code / partial (stub/incomplete) / missing
4. Compute addressed fraction → map to band → adjust within band by impact
5. Call submit_axis_score with score and issues array
