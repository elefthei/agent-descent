Consolidate four evaluator subagent results into `.descend/evaluator/report.md`.

## Hard Constraints

- MUST write report to `.descend/evaluator/report.md` — no other file writes
- MUST NOT modify any source code files
- MUST NOT use `show_file` — use `view` to read files, or `bash cat` for verification
- MUST include all seven report sections in order
- MUST echo the pre-computed decision unless a gatekeeper override fires (see below)

## Gatekeeper Overrides

Check before writing. If any gate triggers, the final decision MUST be REJECTED:

| Gate | Condition |
|---|---|
| Zero score | Any axis score = 0 |
| Build failure | Symbolic findings contain a build `FAIL:` entry |

If an override fires, prepend to Summary: "**Override: [gate name]** — [one-sentence reason]."

## Report Template

```markdown
# Evaluation Report

## Decision: <final decision after gatekeeper check — APPROVED or REJECTED>

## Scores
- Features: X/100
- Reliability: Y/100
- Modularity: Z/100

## Summary
<2-4 sentences: (1) state decision + cite gate if overridden,
 (2) weakest axis + one specific evidence item, (3) strongest axis + one specific evidence item,
 (4) overall diff quality vs evaluator goal.>

## Issues by Axis

### Features
<Bullet list from features reviewer. If none: "No issues.">

### Reliability
<Bullet list from reliability reviewer. If none: "No issues.">

### Modularity
<Bullet list from modularity reviewer. If none: "No issues.">

## Symbolic Checking
**Available checks**: <list from symbolic reviewer, or "none found">
**Findings**: <bullet list, or "none">
**Suggestions**: <bullet list, or "none">

## Remaining Work
<Deduplicated union of all issues — each item once, grouped by theme.>

## Next Steps
<3-5 imperative actions ordered by priority:
 (1) lowest-scoring axis, (2) symbolic findings, (3) remaining items.
 Each: one sentence — what to do and why.>
```

## Process

1. Read scores, issues, symbolic results, and evaluator goal
2. Check gatekeeper overrides — apply if any gate triggers
3. Write Decision (final, after overrides) and Scores
4. Write Summary: decision → evidence for weakest axis → evidence for strongest axis → assessment
5. Transcribe per-axis issues; deduplicate into Remaining Work
6. Transcribe symbolic findings and suggestions
7. Derive Next Steps (lowest score first)
8. Write complete report to `.descend/evaluator/report.md`

**Important**: Use `view` to read files, NOT `show_file` (which is a presentation-only tool and will fail).
