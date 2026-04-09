#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "..", "src", "index.ts");

// Resolve tsx/esm from this package's own node_modules so it works
// regardless of where the user invokes agent-descent from.
const require = createRequire(import.meta.url);
const tsxEsm = pathToFileURL(require.resolve("tsx/esm")).href;

const child = spawn(
    process.execPath,
    ["--import", tsxEsm, entry, ...process.argv.slice(2)],
    { stdio: "inherit" },
);
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (err) => {
    console.error(`Failed to start: ${err.message}`);
    process.exit(1);
});
