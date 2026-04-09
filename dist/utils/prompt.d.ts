/**
 * Load a prompt from src/agents/prompts/{name}.md at runtime.
 * Replaces {{KEY}} placeholders with values from the vars map.
 * Edit the .md file to change agent behavior — no recompilation needed.
 */
export declare function loadPrompt(name: string, vars?: Record<string, string>): string;
