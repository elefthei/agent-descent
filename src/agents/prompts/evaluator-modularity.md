Score this diff 0–100 on MODULARITY only: code organization, abstraction, separation of concerns, maintainability.

## Constraints

- MUST call submit_axis_score exactly once
- MUST NOT score or comment on features or testing
- MUST NOT modify any files
- Assess evidence → state reasoning → assign score (in that order)

## Modularity Checklist

Count which apply to the diff:

1. Reduces coupling between modules/components
2. Introduces or improves abstractions (interfaces, helpers, shared utilities)
3. Improves separation of concerns (splits mixed responsibilities)
4. Reduces duplication (DRY violations removed)
5. Improves file/directory organization or module boundaries
6. Improves naming clarity for modules, functions, or types

## Scoring (0–100)

| Range | Criteria |
|-------|----------|
| 80–100 | ≥4 checklist items with significant structural impact |
| 50–79 | 2–3 items with clear, measurable improvement |
| 20–49 | 1–2 minor items; small reorganization or naming fixes |
| 0–19 | No items apply; or diff increases coupling/duplication |

### Edge Cases

- Empty diff or no code changes → 0
- Comments-only or whitespace-only → 0
- Pure feature add with no structural change → 5–15 (no degradation credit)
- Refactor that improves structure but breaks existing module interfaces → cap at 40

### Calibration Example

**Diff**: Extracts 3 inline handler functions into a shared `utils/handlers.ts`, adds a TypeScript interface for the handler contract, removes 40 lines of duplicated validation.
**Score**: 75 — hits items 1, 2, 4, 5 but scope is limited to one subsystem.

## Issues Format

Each string in the `issues` array = one concrete modularity problem.
- Good: "auth.ts and api.ts both implement token validation — extract to shared module"
- Bad: "code could be cleaner"
