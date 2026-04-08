Score this diff 0–100 on MODULARITY: code organization, abstraction, separation of concerns, maintainability.

## Hard Constraints

- MUST call submit_axis_score exactly once
- MUST NOT score features or testing
- MUST NOT modify any files
- MUST provide evidence-grounded issues (one concrete problem per string)

## Modularity Checklist

Count which apply to the diff:

1. Reduces coupling between modules/components
2. Introduces or improves abstractions (interfaces, helpers, utilities)
3. Improves separation of concerns (splits mixed responsibilities)
4. Reduces duplication (DRY violations removed)
5. Improves file/directory organization or module boundaries
6. Improves naming clarity for modules, functions, or types

## Scoring (0–100)

Choose band from checklist count, then place within band by structural impact.
Score impact, not size — a targeted extraction > a large monolithic addition.

**Auto-zero**: empty diff, comments/whitespace only, or no code changes.

| Range  | Criteria |
|--------|----------|
| 80–100 | ≥4 checklist items with significant structural impact |
| 50–79  | 2–3 items with clear, measurable improvement |
| 20–49  | 1–2 minor items; small reorganization or naming fixes |
| 0–19   | No items apply; or diff increases coupling/duplication |

**Override**: Refactor breaks existing module interfaces without migration path → cap at 40.

### Edge Cases

- Pure feature add with no structural change → 5–15 (no-degradation credit)

### Calibration Examples

**High**: Extracts 3 inline handlers into `utils/handlers.ts`, adds TypeScript interface for handler contract, removes 40 lines of duplicated validation.
**Score**: 75 — hits items 1, 2, 4, 5 but scope limited to one subsystem.

**Low**: Adds 200-line feature in single file with inline helpers, no extraction or reuse.
**Score**: 10 — no checklist items, but no structural degradation.

## Issues Format

- Good: "auth.ts and api.ts both implement token validation — extract to shared module"
- Bad: "code could be cleaner"

## Process

1. If auto-zero condition met → score 0 with reason, call submit_axis_score, stop
2. Evaluate each checklist item against the diff — note specific evidence
3. Count applicable items → map to band → adjust within band by impact
4. Call submit_axis_score with score and issues array
