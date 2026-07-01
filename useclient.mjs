import fs from "fs";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const SCAN_DIRS = [
  path.resolve("src/features"),
  path.resolve("src/components"),
  path.resolve("src/layouts"),
];

const EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];

// ── Client-side indicators ────────────────────────────────────────────────────

// React hooks that require "use client"
const CLIENT_HOOKS = [
  "useState",
  "useEffect",
  "useContext",
  "useRef",
  "useReducer",
  "useMemo",
  "useCallback",
  "useLayoutEffect",
  "useImperativeHandle",
  "useDebugValue",
  "useTransition",
  "useDeferredValue",
  "useId",
  "Swiper",
  "SwiperSlide",
];

// Event handler props that require "use client"
const EVENT_HANDLERS = [
  "onClick",
  "onChange",
  "onSubmit",
  "onInput",
  "onFocus",
  "onBlur",
  "onKeyDown",
  "onKeyUp",
  "onKeyPress",
  "onMouseEnter",
  "onMouseLeave",
  "onMouseDown",
  "onMouseUp",
  "onMouseMove",
  "onDoubleClick",
  "onContextMenu",
  "onScroll",
  "onWheel",
  "onDrop",
  "onDragStart",
  "onDragEnd",
  "onDragOver",
  "onTouchStart",
  "onTouchEnd",
  "onTouchMove",
  "onSelect",
  "onCopy",
  "onCut",
  "onPaste",
  "onReset",
  "onInvalid",
  "onLoad",
  "onError",
];

// ── Detection ─────────────────────────────────────────────────────────────────

function needsUseClient(content) {
  // Check hooks — must be called as a function: useState(  useEffect(  etc.
  for (const hook of CLIENT_HOOKS) {
    // \b word boundary + hook name + optional whitespace + (
    const hookRe = new RegExp(`\\b${hook}\\s*[(<]`, "");
    if (hookRe.test(content)) {
      return { reason: `hook: ${hook}` };
    }
  }

  // Check event handlers — prop usage:  onClick=  onChange={  etc.
  for (const evt of EVENT_HANDLERS) {
    const evtRe = new RegExp(`\\b${evt}\\s*=`, "");
    if (evtRe.test(content)) {
      return { reason: `event: ${evt}` };
    }
  }

  return null;
}

// ── Already has "use client" at the top? ─────────────────────────────────────
// Accept both  "use client"  and  'use client'  with or without semicolon
// It must appear before any import/code (top of file, possibly after comments)
function alreadyHasUseClient(content) {
  // Strip leading whitespace/comments to find the first directive or import
  const stripped = content.trimStart();

  // If the file literally starts with "use client" (after optional BOM/whitespace)
  if (/^["']use client["'];?/.test(stripped)) return true;

  // Also handle case where it appears within the first few non-blank lines
  // (some formatters add a blank line before imports)
  const firstLines = stripped.split("\n").slice(0, 5).join("\n");
  if (/["']use client["'];?/.test(firstLines)) return true;

  return false;
}

// ── Insert "use client" at the very top ──────────────────────────────────────
function insertUseClient(content) {
  // Preserve any leading BOM or shebang
  return `"use client";\n${content}`;
}

// ── Process one file ──────────────────────────────────────────────────────────
function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");

  // Point 6: already has "use client" → skip entirely
  if (alreadyHasUseClient(original)) {
    return "already";
  }

  // Point 4: no client-side logic → leave as server component
  const detected = needsUseClient(original);
  if (!detected) return "skip";

  // Add "use client" at top
  const final = insertUseClient(original);
  fs.writeFileSync(filePath, final, "utf-8");

  return detected.reason;
}

// ── File walker ───────────────────────────────────────────────────────────────
function getAllFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) getAllFiles(full, results);
    else if (EXTENSIONS.includes(path.extname(entry.name))) results.push(full);
  }
  return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────
let allFiles = [];

for (const dir of SCAN_DIRS) {
  if (!fs.existsSync(dir)) {
    console.warn(`⚠️   Not found, skipping: ${path.relative(process.cwd(), dir)}`);
    continue;
  }
  console.log(`🔍  Scanning: ${path.relative(process.cwd(), dir)}`);
  getAllFiles(dir, allFiles);
}

console.log(`\n📁  Found ${allFiles.length} file(s) to check.\n`);

let modified = 0;
let alreadyDone = 0;
let skipped = 0;

for (const f of allFiles) {
  const result = processFile(f);
  const rel = path.relative(process.cwd(), f);

  if (result === "already") {
    alreadyDone++;
    // console.log(`  ✔   Already has "use client": ${rel}`);
  } else if (result === "skip") {
    skipped++;
    // console.log(`  ⚪  Server component (no change): ${rel}`);
  } else {
    modified++;
    console.log(`  ✅  ${rel}`);
    console.log(`       ➕ Added "use client"  (detected: ${result})`);
  }
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  "use client" added    : ${modified} file(s)
  ✔   Already had it        : ${alreadyDone} file(s)
  ⚪  Server components     : ${skipped} file(s)  (no change)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✨  Done!`);
