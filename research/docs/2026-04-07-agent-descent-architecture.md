---
date: 2026-04-07 23:12:45 UTC
researcher: Copilot CLI
git_commit: 9cf0927ae80ce839178bd567f755b4d2a4d72ed5
branch: main
repository: agent-descent
topic: "Agent-Descent Architecture — Three-Agent Gradient Descent Loop"
tags: [research, architecture, agent-descent, multi-agent, gradient-descent]
status: complete
last_updated: 2026-04-07
last_updated_by: Copilot CLI
---

# Research: Agent-Descent Architecture Design

## Research Question

How should the agent-descent project be structured? Three independent agents (implementor, evaluator, terminator) simulate gradient descent to achieve a goal, using the Copilot SDK for Node.js.

## Summary

Agent-descent is a multi-agent loop system that simulates gradient descent using three independent Copilot agents. Each iteration, an **Implementor** agent works toward a goal, an **Evaluator** reviews the work and decides to approve+commit or revert+explain, and a **Terminator** decides if the loop should stop. All agents start fresh each iteration (stateless sessions). The loop is orchestrated in plain Node.js/TypeScript.

---

## Detailed Findings

### 1. System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   agent-descent loop                      │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  ITERATION N                                        │  │
│  │                                                     │  │
│  │  1a. IMPLEMENTOR — RESEARCH (fresh session)         │  │
│  │     ├── Reads goal + evaluator's report.md          │  │
│  │     ├── Studies codebase (grep, glob, view, bash)   │  │
│  │     ├── Researches online if needed (web_fetch)     │  │
│  │     ├── Saves notes in .descend/research/           │  │
│  │     ├── Follows research-codebase skill pattern     │  │
│  │     ├── Does NOT make code changes                  │  │
│  │     └── Session disconnects                         │  │
│  │                                                     │  │
│  │  1b. IMPLEMENTOR — PLAN (fresh session)             │  │
│  │     ├── Reads .descend/research/ notes              │  │
│  │     ├── Reads evaluator's report.md                 │  │
│  │     ├── Creates attack plan in .descend/plan/       │  │
│  │     ├── Does NOT make code changes                  │  │
│  │     └── Session disconnects                         │  │
│  │                                                     │  │
│  │  1c. IMPLEMENTOR — EXECUTE (fresh session)          │  │
│  │     ├── Reads plan from .descend/plan/              │  │
│  │     ├── Executes plan autonomously                  │  │
│  │     ├── Makes code changes                          │  │
│  │     ├── Writes execution log to .descend/impl/      │  │
│  │     │   report.md                                   │  │
│  │     ├── Can spawn sub-agents or fleet               │  │
│  │     └── Session disconnects                         │  │
│  │                                                     │  │
│  │  2. EVALUATOR SESSION (fresh)                       │  │
│  │     ├── Reads .descend/implementor/report.md        │  │
│  │     │   (research + plan + execution log)           │  │
│  │     ├── Reads git diff of implementor's changes     │  │
│  │     ├── Judges research, plan, AND execution        │  │
│  │     ├── Writes .descend/evaluator/report.md         │  │
│  │     ├── DECISION:                                   │  │
│  │     │   ├── APPROVE → git add + git commit          │  │
│  │     │   └── REJECT  → git clean + git checkout      │  │
│  │     │                  + explain in report.md        │  │
│  │     └── Session disconnects                         │  │
│  │                                                     │  │
│  │  3. TERMINATOR SESSION (fresh, stateless)           │  │
│  │     ├── Reads .descend/evaluator/report.md          │  │
│  │     ├── Decides: is report trivial enough to stop?  │  │
│  │     ├── Returns: CONTINUE or STOP                   │  │
│  │     └── Session disconnects                         │  │
│  │                                                     │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                           │
│  If CONTINUE → loop back to ITERATION N+1                 │
│  If STOP     → exit with final report.md                  │
└──────────────────────────────────────────────────────────┘
```

### 2. Agent Specifications

#### 2.1 Implementor Agent (runs three times per iteration)

**Phase A — Research:**
- **Role**: Study the evaluator's feedback and research the codebase/web for context
- **Inputs**: Goal description, `.descend/evaluator/report.md` (if exists), codebase
- **Outputs**: Research notes in `.descend/research/` (follows research-codebase skill pattern)
- **Capabilities**: Read-only tools (read, grep, glob, view, bash for inspection, web_fetch for online research)
- **Sub-agents**: Can use codebase-locator, codebase-analyzer, codebase-pattern-finder, codebase-online-researcher patterns
- **Research pattern**: Follows the `research-codebase` skill from Atomic — decompose question, spawn parallel research, synthesize findings into structured markdown documents with YAML frontmatter, code references, and open questions
- **System prompt**: "You are a researcher. Study the evaluator's feedback and research what is needed to address it. Save structured notes in .descend/research/. Do NOT make any code changes."
- **Statefulness**: Fresh session — reads evaluator report from `.descend/evaluator/report.md`

**Phase B — Plan:**
- **Role**: Create a detailed attack plan based on research findings
- **Inputs**: `.descend/research/` notes, `.descend/evaluator/report.md`, codebase
- **Outputs**: Attack plan in `.descend/plan/` (structured plan document)
- **Capabilities**: Read-only tools (read, grep, glob, view)
- **System prompt**: "You are a planner. Read the research notes in .descend/research/ and the evaluator's feedback. Create a detailed attack plan in .descend/plan/. Do NOT make any code changes."
- **Statefulness**: Fresh session — reads research from `.descend/research/`

**Phase C — Execute:**
- **Role**: Execute the plan from Phase B autonomously
- **Inputs**: `.descend/plan/` attack plan, codebase
- **Outputs**: Code changes, execution log written to `.descend/implementor/report.md`
- **Capabilities**: Full tool access (read, write, edit, bash, grep, glob, view)
- **Sub-agents**: Can have custom agents for specialized tasks (coding, testing)
- **System prompt**: "You are an implementor. Read the plan in .descend/plan/ and execute it. Write an execution log to .descend/implementor/report.md when done."
- **Statefulness**: Fresh session — reads plan from `.descend/plan/`

#### 2.2 Evaluator Agent

- **Role**: Reviews implementor's research, plan, AND execution — decides approve/reject
- **Inputs**: `.descend/implementor/report.md` (execution log), `.descend/plan/` (the plan), `.descend/research/` (research notes), git diff, previous `.descend/evaluator/report.md`
- **Outputs**: Updated `.descend/evaluator/report.md`
- **Judgment criteria**: Was the research thorough? Was the plan sound? Did execution match the plan? Do the code changes achieve the goal? Are there regressions?
- **Decision**: Returns via a custom tool — either `approve` or `reject`
- **On approve**: `git add -A && git commit -m "iteration N: <summary>"`
- **On reject**: `git clean -fd && git checkout .` (revert to last commit), writes explanation in `.descend/evaluator/report.md`, then commits only `.descend/` folder
- **System prompt**: Focused on code review, quality assessment, goal alignment — reads all `.descend/` artifacts
- **Statefulness**: Fresh session each iteration

#### 2.3 Terminator Agent

- **Role**: Decides when the loop should stop
- **Inputs**: Current `.descend/evaluator/report.md`
- **Outputs**: Boolean decision (CONTINUE or STOP)
- **Decision criteria**: Is the evaluator's report trivial enough? (i.e., the goal has been achieved satisfactorily)
- **System prompt**: Stateless judge — reads `.descend/evaluator/report.md` and decides based on whether remaining issues are trivial
- **Statefulness**: Completely stateless, fresh each iteration
- **Implementation**: Uses a custom tool `make_decision` that returns `{ decision: "stop" | "continue" }`

### 3. SDK Usage Patterns

#### Single CopilotClient, Multiple Sequential Sessions

```typescript
const client = new CopilotClient({ logLevel: "none" });
await client.start();

for (let iteration = 1; ; iteration++) {
    // --- Implementor Phase A: Research ---
    const researchSession = await client.createSession({
        model: "claude-sonnet-4.5",
        systemMessage: { mode: "replace", content: IMPLEMENTOR_RESEARCH_PROMPT },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
    });
    await researchSession.sendAndWait({
        prompt: buildResearchPrompt(goal, evaluatorReport),
    });
    await researchSession.disconnect();
    await client.deleteSession(researchSession.sessionId);

    // --- Implementor Phase B: Plan ---
    const planSession = await client.createSession({
        model: "claude-sonnet-4.5",
        systemMessage: { mode: "replace", content: IMPLEMENTOR_PLAN_PROMPT },
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
    });
    await planSession.sendAndWait({
        prompt: buildPlanPrompt(goal, evaluatorReport),
    });
    await planSession.disconnect();
    await client.deleteSession(planSession.sessionId);

    // --- Implementor Phase C: Execute ---
    const execSession = await client.createSession({
        model: "claude-sonnet-4.5",
        systemMessage: { mode: "replace", content: IMPLEMENTOR_EXEC_PROMPT },
        tools: [/* custom tools */],
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
    });
    await execSession.sendAndWait({ prompt: buildExecPrompt() });
    await execSession.disconnect();
    await client.deleteSession(execSession.sessionId);

    // --- Evaluator (reads all .descend/ artifacts + git diff) ---
    const evalSession = await client.createSession({
        model: "claude-sonnet-4.5",
        systemMessage: { mode: "replace", content: EVALUATOR_PROMPT },
        tools: [decisionTool],
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
    });
    await evalSession.sendAndWait({
        prompt: buildEvaluatorPrompt(gitDiff, implReport, researchNotes, plan),
    });
    await evalSession.disconnect();
    await client.deleteSession(evalSession.sessionId);

    // --- Terminator ---
    const termSession = await client.createSession({
        model: "gpt-4.1",  // cheaper model for simple decision
        systemMessage: { mode: "replace", content: TERMINATOR_PROMPT },
        tools: [terminatorDecisionTool],
        onPermissionRequest: approveAll,
        infiniteSessions: { enabled: false },
    });
    await termSession.sendAndWait({
        prompt: buildTerminatorPrompt(evaluatorReport),
    });
    await termSession.disconnect();
    await client.deleteSession(termSession.sessionId);

    if (terminatorDecision === "stop") break;
}

await client.stop();
```

#### Custom Tools for Decision Points

```typescript
const evaluatorDecisionTool = defineTool("submit_decision", {
    description: "Submit your final decision: approve or reject the implementor's changes",
    parameters: z.object({
        decision: z.enum(["approve", "reject"]),
        summary: z.string().describe("Brief summary of your decision"),
    }),
    skipPermission: true,
    handler: async ({ decision, summary }) => {
        evaluatorResult = { decision, summary };
        return `Decision recorded: ${decision}`;
    },
});

const terminatorDecisionTool = defineTool("make_decision", {
    description: "Decide whether the loop should continue or stop",
    parameters: z.object({
        decision: z.enum(["continue", "stop"]),
        reason: z.string().describe("Why you made this decision"),
    }),
    skipPermission: true,
    handler: async ({ decision, reason }) => {
        terminatorResult = { decision, reason };
        return `Decision recorded: ${decision}`;
    },
});
```

### 4. Terminal Output Design

All agent output is prefixed with the agent name in color:

```
[implementor:research] 🔍 Reading evaluator report from .descend/evaluator/report.md...
[implementor:research] 🔍 Studying codebase structure...
[implementor:research] [tool: grep] Searching for auth patterns
[implementor:research] 🔍 Saving notes to .descend/research/
[implementor:plan]     📋 Reading research notes from .descend/research/...
[implementor:plan]     📋 Creating attack plan in .descend/plan/
[implementor:exec]     🔧 Reading plan from .descend/plan/...
[implementor:exec]     [tool: edit_file] Modifying src/auth.ts
[implementor:exec]     📝 Writing execution log to .descend/implementor/report.md
[evaluator]            📋 Reading .descend/implementor/report.md...
[evaluator]            📋 Reading .descend/plan/ and .descend/research/...
[evaluator]            📋 Reviewing git diff...
[evaluator]            ✅ APPROVED — Research thorough, plan sound, execution matched
[evaluator]            [tool: bash] git add -A && git commit -m "iteration 1: ..."
[terminator]           🎯 Reading .descend/evaluator/report.md...
[terminator]           🔄 CONTINUE — Report still has significant items
--- Iteration 1 complete ---
```

Color scheme:
- **Implementor**: Cyan (`\x1b[36m`)
- **Evaluator**: Yellow (`\x1b[33m`)
- **Terminator**: Magenta (`\x1b[35m`)
- **System/Loop**: Grey (`\x1b[90m`)

### 5. File Layout

```
agent-descent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Main entry point — the loop
│   ├── agents/
│   │   ├── implementor.ts    # Implementor agent config (research/plan/exec)
│   │   ├── evaluator.ts      # Evaluator agent config & prompt
│   │   └── terminator.ts     # Terminator agent config & prompt
│   ├── tools/
│   │   ├── decision.ts       # Decision tools (evaluator + terminator)
│   │   └── git.ts            # Git helper tools (commit, revert, diff)
│   ├── prompts/
│   │   ├── implementor-research.ts  # Research phase system prompt
│   │   ├── implementor-plan.ts      # Plan phase system prompt
│   │   ├── implementor-exec.ts      # Execute phase system prompt
│   │   ├── evaluator.ts             # System prompt (reads all .descend/)
│   │   └── terminator.ts            # System prompt
│   └── utils/
│       ├── logger.ts         # Colored terminal output with agent prefixes
│       └── git.ts            # Git operations (diff, commit, revert, clean)
├── .descend/                 # All agent artifacts (committed to git)
│   ├── research/             # Implementor research notes (phase A)
│   │   ├── docs/             # Research documents (YYYY-MM-DD-topic.md)
│   │   └── web/              # Cached web research (YYYY-MM-DD-topic.md)
│   ├── plan/                 # Implementor attack plans (phase B)
│   │   └── YYYY-MM-DD-iteration-N.md
│   ├── implementor/
│   │   └── report.md         # Implementor execution log (phase C)
│   └── evaluator/
│       └── report.md         # Evaluator report (approval/rejection)
└── research/                 # Project-level research (not agent-managed)
    └── docs/
        ├── 2026-04-07-copilot-sdk-nodejs-api.md
        └── 2026-04-07-agent-descent-architecture.md
```

### 6. Git Workflow Per Iteration

```
Iteration N:
  1. Implementor makes changes (working tree dirty)
  2. Evaluator reads git diff
  3. If APPROVED:
     - git add -A
     - git commit -m "iteration N: <evaluator summary>"
  4. If REJECTED:
     - git checkout -- .   (revert tracked files)
     - git clean -fd       (remove untracked files)
     - Write explanation to .descend/evaluator/report.md
     - git add .descend/
     - git commit -m "iteration N: rejected — <reason>"
```

### 7. Gradient Descent Analogy

| Gradient Descent | Agent-Descent |
|------------------|---------------|
| Parameter vector | Codebase state |
| Loss function | Evaluator's `.descend/evaluator/report.md` |
| Literature review | Implementor's research phase (.descend/research/) |
| Gradient computation | Implementor's plan phase (.descend/plan/) |
| Gradient step | Implementor's execute phase |
| Learning rate | Agent's ambition / scope per iteration |
| Convergence | Report becomes trivial (no significant issues) |
| Backtrack (momentum) | Evaluator rejects → revert to previous state |

### 8. Key Design Decisions

1. **Three-phase implementor**: Research → Plan → Execute. Each phase is a fresh session. Research follows the `research-codebase` skill pattern (structured notes with YAML frontmatter, code references, web caching). This mirrors how a human developer works: study the problem, design a solution, then implement it.

2. **All artifacts in `.descend/`**: Centralized folder for all agent-produced artifacts. Clean separation from user code. Structure: `.descend/research/`, `.descend/plan/`, `.descend/implementor/report.md`, `.descend/evaluator/report.md`. Committed to git alongside code changes.

3. **Fresh sessions each iteration**: Ensures independence, no context bleed. State is communicated exclusively via `.descend/` files and git history.

4. **`mode: "replace"` for system messages**: Full control over agent behavior — no SDK guardrails interfering with specialized agent roles.

5. **`infiniteSessions: { enabled: false }`**: Short-lived sessions don't need context compaction.

6. **Custom tools for decisions**: Rather than parsing natural language, agents call structured tools (`submit_decision`, `make_decision`) to communicate decisions programmatically.

7. **Single CopilotClient**: One CLI server process, sessions created/destroyed sequentially. Simpler than managing multiple processes.

8. **Event streaming for terminal output**: Subscribe to session events (`assistant.message_delta`, `tool.execution_start`, etc.) for real-time colored output.

9. **Research-codebase skill pattern**: The implementor's research phase follows the Atomic project's research pattern — structured markdown with frontmatter, parallel sub-agent research, web content caching in `.descend/research/web/`, code references with file paths and line numbers.

---

## Open Questions

1. **Goal input**: Should the goal be a CLI argument, a file (`goal.md`), or interactive prompt?
2. **Max iterations**: Should there be a safety cap on loop iterations?
3. **Model selection**: Different models for different agents? (e.g., cheaper model for terminator)
4. **Implementor sub-agents**: Should the implementor have custom agents for specialized tasks (research, coding, testing)?
5. **Error handling**: What happens if a session fails mid-iteration? Retry? Skip?
6. **Parallel evaluation**: Could evaluator + terminator run in parallel (evaluator first, terminator on the result)?
