import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
export function readFileOrDefault(path, fallback) {
    try {
        return readFileSync(path, "utf-8");
    }
    catch {
        return fallback;
    }
}
export function readDirContents(dirPath) {
    if (!existsSync(dirPath))
        return "(empty)";
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".md"));
    if (files.length === 0)
        return "(empty)";
    return files
        .map((f) => {
        const content = readFileSync(join(dirPath, f), "utf-8");
        return `### ${f}\n\n${content}`;
    })
        .join("\n\n---\n\n");
}
//# sourceMappingURL=files.js.map