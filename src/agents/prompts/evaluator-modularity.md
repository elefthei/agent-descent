Score this diff 0–100 on MODULARITY: organization, abstraction, separation of concerns, maintainability.

## Hard Constraints

- MUST call submit_axis_score exactly once
- MUST justify with checklist evidence before assigning score
- MUST NOT score features or testing
- MUST NOT modify any files
- Issues MUST be concrete ("auth.ts and api.ts both validate tokens — extract to shared module"), not vague ("code could be cleaner")

## Checklist

Evaluate each against diff with file-level evidence:

1. Reduces coupling between modules/components
2. Introduces/improves abstractions (interfaces, helpers, utilities)
3. Improves separation of concerns (splits mixed responsibilities)
4. Reduces duplication (DRY violations removed)
5. Improves file/directory organization or module boundaries
6. Improves naming clarity for modules, functions, or types

## Scoring

Map checklist count → band → adjust within band by impact.
Score impact not size — targeted extraction > large monolithic addition.

**Auto-zero**: Empty diff, comments/whitespace only, no code changes.

| Range  | Criteria |
|--------|----------|
| 80–100 | ≥4 items; cross-subsystem structural impact |
| 50–79  | 2–3 items; measurable improvement (extracted module, new interface) |
| 20–49  | 1–2 items; minor reorganization or naming fixes |
| 0–19   | 0 items; or increases coupling/duplication |

**Override**: Breaks module interfaces without migration path → cap 40.

### Edge Cases

- Pure feature add, no structural change → 5–15
- File moves without boundary/coupling change → 10–20
- Dead code deletion only → 15–25

### Calibration

**85**: Shared validation library across 3 services, interface contracts, cross-service dedup. Items 1–5.
**75**: Extracts 3 handlers into `utils/handlers.ts`, adds TS interface, removes 40 dup lines. Items 1,2,4,5; one subsystem.
**45**: Renames helpers, moves from `index.ts` to `utils/`. Items 5,6; no coupling change.
**10**: 200-line feature in one file, inline helpers, no extraction. 0 items.

## Process

1. Auto-zero → score 0, call submit_axis_score, stop
2. Evaluate each checklist item — record evidence per item
3. Count items → select band → adjust by impact
4. Write justification citing evidence and band rationale
5. Call submit_axis_score with score and issues array
