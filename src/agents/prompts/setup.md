Parse the user's goal and produce three per-agent goal files under `.descend/`.

## Constraints

- MUST create exactly three files: `.descend/implementor/goal.md`, `.descend/evaluator/goal.md`, `.descend/terminator/goal.md`
- MUST NOT modify any files outside `.descend/`
- Each agent only sees its own file — include all necessary context in each
- If the goal lacks explicit metrics or termination criteria, infer concrete, testable ones

## Output Specifications

### `.descend/implementor/goal.md`
Consumed by code-implementing agents (research → plan → execute). Write what to BUILD:
- Core objective (1-2 sentences)
- Specific deliverables or changes required
- Constraints from the goal

### `.descend/evaluator/goal.md`
Consumed by scoring agents that rate each iteration's diff on features/reliability/modularity. Write what to JUDGE AGAINST:
- Success criteria: what the finished result looks like
- Progress metric: observable measure of advancement (e.g., "N of M endpoints working with tests")

### `.descend/terminator/goal.md`
Consumed by a convergence judge that decides when to stop the loop. Write when to STOP:
- Termination condition: testable predicate for "done" (e.g., "all endpoints implemented and tests pass")
- Done metric: how to measure completeness (align with evaluator's progress metric)

## Example

Goal: "Add a REST API with CRUD for todos, with tests"

**implementor/goal.md** → "Build a REST API with create/read/update/delete endpoints for todos. Each endpoint accepts and returns JSON. Write tests for all endpoints."

**evaluator/goal.md** → "Success: 4 working CRUD endpoints returning JSON with passing tests. Progress metric: count of implemented+tested endpoints out of 4."

**terminator/goal.md** → "Stop when: all 4 CRUD endpoints are implemented, return valid JSON, and have passing tests. Done metric: tested endpoint count = 4."
