#!/usr/bin/env node
/**
 * scripts/run.mjs — Central script runner
 * Usage: npm run s <script-name> [args...]
 * Example: npm run s frem
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";
import { readdir } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

const c = {
  green:  (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
};

// ── list all available scripts ───────────────────────────────────────────────
async function listScripts() {
  const files = await readdir(__dirname);
  const scripts = files
    .filter((f) => f !== "run.mjs" && /\.(mjs|js|cjs)$/.test(f))
    .map((f) => f.replace(/\.(mjs|js|cjs)$/, ""));

  console.log(c.bold(c.cyan("\n  📜  Available scripts:\n")));
  if (scripts.length === 0) {
    console.log(c.yellow("    (no scripts found in scripts/ folder)\n"));
  } else {
    scripts.forEach((s) => console.log(`    ${c.green("›")}  ${c.bold(s)}`));
    console.log();
  }
  console.log(c.dim("  Usage: npm run s <script-name> [args...]\n"));
}

// ── main ─────────────────────────────────────────────────────────────────────
const [,, scriptName, ...args] = process.argv;

if (!scriptName || scriptName === "list") {
  await listScripts();
  process.exit(0);
}

// Try extensions in order
const exts = [".mjs", ".js", ".cjs"];
let scriptPath = null;

for (const ext of exts) {
  const candidate = join(__dirname, scriptName + ext);
  if (existsSync(candidate)) {
    scriptPath = candidate;
    break;
  }
}

if (!scriptPath) {
  console.error(c.red(`\n  ✖  Script not found: "${scriptName}"`));
  console.error(c.dim(`     Looked in: ${__dirname}\n`));
  await listScripts();
  process.exit(1);
}

console.log(c.dim(`\n  ▶  Running: scripts/${scriptName}  ${args.join(" ")}\n`));

const child = spawn(process.execPath, [scriptPath, ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
});

child.on("exit", (code) => process.exit(code ?? 0));
