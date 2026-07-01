import fs from "fs";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const SCAN_DIRS = [
  path.resolve("src/components"),
  path.resolve("src/features"),
];
const EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];

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

// ── Core transform ────────────────────────────────────────────────────────────
// Matches:  url(${AnyIdentifier})
// Skips:    url(${AnyIdentifier.src})   ← already has .src
// Also skips string literals inside: url(${"some/path"})  url(${'...'})
function processContent(content) {
  let count = 0;

  // Match  url(${IDENTIFIER})  where IDENTIFIER has no dot (not yet .src)
  // Identifier: word chars only (no dots, no spaces)
  const re = /url\(\$\{([A-Za-z_$][\w$]*)(?!\.src)\}\)/g;

  const updated = content.replace(re, (match, ident) => {
    count++;
    return `url(\${${ident}.src})`;
  });

  return { updated, count };
}

// ── Process one file ──────────────────────────────────────────────────────────
function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");

  // Quick bail — no backgroundImage url pattern
  if (!original.includes("url(${")){
    return false;
  }

  const { updated, count } = processContent(original);
  if (count === 0) return false;

  fs.writeFileSync(filePath, updated, "utf-8");

  const rel = path.relative(process.cwd(), filePath);
  console.log(`  ✅  ${rel}`);
  console.log(`       🔧 Fixed ${count} backgroundImage url(s)`);

  return true;
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
for (const f of allFiles) {
  if (processFile(f)) modified++;
}

if (modified === 0) {
  console.log("🟡  No files needed changes.");
} else {
  console.log(`\n✨  Done! Updated ${modified} file(s).`);
}
