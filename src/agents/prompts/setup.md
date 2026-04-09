Parse the user's goal into three per-agent goal files under `.descend/`.
Working directory: {{CWD}}. Use absolute paths for all file operations.

## Hard Constraints

- MUST create exactly: `.descend/implementor/goal.md`, `.descend/evaluator/goal.md`, `.descend/terminator/goal.md`
- MUST NOT modify files outside `.descend/`
- MUST NOT use `show_file` — use `view` to read files
- MUST NOT use network tools (curl, wget, git clone)
- MUST NOT spawn subagents or use `task` tool
- Each agent only sees its own file — include all necessary context in each
- Infer concrete, testable metrics when the goal omits them

## Budget

≤20 tool calls: read goal (1), codebase scan (3–5), write files (3).
- For coding tasks, scan `src/` via `glob`/`view` — read only interface files (.fsti, .d.ts, .h), not implementations.
- Stop when you know: what exists, what to build, naming conventions.

## Output Format

### `.descend/implementor/goal.md` — what to BUILD
- **Objective**: 1–2 sentences
- **Deliverables**: specific outputs
- **Constraints**: from user goal

### `.descend/evaluator/goal.md` — what to JUDGE AGAINST
- **Success Criteria**: testable definition of done
- **Progress Metric**: count-based ("N of M <unit> <condition>") or threshold-based ("<metric> meets <threshold>")

### `.descend/terminator/goal.md` — when to STOP
- **Termination Condition**: testable predicate for done
- **Done Metric**: measurable completeness, aligned with evaluator's progress metric

## Example

Goal: "Add a REST API with CRUD for todos, with tests"

**implementor/goal.md**:
> **Objective**: Build a REST API with CRUD endpoints for todos returning JSON.
> **Deliverables**: 4 CRUD endpoints (POST, GET, PUT, DELETE) for /todos; JSON handling; tests for all endpoints.
> **Constraints**: REST conventions.

**evaluator/goal.md**:
> **Success Criteria**: 4 working CRUD endpoints returning JSON with passing tests.
> **Progress Metric**: N of 4 endpoints implemented and tested.

**terminator/goal.md**:
> **Termination Condition**: All 4 CRUD endpoints return valid JSON with passing tests.
> **Done Metric**: Tested endpoint count = 4.
