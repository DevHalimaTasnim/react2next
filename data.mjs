import fs from "fs";
import path from "path";

const TARGET_DIR = path.resolve("src/data");
const EXTENSIONS = [".ts", ".tsx"];
const STATIC_IMPORT_LINE = `import { StaticImageData } from "next/image";`;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".avif", ".ico"]);

// ── Step 1: Collect identifiers that were imported from image files ───────────
// e.g.  import Brand11 from "@/assets/images/brand/brand-1-1.png"  →  "Brand11"
function getImageImportIdentifiers(content) {
  const imageIdents = new Set();
  const re = /import\s+(\w+)\s+from\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const [, ident, src] = m;
    if (IMAGE_EXTENSIONS.has(path.extname(src).toLowerCase())) {
      imageIdents.add(ident);
    }
  }
  return imageIdents;
}

// ── Step 2: Find which field names are actually assigned an image identifier ──
// Scans every object literal for:   fieldName: SomeImageIdent,  or  fieldName: SomeImageIdent }
// Only returns fields whose values ARE a known image import identifier.
function getFieldsAssignedImageValues(content, imageIdents) {
  if (imageIdents.size === 0) return new Set();

  const fields = new Set();
  // Match:  word : word  followed by , or }  (inside object literals)
  const re = /\b(\w+)\s*:\s*(\w+)\s*(?=[,}])/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const [, field, value] = m;
    if (imageIdents.has(value)) {
      fields.add(field);
    }
  }
  return fields;
}

// ── Step 3: Upgrade ONLY the proven image fields inside interface bodies ──────
// Changes  `field: string;`  to  `field: StaticImageData | string;`
// Skips anything that already contains StaticImageData.
function upgradeInterfaceFields(content, imageFields) {
  if (imageFields.size === 0) return { content, count: 0 };

  let count = 0;

  const result = content.replace(
    /\binterface\s+(\w+)\s*\{([^}]*)\}/gs,
    (fullMatch, interfaceName, body) => {
      let newBody = body;

      for (const field of imageFields) {
        // Match only exact field name (optional ?) followed by : string;
        const fieldRe = new RegExp(
          `(\\b${escRe(field)}\\s*\\??:\\s*)string(\\s*;)`,
          "g"
        );
        newBody = newBody.replace(fieldRe, (m, prefix, suffix) => {
          count++;
          return `${prefix}StaticImageData | string${suffix}`;
        });
      }

      return `interface ${interfaceName} {${newBody}}`;
    }
  );

  return { content: result, count };
}

function escRe(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Step 4: Insert import at the very top (before any other import) ───────────
function insertStaticImageImport(content) {
  // Check specifically for the import line, NOT just the type name
  // (the type name will already be in the content after interface upgrade)
  if (content.includes(`from "next/image"`) || content.includes(`from 'next/image'`)) return content;

  const firstImportMatch = content.match(/^import\s/m);
  if (!firstImportMatch) {
    return STATIC_IMPORT_LINE + "\n" + content;
  }

  const idx = content.indexOf(firstImportMatch[0]);
  return content.slice(0, idx) + STATIC_IMPORT_LINE + "\n" + content.slice(idx);
}

// ── Process one file ──────────────────────────────────────────────────────────
function processFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");

  // Only act if there are actual image imports in this file
  const imageIdents = getImageImportIdentifiers(original);
  if (imageIdents.size === 0) return false;

  // Find which field names are provably assigned those image values in data
  const imageFields = getFieldsAssignedImageValues(original, imageIdents);
  if (imageFields.size === 0) return false;

  // Upgrade those fields in interfaces
  const { content: upgraded, count } = upgradeInterfaceFields(original, imageFields);
  if (count === 0) return false; // already all upgraded

  // Insert the import at the very top
  const final = insertStaticImageImport(upgraded);

  fs.writeFileSync(filePath, final, "utf-8");

  const rel = path.relative(process.cwd(), filePath);
  const importAdded = !original.includes(`from "next/image"`) && !original.includes(`from 'next/image'`);
  console.log(`\n  ✅  ${rel}`);
  console.log(`       🔍 Image imports found      : ${[...imageIdents].join(", ")}`);
  console.log(`       🎯 Image fields detected    : ${[...imageFields].join(", ")}`);
  console.log(`       🔧 Interface fields updated : ${count}`);
  console.log(`       ${importAdded ? "➕ Added" : "✔  Already had"} StaticImageData import`);

  return true;
}

// ── Walk the directory ────────────────────────────────────────────────────────
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
if (!fs.existsSync(TARGET_DIR)) {
  console.error(`❌  Directory not found: ${TARGET_DIR}`);
  console.error("    Run this script from your project root (where src/ lives).");
  process.exit(1);
}

console.log(`🔍  Scanning: ${TARGET_DIR}\n`);
const files = getAllFiles(TARGET_DIR);
console.log(`📁  Found ${files.length} TypeScript file(s) to check.\n`);

let modified = 0;
for (const f of files) {
  if (processFile(f)) modified++;
}

if (modified === 0) {
  console.log("🟡  No files needed changes (all already upgraded or no image imports found).");
} else {
  console.log(`\n✨  Done! Modified ${modified} file(s).`);
}
