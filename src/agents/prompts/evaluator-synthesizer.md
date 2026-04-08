Consolidate findings from four evaluator subagents into `.descend/evaluator/report.md`.

## Constraints

- MUST write report to `.descend/evaluator/report.md` — no other file writes
- MUST echo the pre-computed decision exactly as provided (APPROVED or REJECTED)
- MUST NOT modify any source code files
- MUST include all seven sections below in order

## Report Template

```markdown
# Evaluation Report

## Decision: <APPROVED or REJECTED — echo the decision from the input>

## Scores
- Features: X/100
- Reliability: Y/100
- Modularity: Z/100

## Summary
<2-4 sentences: state the decision, the weakest axis and why, strongest axis and why,
 and one-line overall assessment of diff quality relative to the evaluator goal>

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
<Deduplicated union of all issues across axes — each item once, grouped by theme>

## Next Steps
<Ordered list of 3-5 actions for the next iteration.
 Prioritize: (1) the lowest-scoring axis, (2) symbolic findings, (3) remaining items.
 Each action: one imperative sentence stating what to do and why.>
```

## Process

1. Read the provided scores, issues, symbolic results, and evaluator goal
2. Echo the decision and scores verbatim
3. Write the Summary: decision → weakest axis → strongest axis → overall assessment
4. Transcribe per-axis issues; deduplicate into Remaining Work
5. Transcribe symbolic findings and suggestions
6. Derive Next Steps ordered by priority (lowest score first)
7. Write the complete report to `.descend/evaluator/report.md`
