import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "../agents/prompts");

/**
 * Load a prompt from src/agents/prompts/{name}.md at runtime.
 * Replaces {{KEY}} placeholders with values from the vars map.
 * Edit the .md file to change agent behavior — no recompilation needed.
 */
export function loadPrompt(name: string, vars?: Record<string, string>): string {
    const path = resolve(PROMPTS_DIR, `${name}.md`);
    let content = readFileSync(path, "utf-8");
    if (vars) {
        for (const [key, value] of Object.entries(vars)) {
            content = content.replaceAll(`{{${key}}}`, value);
        }
    }
    return content;
}
