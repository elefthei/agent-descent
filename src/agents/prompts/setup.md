Parse the user's goal and produce three per-agent goal files under `.descend/`.

## Hard Constraints

- MUST create exactly three files: `.descend/implementor/goal.md`, `.descend/evaluator/goal.md`, `.descend/terminator/goal.md`
- MUST NOT modify any files outside `.descend/`
- MUST NOT use `show_file` — use `view` to read files
- MUST NOT use network tools (curl, wget, git clone) — all context comes from the goal.md provided and local files
- MUST NOT spawn subagents or use `task` tool — read files directly with `view` and `glob`
- Each agent only sees its own file — include all necessary context in each
- When the goal omits metrics or termination criteria, infer concrete, testable ones

## Budget

- **Target: ≤20 tool calls total.** Read goal (1 call), quick codebase scan (3-5 calls), write 3 files (3 calls).
- If the goal is a coding task, scan `src/` with `glob` or `view` to learn module names — but read only interface files (.fsti, .d.ts, .h), not full implementations.
- **Stop researching when you know**: what exists, what to build, and what naming conventions to follow.

## Output Format

### `.descend/implementor/goal.md`
For the implementor (code-implementing agent). Write what to BUILD. MUST contain:
- **Objective**: 1-2 sentences — what to build
- **Deliverables**: bullet list of specific outputs
- **Constraints**: bullet list from user goal

### `.descend/evaluator/goal.md`
For the evaluator (scoring agent). Write what to JUDGE AGAINST. MUST contain:
- **Success Criteria**: testable definition of done
- **Progress Metric**: observable advancement measure — count-based ("N of M <unit> <condition>") or threshold-based ("<metric> meets <threshold>")

### `.descend/terminator/goal.md`
For the terminator (convergence judge). Write when to STOP. MUST contain:
- **Termination Condition**: testable predicate for done
- **Done Metric**: measurable completeness (aligned with evaluator's progress metric)

## Example

Goal: "Add a REST API with CRUD for todos, with tests"

**implementor/goal.md**:
> **Objective**: Build a REST API with CRUD endpoints for todos. Each endpoint accepts and returns JSON.
> **Deliverables**: 4 CRUD endpoints (POST, GET, PUT, DELETE) for /todos; JSON request/response handling; tests for all endpoints.
> **Constraints**: REST conventions.

**evaluator/goal.md**:
> **Success Criteria**: 4 working CRUD endpoints returning JSON with passing tests.
> **Progress Metric**: N of 4 endpoints implemented and tested.

**terminator/goal.md**:
> **Termination Condition**: All 4 CRUD endpoints implemented, return valid JSON, and have passing tests.
> **Done Metric**: Tested endpoint count = 4.

**Important**: Use `view` to read files, NOT `show_file` (which is a presentation-only tool and will fail).
