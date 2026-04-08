# agent-descent

A multi-agent loop system that simulates **gradient descent for code** — three independent AI agents iteratively improve a software project toward a user-defined goal. Built on the [`@github/copilot-sdk`](https://github.com/github/copilot-sdk).

## System Diagram

```
                            ┌─────────────────────────┐
                            │       goal.md            │
                            │  ┌───────────────────┐   │
                            │  │ Goal to implement  │   │
                            │  │ Progress metric    │   │
                            │  │ Termination cond.  │   │
                            └──┴───────────────────┴───┘
                                        │
                                        ▼
                            ┌───────────────────────┐
                            │     Setup Agent        │
                            │  Parse → project to    │
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

Create a `goal.md` with three sections:

```markdown
## Goal to implement
Add a REST API with GET /users and POST /users endpoints using Express.

## Progress metric
API endpoints respond correctly, tests pass, error handling is present.

## Termination condition
All endpoints work, tests pass, and the evaluator finds no significant issues.
```

### 2. Run

```bash
agent-descent goal.md
```

### 3. Watch

Color-coded output shows every agent's activity in real-time:

```
[system                ] 🚀 Agent-Descent starting...
[system                ] ═══════════════════════════════
[system                ]   Iteration 1 / 10
[system                ] ═══════════════════════════════
[implementor:research  ] 🔍 Studying codebase...
[implementor:plan      ] 📋 Creating attack plan...
[implementor:exec      ] 🔧 Making code changes...
[system                ]    → evaluator:features
[system                ]    ← features: 75/100
[system                ]    → evaluator:reliability
[system                ]    ← reliability: 40/100
[system                ]    → evaluator:modularity
[system                ]    ← modularity: 60/100
[system                ]    → evaluator:symbolic
[system                ]    ← symbolic: 3 checks, 1 finding
[system                ]    → evaluator:synthesizer
[system                ]    ← report.md written
[system                ] ✅ Evaluator APPROVED (max=75)
[terminator            ] 🔄 CONTINUE — significant work remaining
```

### CLI Options

```
agent-descent <goal.md> [options]

  --max-iterations N       Safety cap (default: 10)
  --max-reject N           Consecutive rejections before RADICAL PLAN (default: 3)
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

const agents = setup("goal.md");
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
│   ├── setup.ts           # One-time goal projection
│   ├── implementor.ts     # Research → Plan → Execute
│   ├── evaluator.ts       # EvaluatorOrchestrator (5 subagents)
│   └── terminator.ts      # Convergence detection
├── prompts/
│   ├── implementor-research.ts
│   ├── implementor-plan.ts
│   ├── implementor-exec.ts
│   ├── evaluator-features.ts
│   ├── evaluator-reliability.ts
│   ├── evaluator-modularity.ts
│   ├── evaluator-symbolic.ts
│   ├── evaluator-synthesizer.ts
│   ├── evaluator-radical.ts
│   └── terminator.ts
├── tools/
│   └── decisions.ts       # Structured tools (Zod schemas)
└── utils/
    ├── logger.ts          # Color-coded terminal output
    ├── git.ts             # Safe git operations (execFileSync)
    ├── goal.ts            # goal.md parser + projection
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

- **Fresh sessions each iteration** — no context bleed between agents
- **File-based state** — all communication via `.descend/` and git
- **Baseline commit model** — safe reverts to known-good state, not destructive `git clean`
- **Structured tool outputs** — Zod schemas, not NL parsing
- **Per-iteration archival** — stale research/plans don't contaminate future prompts
- **RADICAL PLAN** — escape local minima after repeated rejections
