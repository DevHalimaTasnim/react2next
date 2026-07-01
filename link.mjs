import fs from "fs";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const SCAN_DIRS = [
  path.resolve("src/components"),
  path.resolve("src/features"),
  path.resolve("src/layouts"),
];

const EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];
const NEXT_LINK_IMPORT = `import Link from "next/link";`;

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

// ── Replace react-router-dom Link imports ─────────────────────────────────────
// Handles all variants:
//   import Link from 'react-router-dom'
//   import Link from "react-router-dom"
//   import { Link } from 'react-router-dom'
//   import { Link } from "react-router-dom"
//   import { Link, NavLink, ... } from 'react-router-dom'   → keeps other named imports
//   import { NavLink, Link } from 'react-router-dom'
function replaceRouterImports(content) {
  let result = content;
  let importReplaced = false;
  let importAdded = false;

  // Already using next/link — nothing to do for imports
  const alreadyNextLink = /import\s+Link\s+from\s+["']next\/link["']/.test(result);

  // ── Case 1: default import  →  import Link from 'react-router-dom'
  result = result.replace(
    /import\s+Link\s+from\s+["']react-router-dom["']\s*;?/g,
    () => { importReplaced = true; return NEXT_LINK_IMPORT; }
  );

  // ── Case 2: named-only import  →  import { Link } from 'react-router-dom'
  result = result.replace(
    /import\s+\{\s*Link\s*\}\s+from\s+["']react-router-dom["']\s*;?/g,
    () => { importReplaced = true; return NEXT_LINK_IMPORT; }
  );

  // ── Case 3: Link mixed with other named imports
  //   import { Link, NavLink, useNavigate } from 'react-router-dom'
  //   → remove Link from the named list, keep the rest, add next/link import
  result = result.replace(
    /import\s+\{([^}]+)\}\s+from\s+["']react-router-dom["']\s*;?/g,
    (match, names) => {
      const parts = names.split(",").map((n) => n.trim()).filter(Boolean);
      const hasLink = parts.includes("Link");
      if (!hasLink) return match; // no Link in this import, leave it

      importReplaced = true;
      const rest = parts.filter((n) => n !== "Link");

      if (rest.length === 0) {
        // Only Link was imported → replace entirely
        return NEXT_LINK_IMPORT;
      } else {
        // Keep remaining named imports + add next/link separately
        importAdded = true;
        return `${NEXT_LINK_IMPORT}\nimport { ${rest.join(", ")} } from "react-router-dom";`;
      }
    }
  );

  // ── Case 4: if next/link was already present but react-router Link still imported
  //    (edge case — clean up duplicate)
  if (alreadyNextLink && importReplaced) {
    // Remove any duplicate next/link imports we might have introduced
    const lines = result.split("\n");
    let seen = false;
    result = lines
      .filter((line) => {
        if (/import\s+Link\s+from\s+["']next\/link["']/.test(line)) {
          if (seen) return false;
          seen = true;
        }
        return true;
      })
      .join("\n");
  }

  return { result, importReplaced, importAdded };
}

// ── Replace  to="..."  /  to='...'  /  to={...}  with  href ──────────────────
// Only on <Link> components (not random `to` props on other elements)
// Strategy: find every <Link ...> block and replace `to=` inside it
function replaceToProp(content) {
  let count = 0;

  // Match <Link ...> or <Link .../>  (possibly multi-line, no nested tags)
  const linkTagRe = /<Link\b([^>]*?)(\s*\/?>)/gs;

  const result = content.replace(linkTagRe, (match, attrs, closing) => {
    // Replace  to=  with  href=  inside attrs
    const newAttrs = attrs.replace(/\bto=/g, () => { count++; return "href="; });
    return `<Link${newAttrs}${closing}`;
  });

  return { result, count };
}

// ── Insert next/link import at the very top (before first import) ─────────────
function insertNextLinkImport(content) {
  if (/import\s+Link\s+from\s+["']next\/link["']/.test(content)) return content;

  const firstImport = content.match(/^import\s/m);
  if (!firstImport) return NEXT_LINK_IMPORT + "\n" + content;

  const idx = content.indexOf(firstImport[0]);
  return content.slice(0, idx) + NEXT_LINK_IMPORT + "\n" + content.slice(idx);
}

// ── Process one file ──────────────────────────────────────────────────────────
function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");

  // Quick bail — no react-router-dom or <Link to= in file
  const hasRouterImport = original.includes("react-router-dom");
  const hasLinkTo = /<Link\b[^>]*?\bto=/.test(original);

  if (!hasRouterImport && !hasLinkTo) return false;

  let content = original;
  const log = [];

  // Step 1 — fix imports
  if (hasRouterImport) {
    const { result, importReplaced } = replaceRouterImports(content);
    content = result;
    if (importReplaced) {
      log.push(`🔄 react-router-dom import → next/link`);
    }
  }

  // Step 2 — fix to= → href=
  if (hasLinkTo) {
    const { result, count } = replaceToProp(content);
    content = result;
    if (count > 0) log.push(`🔧 ${count} \`to\` prop(s) → \`href\``);
  }

  // Step 3 — ensure next/link import exists (covers cases where only to= was fixed)
  if (/<Link\b/.test(content)) {
    content = insertNextLinkImport(content);
  }

  if (content === original) return false;

  fs.writeFileSync(filePath, content, "utf-8");

  const rel = path.relative(process.cwd(), filePath);
  console.log(`\n  ✅  ${rel}`);
  log.forEach((l) => console.log(`       ${l}`));

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
