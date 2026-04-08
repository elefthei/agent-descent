---
date: 2026-04-08 00:35:54 UTC
researcher: Copilot CLI
git_commit: 9cf0927ae80ce839178bd567f755b4d2a4d72ed5
branch: main
repository: agent-descent
topic: "Agent-Descent — Project Goal and Vision"
tags: [research, goal, overview, agent-descent, multi-agent, gradient-descent]
status: complete
last_updated: 2026-04-08
last_updated_by: Copilot CLI
---

# Research: What Is the Goal of Agent-Descent?

## Research Question

What is the goal of the agent-descent project?

## Summary

**Agent-descent is a multi-agent loop system that simulates gradient descent using three independent AI agents to autonomously achieve a user-defined coding goal.** It is built on the `@github/copilot-sdk` for Node.js.

The core idea: treat software engineering as an optimization problem. An **Implementor** takes a step toward the goal (research → plan → execute). An **Evaluator** computes the "loss" — approving good changes (git commit) or rejecting bad ones (git revert + explanation). A **Terminator** checks for convergence — has the goal been achieved? The loop repeats until convergence or a safety cap is reached.

This is simultaneously:
1. **A useful tool** — autonomous goal-driven coding with built-in quality feedback
2. **An architectural experiment** — can structured agent feedback loops converge reliably on software tasks?

---

## Detailed Findings

### The Gradient Descent Analogy

The project maps the mathematical gradient descent pattern onto multi-agent coding:

| Gradient Descent | Agent-Descent |
|-----------------|---------------|
| Parameter update step | Implementor makes code changes |
| Loss function evaluation | Evaluator reviews changes (approve/reject) |
| Convergence check | Terminator decides STOP or CONTINUE |
| Learning rate / direction | Evaluator's rejection report guides next iteration |
| Local minimum | Goal achieved (or close enough) |

### The Input: `goal.md`

The user provides a single `goal.md` file as the only CLI argument. It has three required sections:

```markdown
## Goal to implement
<what the user wants built>

## Progress metric
<how to measure progress — what the evaluator judges against>

## Termination condition
<when to stop — what "done" looks like for the terminator>
```

A **setup agent** runs once before the loop, parsing `goal.md` and projecting its sections into per-agent goal files:
- `.descend/implementor/goal.md` — receives the goal (what to build)
- `.descend/evaluator/goal.md` — receives the goal + progress metric (how to judge)
- `.descend/terminator/goal.md` — receives the termination condition + progress metric (when to stop)

Each agent sees only the information relevant to its role.

### The Three Agents

1. **Implementor** (3 phases per iteration):
   - **Research** — reads evaluator feedback, studies codebase, saves notes to `.descend/research/`
   - **Plan** — reads research, creates attack plan in `.descend/plan/`
   - **Execute** — reads plan, makes code changes, writes log to `.descend/implementor/report.md`

2. **Evaluator** — reads all artifacts + git diff, writes report to `.descend/evaluator/report.md`, calls `submit_decision` tool (approve or reject)

3. **Terminator** — reads evaluator report, calls `make_decision` tool (CONTINUE or STOP)

### Key Design Decisions

- **Fresh sessions each iteration** — no context bleed between agents or iterations
- **File-based state transfer** — all communication via `.descend/` directory and git history
- **Structured decisions** — tools with Zod schemas, not natural language parsing
- **Git as the feedback mechanism** — approve → commit; reject → revert + commit only `.descend/`
- **Color-coded terminal output** — all agent activity visible in real-time

### Current State

The repository is in **pre-implementation** phase. It contains:
- A placeholder `README.md`
- A complete [technical design spec](https://github.com/elefthei/agent-descent/blob/9cf0927ae80ce839178bd567f755b4d2a4d72ed5/specs/2026-04-07-agent-descent.md)
- Research documents on [architecture](https://github.com/elefthei/agent-descent/blob/9cf0927ae80ce839178bd567f755b4d2a4d72ed5/research/docs/2026-04-07-agent-descent-architecture.md) and [Copilot SDK API](https://github.com/elefthei/agent-descent/blob/9cf0927ae80ce839178bd567f755b4d2a4d72ed5/research/docs/2026-04-07-copilot-sdk-nodejs-api.md)
- No source code yet

### Implementation Plan (from spec)

The spec defines 5 phases:
1. **Scaffold & Utilities** — `package.json`, `tsconfig.json`, logger, git ops, decision tools
2. **System Prompts** — all 5 agent prompts
3. **Agent Runners** — implementor (3 functions), evaluator, terminator
4. **Loop Orchestrator** — `src/index.ts` main entry point
5. **Polish** — README, edge cases

### Technology Stack

- TypeScript / Node.js (ESM)
- `@github/copilot-sdk` ^0.2.1
- `zod` ^4.3.6 (tool parameter schemas)
- `tsx` for development
- Git for state management

---

## Code References

- `specs/2026-04-07-agent-descent.md` — Complete technical design document (§1–§9)
- `research/docs/2026-04-07-agent-descent-architecture.md` — Architecture design with full agent flow
- `research/docs/2026-04-07-copilot-sdk-nodejs-api.md` — SDK API reference

## Historical Context (from research/)

- `research/docs/2026-04-07-agent-descent-architecture.md` — Documents the three-agent loop architecture, data flow, and `.descend/` directory structure
- `research/docs/2026-04-07-copilot-sdk-nodejs-api.md` — Documents `CopilotClient`, `CopilotSession`, `defineTool`, streaming events, and all SDK capabilities needed for implementation

## Open Questions (from spec)

1. ~~**Goal Input** — how does the user provide the goal?~~ **RESOLVED:** Single `goal.md` file with 3 sections, projected by setup agent.
2. **Max Iterations** — what safety cap? (spec suggests one, doesn't specify number)
3. **Research Accumulation** — reset `.descend/research/` each iteration or accumulate?
4. **Model Configuration** — different models per agent? (spec shows `gpt-4.1` for terminator)
5. **Error Recovery** — what happens when a session fails mid-iteration?
