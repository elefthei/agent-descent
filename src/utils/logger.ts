import type { CopilotSession } from "@github/copilot-sdk";
import { appendFileSync } from "fs";

const COLORS: Record<string, string> = {
    "implementor:research": "\x1b[36m",
    "implementor:plan": "\x1b[36m",
    "implementor:exec": "\x1b[36m",
    "campaign:reliability": "\x1b[34m",
    "evaluator": "\x1b[33m",
    "evaluator:features": "\x1b[33m",
    "evaluator:reliability": "\x1b[33m",
    "evaluator:modularity": "\x1b[33m",
    "evaluator:symbolic": "\x1b[33m",
    "evaluator:synthesizer": "\x1b[33m",
    "terminator": "\x1b[35m",
    "setup": "\x1b[32m",
    "system": "\x1b[90m",
};

const RESET = "\x1b[0m";
const DIM = "\x1b[90m";
const MAX_ARG_LEN = 200;
const LINE_WIDTH = 80;

// ── File logging ────────────────────────────────────────────

let logFilePath: string | null = null;

const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
    return s.replace(ANSI_REGEX, "");
}

export function setLogFile(path: string): void {
    logFilePath = path;
    appendFileSync(path, `\n--- agent-descent log started ${new Date().toISOString()} ---\n\n`);
}

/** Write a line to both console and log file */
function output(line: string): void {
    console.log(line);
    if (logFilePath) {
        appendFileSync(logFilePath, stripAnsi(line) + "\n");
    }
}

function truncate(s: string, max: number = MAX_ARG_LEN): string {
    const oneLine = s.replace(/\n/g, "\\n");
    return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

function formatToolArgs(toolName: string, args?: Record<string, unknown>): string {
    if (!args || Object.keys(args).length === 0) return "";

    if (toolName === "bash" && args.command) return ` ${truncate(String(args.command))}`;
    if (toolName === "view" && args.path) return ` ${args.path}`;
    if (toolName === "edit" && args.path) return ` ${args.path}`;
    if (toolName === "create" && args.path) return ` ${args.path}`;
    if (toolName === "grep" && args.pattern) {
        const path = args.path ? ` in ${args.path}` : "";
        return ` "${args.pattern}"${path}`;
    }
    if (toolName === "glob" && args.pattern) return ` ${args.pattern}`;
    if (toolName === "web_fetch" && args.url) return ` ${truncate(String(args.url))}`;
    if (toolName === "read_agent" && args.agent_id) return ` ${args.agent_id}`;
    if (toolName === "write_agent" && args.agent_id) return ` ${args.agent_id}`;
    if ((toolName === "task" || toolName === "skill") && args.name) return ` ${args.name}`;

    try {
        return ` ${truncate(JSON.stringify(args))}`;
    } catch {
        return "";
    }
}

/**
 * Word-wrapping streamer for LLM prose output.
 * Buffers tokens, strips newlines, flushes at the last word boundary
 * before LINE_WIDTH chars. Each flushed line gets the prefix once.
 */
class WordWrapStreamer {
    private buffer = "";
    private prefix: string;
    private dim: boolean;

    constructor(prefix: string, dim = false) {
        this.prefix = prefix;
        this.dim = dim;
    }

    write(content: string) {
        // Replace newlines with spaces — LLM prose gets reflowed
        this.buffer += content.replace(/\n/g, " ");
        this.drainLines();
    }

    private drainLines() {
        while (this.buffer.length >= LINE_WIDTH) {
            // Find last space before LINE_WIDTH
            let breakAt = this.buffer.lastIndexOf(" ", LINE_WIDTH);
            if (breakAt <= 0) breakAt = LINE_WIDTH; // no space — hard break

            const line = this.buffer.slice(0, breakAt).trimEnd();
            this.buffer = this.buffer.slice(breakAt).trimStart();

            if (line.length > 0) this.emitLine(line);
        }
    }

    flush() {
        const remaining = this.buffer.trim();
        this.buffer = "";
        if (remaining.length > 0) this.emitLine(remaining);
    }

    private emitLine(line: string) {
        if (this.dim) {
            output(`${DIM}${this.prefix} ${line}${RESET}`);
        } else {
            output(`${this.prefix} ${line}`);
        }
    }
}

export function attachLogger(session: CopilotSession, agent: string): void {
    const color = COLORS[agent] ?? COLORS.system!;
    const prefix = `${color}[${agent.padEnd(21)}]${RESET}`;

    const messageStream = new WordWrapStreamer(prefix);
    const reasoningStream = new WordWrapStreamer(prefix, true);

    function flushAll() {
        reasoningStream.flush();
        messageStream.flush();
    }

    function printLine(msg: string, dim = false) {
        flushAll();
        if (dim) {
            output(`${DIM}${prefix} ${msg}${RESET}`);
        } else {
            output(`${prefix} ${msg}`);
        }
    }

    session.on((event) => {
        switch (event.type) {
            // ── Message streaming (word-wrapped) ──
            case "assistant.message_delta":
                messageStream.write(event.data.deltaContent);
                break;
            case "assistant.message":
                flushAll();
                break;

            // ── Reasoning streaming (word-wrapped, dim) ──
            case "assistant.reasoning_delta":
                reasoningStream.write(event.data.deltaContent);
                break;
            case "assistant.reasoning":
                flushAll();
                break;

            // ── Turn boundaries ──
            case "assistant.turn_start":
            case "assistant.turn_end":
                flushAll();
                break;

            // ── Tool execution ──
            case "tool.execution_start": {
                flushAll();
                const args = formatToolArgs(event.data.toolName, event.data.arguments as Record<string, unknown> | undefined);
                output(`${prefix} ${DIM}[tool: ${event.data.toolName}]${RESET}${args}`);
                break;
            }
            case "tool.execution_complete": {
                if (event.data.success) {
                    const raw = event.data.result;
                    const resultStr = raw
                        ? truncate(typeof raw === "string" ? raw : JSON.stringify(raw), 120)
                        : "";
                    if (resultStr) {
                        output(`${prefix} ${DIM}[tool ✓]${RESET} ${resultStr}`);
                    }
                } else {
                    const rawErr = event.data.error;
                    const errStr = rawErr
                        ? truncate(typeof rawErr === "string" ? rawErr : JSON.stringify(rawErr), 200)
                        : "unknown error";
                    output(`${prefix} \x1b[31m[tool ✗]\x1b[0m ${errStr}`);
                }
                break;
            }

            // ── Subagents ──
            case "subagent.started":
                printLine(`→ subagent: ${event.data.agentDisplayName ?? event.data.agentName}`, true);
                break;
            case "subagent.completed":
                printLine(`← subagent: ${event.data.agentName}`, true);
                break;
            case "subagent.failed":
                flushAll();
                output(`${prefix} \x1b[31m✗ subagent failed: ${event.data.agentName} — ${event.data.error}\x1b[0m`);
                break;
            case "subagent.selected":
                printLine(`agent selected: ${event.data.agentName}`, true);
                break;
            case "subagent.deselected":
                printLine("agent deselected", true);
                break;

            // ── Session lifecycle ──
            case "session.idle":
                flushAll();
                break;
            case "session.task_complete":
                flushAll();
                output(`${prefix} ✅ task complete: ${event.data.summary ?? ""}`);
                break;
        }
    });
}

export const log = {
    system: (msg: string) =>
        output(
            `${COLORS.system}[system               ]${RESET} ${msg}`,
        ),
    setup: (msg: string) =>
        output(
            `${COLORS.setup}[setup                ]${RESET} ${msg}`,
        ),
};
