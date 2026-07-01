import fs from "fs";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const SCAN_DIRS = [
  path.resolve("src/features"),
  path.resolve("src/components"),
];

const SKIP_DIRS = new Set([
  path.resolve("src/components/elements"),
  path.resolve("src/components/context"),
]);

const EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];
const NEXT_IMAGE_IMPORT = `import Image from "next/image";`;

// ── File walker (respects SKIP_DIRS) ─────────────────────────────────────────
function getAllFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  if (SKIP_DIRS.has(path.resolve(dir))) {
    console.log(`  ⏭  Skipping folder: ${path.relative(process.cwd(), dir)}`);
    return results;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      getAllFiles(full, results);
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

// ── Derive alt text from src value ───────────────────────────────────────────
// "assets/images/resources/logo-2.png"  →  "logo-2"
// "/icons/arrow_right.svg"              →  "arrow right"
// {someVariable}                        →  "image"   (dynamic src, can't guess)
function deriveAlt(srcValue) {
  // Dynamic expression — can't derive a meaningful name
  if (srcValue.startsWith("{")) return "image";

  const stripped = srcValue.replace(/^["'`]|["'`]$/g, ""); // remove quotes
  const filename = path.basename(stripped, path.extname(stripped)); // "logo-2"
  // Replace separators with spaces and trim
  const readable = filename.replace(/[-_]/g, " ").trim();
  return readable || "image";
}

// ── Extract attribute value (handles  attr="val"  attr='val'  attr={expr}) ──
function extractAttrValue(tag, attr) {
  // attr="..."  or  attr='...'
  const quotedRe = new RegExp(`\\b${attr}=["']([^"']*)["']`);
  const quotedMatch = tag.match(quotedRe);
  if (quotedMatch) return quotedMatch[1];

  // attr={...}
  const exprRe = new RegExp(`\\b${attr}=(\\{[^}]*\\})`);
  const exprMatch = tag.match(exprRe);
  if (exprMatch) return exprMatch[1];

  return null;
}

// ── Check if an attribute exists in the tag ───────────────────────────────────
function hasAttr(tag, attr) {
  return new RegExp(`\\b${attr}\\s*=`).test(tag);
}

// ── Convert a single <img ...> tag string → <Image ...> ──────────────────────
function convertImgTag(tag) {
  // Derive alt if missing
  let result = tag;

  // Replace  <img  with  <Image
  result = result.replace(/^<img\b/, "<Image");

  // Make self-closing if not already  (Next.js Image must be self-closing)
  // Remove trailing />  or  >  then re-add  />
  result = result.replace(/\s*\/?>$/, " />");

  // Add alt if missing
  if (!hasAttr(result, "alt")) {
    const srcVal = extractAttrValue(result, "src") ?? "";
    const alt = deriveAlt(srcVal);
    // Insert alt just before the closing  />
    result = result.replace(/\s*\/>$/, ` alt="${alt}" />`);
  }

  return result;
}

// ── Process file content ──────────────────────────────────────────────────────
function processContent(content) {
  // Match any <img ...> or <img ... /> tag (possibly multi-line)
  // We stop at the first > that isn't inside an attribute value
  const imgTagRe = /<img\b([^>]*?)(\s*\/?>)/gs;

  let count = 0;
  const updated = content.replace(imgTagRe, (match) => {
    const converted = convertImgTag(match);
    if (converted !== match) count++;
    return converted;
  });

  return { updated, count };
}

// ── Insert  import Image from "next/image"  at the top ───────────────────────
function insertNextImageImport(content) {
  // Already imported?
  if (/import\s+Image\s+from\s+["']next\/image["']/.test(content)) return content;

  // Insert before the first import line
  const firstImport = content.match(/^import\s/m);
  if (!firstImport) return NEXT_IMAGE_IMPORT + "\n" + content;

  const idx = content.indexOf(firstImport[0]);
  return content.slice(0, idx) + NEXT_IMAGE_IMPORT + "\n" + content.slice(idx);
}

// ── Process one file ──────────────────────────────────────────────────────────
function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");

  // Quick bail — no <img in file
  if (!original.includes("<img")) return false;

  const { updated, count } = processContent(original);
  if (count === 0) return false;

  const final = insertNextImageImport(updated);
  fs.writeFileSync(filePath, final, "utf-8");

  const rel = path.relative(process.cwd(), filePath);
  const importAdded = !/import\s+Image\s+from\s+["']next\/image["']/.test(original);
  console.log(`\n  ✅  ${rel}`);
  console.log(`       🔧 <img> tags converted     : ${count}`);
  console.log(`       ${importAdded ? "➕ Added" : "✔  Already had"} next/image import`);

  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────
let allFiles = [];

for (const dir of SCAN_DIRS) {
  if (!fs.existsSync(dir)) {
    console.warn(`⚠️   Directory not found, skipping: ${dir}`);
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
  console.log(`\n✨  Done! Converted <img> tags in ${modified} file(s).`);
}
