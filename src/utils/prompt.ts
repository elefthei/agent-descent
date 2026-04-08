import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, "../agents/prompts");

/**
 * Load a prompt from src/agents/prompts/{name}.md at runtime.
 * Edit the .md file to change agent behavior — no recompilation needed.
 */
export function loadPrompt(name: string): string {
    const path = resolve(PROMPTS_DIR, `${name}.md`);
    return readFileSync(path, "utf-8");
}
