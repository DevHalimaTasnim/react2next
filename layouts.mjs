import fs from "fs";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const LAYOUTS_DIR = path.resolve("src/layouts");
const LAYOUT_FILE_PATTERN = /Layout\.tsx$/;
const REACT_IMPORT = `import React from "react";`;

// ── Step 1: Remove react-router-dom import lines ──────────────────────────────
// Removes:
//   import { Outlet } from "react-router-dom";
//   import { Outlet, ... } from "react-router-dom";
//   import SomethingElse from "react-router-dom";
function removeReactRouterImports(content) {
  return content.replace(
    /^import\s+.*?from\s+["']react-router-dom["']\s*;?\n?/gm,
    ""
  );
}

// ── Step 2: Remove SuspenseWrapper import line ────────────────────────────────
function removeSuspenseWrapperImport(content) {
  return content.replace(
    /^import\s+SuspenseWrapper\s+from\s+["'][^"']+["']\s*;?\n?/gm,
    ""
  );
}

// ── Step 3: Add  import React from "react"  at the very top ──────────────────
function addReactImport(content) {
  if (/import\s+React\b/.test(content)) return content; // already present

  const firstImport = content.match(/^import\s/m);
  if (!firstImport) return REACT_IMPORT + "\n" + content;

  const idx = content.indexOf(firstImport[0]);
  return content.slice(0, idx) + REACT_IMPORT + "\n" + content.slice(idx);
}

// ── Step 4: Unwrap <SuspenseWrapper>…</SuspenseWrapper> → <>…</> ─────────────
// Keeps all inner content intact, just replaces the wrapper tags.
function unwrapSuspenseWrapper(content) {
  // <SuspenseWrapper>  …anything…  </SuspenseWrapper>
  return content.replace(
    /<SuspenseWrapper[^>]*>([\s\S]*?)<\/SuspenseWrapper>/g,
    (_, inner) => `<>${inner}</>`
  );
}

// ── Step 5: Replace <Outlet /> (or <Outlet/>) with {children} ────────────────
function replaceOutlet(content) {
  return content.replace(/<Outlet\s*\/>/g, "{children}");
}

// ── Step 6: Inject LayoutProps interface + { children } param ────────────────
// Finds the exported default function and:
//   - Adds interface LayoutProps { children: React.ReactNode; } before it
//   - Replaces () or (no params) with ({ children }: LayoutProps)
function injectChildrenProp(content, funcName) {
  // Match the function signature:
  //   export default function SomeName(   ...   ) {
  const funcRe = new RegExp(
    `(export\\s+default\\s+function\\s+${funcName}\\s*)\\(([^)]*)\\)`,
    ""
  );

  const match = content.match(funcRe);
  if (!match) return content; // can't find it — leave untouched

  const existingParams = match[2].trim();
  // If already has children param, skip
  if (existingParams.includes("children")) return content;

  const interfaceBlock = `interface LayoutProps {\n    children: React.ReactNode;\n}\n`;

  // Replace function signature params with ({ children }: LayoutProps)
  let result = content.replace(funcRe, (_, prefix) => {
    return `${prefix}({ children }: LayoutProps)`;
  });

  // Insert interface just before "export default function ..."
  const exportIdx = result.search(
    new RegExp(`export\\s+default\\s+function\\s+${funcName}\\b`)
  );
  if (exportIdx >= 0) {
    result =
      result.slice(0, exportIdx) +
      interfaceBlock +
      result.slice(exportIdx);
  }

  return result;
}

// ── Step 7: Clean up extra blank lines left by removed imports ────────────────
function cleanBlankLines(content) {
  // Collapse 3+ consecutive blank lines into 1
  return content.replace(/\n{3,}/g, "\n\n");
}

// ── Extract the exported default function name ────────────────────────────────
function extractFuncName(content) {
  const m = content.match(/export\s+default\s+function\s+(\w+)/);
  return m ? m[1] : null;
}

// ── Process one Layout file ───────────────────────────────────────────────────
function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");

  // Only process if file uses react-router-dom or Outlet
  const hasRouterDom = original.includes("react-router-dom");
  const hasOutlet = original.includes("<Outlet");
  const hasSuspense = original.includes("SuspenseWrapper");

  if (!hasRouterDom && !hasOutlet) return false;

  const funcName = extractFuncName(original);
  if (!funcName) {
    console.warn(`  ⚠️  Could not find default export function in: ${filePath}`);
    return false;
  }

  let content = original;
  const changes = [];

  // 1. Remove react-router-dom imports
  if (hasRouterDom) {
    content = removeReactRouterImports(content);
    changes.push("🗑  Removed react-router-dom import");
  }

  // 2. Remove SuspenseWrapper import
  if (hasSuspense) {
    content = removeSuspenseWrapperImport(content);
    changes.push("🗑  Removed SuspenseWrapper import");
  }

  // 3. Add React import
  content = addReactImport(content);
  if (!original.includes("import React")) {
    changes.push('➕ Added import React from "react"');
  }

  // 4. Unwrap <SuspenseWrapper>
  if (hasSuspense) {
    content = unwrapSuspenseWrapper(content);
    changes.push("🔄 Unwrapped <SuspenseWrapper> → <>");
  }

  // 5. Replace <Outlet />
  if (hasOutlet) {
    content = replaceOutlet(content);
    changes.push("🔄 Replaced <Outlet /> → {children}");
  }

  // 6. Inject LayoutProps + children param
  content = injectChildrenProp(content, funcName);
  changes.push("🔧 Added LayoutProps interface + { children } param");

  // 7. Clean blank lines
  content = cleanBlankLines(content);

  if (content === original) return false;

  fs.writeFileSync(filePath, content, "utf-8");

  const rel = path.relative(process.cwd(), filePath);
  console.log(`\n  ✅  ${rel}`);
  changes.forEach((c) => console.log(`       ${c}`));

  return true;
}

// ── File walker — only *Layout.tsx files ─────────────────────────────────────
function getLayoutFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) getLayoutFiles(full, results);
    else if (LAYOUT_FILE_PATTERN.test(entry.name)) results.push(full);
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(LAYOUTS_DIR)) {
  console.error(`❌  Directory not found: ${LAYOUTS_DIR}`);
  console.error("    Run this from your project root (where src/ lives).");
  process.exit(1);
}

console.log(`🔍  Scanning: ${path.relative(process.cwd(), LAYOUTS_DIR)}\n`);
const files = getLayoutFiles(LAYOUTS_DIR);
console.log(`📁  Found ${files.length} *Layout.tsx file(s).\n`);

let modified = 0;
for (const f of files) {
  if (processFile(f)) modified++;
}

if (modified === 0) {
  console.log("🟡  No files needed changes.");
} else {
  console.log(`\n✨  Done! Converted ${modified} layout file(s).`);
}
