# agent-descent

A multi-agent loop system that simulates **gradient descent for code** — three independent AI agents iteratively improve a software project toward a user-defined goal. Built on the [`@github/copilot-sdk`](https://github.com/github/copilot-sdk).

## System Diagram

```
                            ┌─────────────────────────┐
                            │       goal.md            │
                            │                          │
                            │  (freeform — any format) │
                            └────────────┬─────────────┘
                                         │
                                         ▼
                            ┌───────────────────────┐
                            │     Setup Agent (LLM)  │
                            │  Reads goal → projects  │
                            │  per-agent goal files   │
                            └───────────┬───────────┘
                                        │
                    ┌───────────────────────────────────────────┐
                    │              ITERATION LOOP                │
                    │                                           │
                    │   ┌───────────────────────────────────┐   │
                    │   │        IMPLEMENTOR                │   │
                    │   │                                   │   │
                    │   │   ┌──────────┐  .descend/research │   │
                    │   │   │ Research  │──────────────────▶│   │
                    │   │   └────┬─────┘                    │   │
                    │   │        ▼                          │   │
                    │   │   ┌──────────┐  .descend/plan     │   │
                    │   │   │  Plan    │──────────────────▶│   │
                    │   │   └────┬─────┘                    │   │
                    │   │        ▼                          │   │
                    │   │   ┌──────────┐  code changes      │   │
                    │   │   │ Execute  │  + report.md       │   │
                    │   │   └────┬─────┘                    │   │
                    │   └────────┼──────────────────────────┘   │
                    │            ▼                               │
                    │   ┌───────────────────────────────────┐   │
                    │   │        EVALUATOR ORCHESTRATOR      │   │
                    │   │                                   │   │
                    │   │   ┌────────────┐ ┌────────────┐   │   │
                    │   │   │ Features   │ │Reliability │   │   │
                    │   │   │  0-100     │ │  0-100     │   │   │
                    │   │   └────────────┘ └────────────┘   │   │
                    │   │   ┌────────────┐ ┌────────────┐   │   │
                    │   │   │Modularity  │ │ Symbolic   │   │   │
                    │   │   │  0-100     │ │ (advisory) │   │   │
                    │   │   └────────────┘ └────────────┘   │   │
                    │   │          │                         │   │
                    │   │          ▼                         │   │
                    │   │   ┌────────────┐                  │   │
                    │   │   │Synthesizer │→ report.md       │   │
                    │   │   └────────────┘                  │   │
                    │   │          │                         │   │
                    │   │   max(scores) ≥ 50?               │   │
                    │   │    yes → git commit                │   │
                    │   │    no  → git revert + feedback     │   │
                    │   └──────────┬────────────────────────┘   │
                    │              ▼                             │
                    │   ┌───────────────────────────────────┐   │
                    │   │        TERMINATOR                  │   │
                    │   │  STOP  → done                      │   │
                    │   │  CONTINUE → next iteration          │   │
                    │   └───────────────────────────────────┘   │
                    │                                           │
                    │   After N consecutive rejections:          │
                    │   🚨 RADICAL PLAN — evaluator rethinks     │
                    │      strategy from goal.md + failures      │
                    └───────────────────────────────────────────┘
```

## The Gradient Descent Analogy

| Gradient Descent | Agent-Descent |
|-----------------|---------------|
| Parameter vector | Codebase state (git) |
| Loss function | Evaluator scores (features, reliability, modularity) |
| Gradient computation | Research → Plan phases |
| Gradient step | Execute phase |
| Convergence check | Terminator: STOP or CONTINUE |
| Backtrack / momentum | Reject → git revert to baseline |
| Escape local minimum | RADICAL PLAN after N rejections |

## Installation

```bash
npm install
npm link     # optional: adds `agent-descent` to PATH
```

Requires Node.js ≥ 20 and GitHub Copilot CLI authentication (`gh auth login`).

## Usage

### 1. Write a goal

Create a `goal.md` — write it in any format you want. The setup agent (an LLM) reads it and infers the goal, progress metric, and termination condition:

```markdown
Build a CLI todo app in TypeScript. It should support add, list, complete,
and delete commands. Store todos in a JSON file. Include tests.
I'll consider it done when all commands work and tests pass.
```

### 2. Run

```bash
agent-descent goal.md
```

### 3. Watch

Color-coded output shows every agent's activity in real-time, including tool calls with arguments:

```
[system               ] 🚀 Agent-Descent starting...
[system               ]    Goal: /home/user/project/goal.md
[system               ]    Max iterations: 10
[system               ]    Timeout: 60 minutes per agent session
[system               ] ═══════════════════════════════════════
[system               ]   Iteration 1 / 10
[system               ] ═══════════════════════════════════════
[system               ] 📚 Implementor: Research phase...
[implementor:research ] ── turn 1 ──
[implementor:research ] [tool: grep] "auth" in src/
[implementor:research ] [tool ✓] 3 files matched
[implementor:research ] [tool: view] src/auth/handler.ts
[implementor:research ] [tool: bash] npm test -- --reporter=min
[implementor:research ] [tool ✓] 12 tests passed
[implementor:research ] I've analyzed the codebase structure and
[implementor:research ] identified the key files that need changes.
[implementor:research ] [tool: create] .descend/research/auth-analysis.md
[system               ] 📋 Implementor: Plan phase...
[system               ] 🔧 Implementor: Execute phase...
[implementor:exec     ] [tool: edit] src/auth/handler.ts
[implementor:exec     ] [tool: bash] npm test
[implementor:exec     ] [tool ✓] All 14 tests passed
[system               ] 🔍 Evaluator: Reviewing changes...
[system               ]    → evaluator:features
[system               ]    ← features: 75/100
[system               ]    → evaluator:reliability
[system               ]    ← reliability: 40/100
[system               ]    → evaluator:modularity
[system               ]    ← modularity: 60/100
[system               ]    → evaluator:symbolic
[system               ]    ← symbolic: 3 checks, 1 finding
[system               ]    → evaluator:synthesizer
[system               ]    ← report.md written
[system               ] ✅ Evaluator APPROVED
[system               ]    Scores: features=75, reliability=40, modularity=60
[system               ] 🎯 Terminator: Checking convergence...
[terminator           ] 🔄 CONTINUE — significant work remaining
```

### CLI Options

```
agent-descent <goal.md> [options]

  --max-iterations N       Safety cap (default: 10)
  --max-reject N           Consecutive rejections before RADICAL PLAN (default: 3)
  --timeout MINUTES        Timeout per agent session (default: 60)
  --implementor-model M    Model for implementor (default: claude-opus-4.6)
  --evaluator-model M      Model for evaluator subagents (default: claude-opus-4.6)
  --terminator-model M     Model for terminator (default: claude-opus-4.6)
```

## Programmatic API

```typescript
import { CopilotClient } from "@github/copilot-sdk";
import { setup, descent } from "agent-descent";

const client = new CopilotClient({ logLevel: "none" });
await client.start();

const agents = await setup(client, "goal.md");
const result = await descent(client, agents, {
    goalPath: "goal.md",
    maxIterations: 10,
    maxReject: 3,
});
// → { iterations: 3, converged: true, reason: "Goal achieved" }

await client.stop();
```

### Agent/Orchestrator Interfaces

The system uses reusable `Agent` and `Orchestrator` interfaces:

```typescript
import type { Agent, Orchestrator, AgentConfig } from "agent-descent";

// An Agent runs a single session and returns a typed result
interface Agent<TContext, TResult> {
    name: string;
    run(client: CopilotClient, config: AgentConfig, ctx: TContext): Promise<TResult>;
}

// An Orchestrator composes Agents — and is itself an Agent (nestable)
interface Orchestrator<TContext, TResult> extends Agent<TContext, TResult> {
    agents: Agent<any, any>[];
}
```

## Evaluator Architecture

The evaluator is an `Orchestrator` that runs 5 subagents sequentially:

```
EvaluatorOrchestrator
├── Features agent      → score 0-100 + issues[]
├── Reliability agent   → score 0-100 + issues[]
├── Modularity agent    → score 0-100 + issues[]
├── Symbolic agent      → availableChecks[] + findings[] + suggestions[] (no score)
└── Synthesizer agent   → writes .descend/evaluator/report.md
```

**Approval rule:** `max(features, reliability, modularity) ≥ 50` → approve. A diff that *only* refactors, *only* adds tests, or *only* adds features is fine. All three below 50 → reject.

**Symbolic checking** is advisory: it discovers available verification (tests, types, lints, proofs, coverage) and reports findings, but doesn't gate approval.

## Project Structure

```
src/
├── index.ts               # CLI entry point
├── descent.ts             # Core loop: setup() + descent()
├── types.ts               # Agent, Orchestrator, AgentConfig interfaces
├── agents/
│   ├── setup.ts           # One-time goal projection (LLM-driven, freeform input)
│   ├── implementor.ts     # Research → Plan → Execute
│   ├── evaluator.ts       # EvaluatorOrchestrator (5 subagents)
│   ├── terminator.ts      # Convergence detection
│   └── prompts/           # Edit .md files to change agent behavior
│       ├── setup.md
│       ├── implementor-research.md
│       ├── implementor-plan.md
│       ├── implementor-exec.md
│       ├── evaluator-features.md
│       ├── evaluator-reliability.md
│       ├── evaluator-modularity.md
│       ├── evaluator-symbolic.md
│       ├── evaluator-synthesizer.md
│       ├── evaluator-radical.md
│       └── terminator.md
├── tools/
│   └── decisions.ts       # Structured tools (Zod schemas)
└── utils/
    ├── logger.ts          # Color-coded terminal output
    ├── git.ts             # Safe git operations (execFileSync)
    ├── prompt.ts          # loadPrompt() — reads .md at runtime
    ├── files.ts           # Shared file utilities
    └── state.ts           # Loop state + stagnation detection

.descend/                  # Agent artifacts (git-tracked)
├── state.json             # Loop state, baseline, score history
├── research/              # Implementor research notes (current iteration)
├── plan/                  # Implementor attack plan (current iteration)
├── implementor/
│   ├── goal.md            # Projected goal
│   └── report.md          # Execution log
├── evaluator/
│   ├── goal.md            # Projected goal + progress metric
│   └── report.md          # Evaluation report (or RADICAL PLAN)
├── terminator/
│   └── goal.md            # Projected termination condition
└── history/               # Archived iterations
    └── iteration-N/
```

## Key Design Decisions

- **Freeform goal.md** — write your goal in any format, the setup agent infers structure
- **Fresh sessions each iteration** — no context bleed between agents
- **File-based state** — all communication via `.descend/` and git
- **Baseline commit model** — safe reverts to known-good state, not destructive `git clean`
- **Structured tool outputs** — Zod schemas, not NL parsing
- **Per-iteration archival** — stale research/plans don't contaminate future prompts
- **RADICAL PLAN** — escape local minima after repeated rejections
- **Prompts as .md files** — edit `src/agents/prompts/*.md` to change behavior, no recompilation
- **Verbose logging** — tool calls with arguments, results, turn boundaries, word-wrapped output
