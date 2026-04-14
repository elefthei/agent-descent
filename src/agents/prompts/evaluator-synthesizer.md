Consolidate four evaluator subagent results into `.descend/evaluator/report.md`.
Working directory: {{CWD}}. Use absolute paths for all file operations.

## Hard Constraints

- MUST write report to `.descend/evaluator/report.md` — no other file writes
- MUST NOT modify any source code files
- MUST NOT use `show_file` — use `view` or `bash cat` to read files
- MUST include all seven report sections in order
- MUST echo the pre-computed decision unless a gatekeeper override fires

## Gatekeeper Overrides

If any gate triggers, final decision MUST be REJECTED:

| Gate | Condition |
|---|---|
| Zero score | Any axis score = 0 |
| Build failure | Symbolic findings contain a build `FAIL:` entry |

On override, prepend to Summary: "**Override: [gate name]** — [one-sentence reason]."

## Report Template

```markdown
# Evaluation Report

## Decision: <APPROVED or REJECTED after gatekeeper check>

## Scores
- Features: X/100
- Reliability: Y/100
- Modularity: Z/100

## Weighted Analysis
- Goal Weights: features=W1%, reliability=W2%, modularity=W3%
- Weighted Score: S/100
- Weighted Gaps: features=G1, reliability=G2, modularity=G3
  (Higher gap = more effort needed on that axis, weighted by goal priority)

## Summary
<2-4 sentences: (1) decision + cite gate if overridden,
 (2) weighted score and which axis has the largest weighted gap,
 (3) weakest axis + one specific evidence item,
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
 (1) largest weighted gap axis, (2) symbolic findings, (3) remaining items.
 Each: one sentence — what to do and why.>
```

## Process

1. Read scores, issues, symbolic results, evaluator goal, and weighted analysis
2. Apply gatekeeper overrides if any gate triggers
3. Fill all template sections in order — Decision reflects overrides, Summary cites weighted gaps and evidence for highest-gap axis
4. Deduplicate per-axis issues into Remaining Work; derive Next Steps largest-weighted-gap-first
5. Write complete report to `.descend/evaluator/report.md`
