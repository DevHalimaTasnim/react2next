import fs from "fs";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const HOME_DIR  = path.resolve("src/home");
const APP_DIR   = path.resolve("src/app");
const RENAME_TO = "Home"; // base word (matches PHP $renameTo)

// ── Number ↔ Word helpers ─────────────────────────────────────────────────────
const NUM_TO_WORD = [
  "", "One","Two","Three","Four","Five","Six","Seven","Eight","Nine","Ten",
  "Eleven","Twelve","Thirteen","Fourteen","Fifteen","Sixteen","Seventeen",
  "Eighteen","Nineteen","Twenty",
];
const WORD_TO_NUM = Object.fromEntries(
  NUM_TO_WORD.map((w, i) => [w.toLowerCase(), i])
);

function wordToNumber(word) {
  return WORD_TO_NUM[word.toLowerCase()] ?? null;
}

// StudlyCase word → kebab-case  e.g. "DarkOnePage" → "dark-one-page"
function studlyToKebab(str) {
  return str
    .replace(/([A-Z])/g, (m, l, offset) => (offset > 0 ? "-" : "") + l.toLowerCase())
    .replace(/^-/, "");
}

// ── Core: component name → route segment (mirrors PHP renameGet in reverse) ──
// HomeOne   → "index"          → src/app/page.tsx
// HomeTwo   → "index2"         → src/app/index2/page.tsx
// SingleHomeOne → "index-one-page"  → src/app/index-one-page/page.tsx
// SingleHomeTwo → "index2-one-page" → src/app/index2-one-page/page.tsx
// DarkHome  → "index-dark"     → src/app/index-dark/page.tsx
function componentNameToRoute(name) {
  // 1. Single{Home}{Number}  →  index{N}-one-page
  const singlePrefix = "Single" + RENAME_TO;
  if (name.startsWith(singlePrefix)) {
    const rest = name.slice(singlePrefix.length); // "One", "Two", ""
    const num  = rest ? (wordToNumber(rest) ?? 1) : 1;
    if (num === 1) return "index-one-page";
    return `index${num}-one-page`;
  }

  // 2. {Prefix}{Home}  (ends with Home but doesn't start with Home)
  //    e.g. DarkHome → "Dark" → index-dark
  if (name.endsWith(RENAME_TO) && !name.startsWith(RENAME_TO)) {
    const prefix = name.slice(0, -RENAME_TO.length); // "Dark"
    const slug   = studlyToKebab(prefix);             // "dark"
    return `index-${slug}`;
  }

  // 3. {Home}{Number}  →  index{N}
  if (name.startsWith(RENAME_TO)) {
    const rest = name.slice(RENAME_TO.length); // "One", "Two", ""
    const num  = rest ? (wordToNumber(rest) ?? 1) : 1;
    if (num === 1) return "index"; // → root page
    return `index${num}`;
  }

  // Unrecognised — fall back to kebab of full name
  return studlyToKebab(name);
}

// ── Route segment → output path ───────────────────────────────────────────────
function routeToOutputPath(segment) {
  if (segment === "index") {
    return path.join(APP_DIR, "page.tsx"); // root page
  }
  return path.join(APP_DIR, segment, "page.tsx");
}

// ── Imports parsing (same helpers as previous scripts) ───────────────────────
const REMOVE_IDENTIFIERS = new Set(["lazy","SEO","ErrorBoundary","SuspenseWrapper","Suspense"]);
const IMAGE_EXTS = new Set([".png",".jpg",".jpeg",".gif",".svg",".webp",".avif",".ico"]);

function parseImports(content) {
  const results = [];
  const re = /^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    const [raw, clause, source] = m;
    const defaultMatch = clause.match(/^(\w+)$/);
    const namedMatch   = clause.match(/^\{([^}]+)\}$/);
    const mixedMatch   = clause.match(/^(\w+)\s*,\s*\{([^}]+)\}$/);
    results.push({
      raw: raw.trim().replace(/;?\s*$/, ";"),
      source,
      defaultName: defaultMatch?.[1] ?? mixedMatch?.[1] ?? null,
      namedNames : namedMatch
        ? namedMatch[1].split(",").map(s=>s.trim()).filter(Boolean)
        : mixedMatch
        ? mixedMatch[2].split(",").map(s=>s.trim()).filter(Boolean)
        : [],
    });
  }
  return results;
}

function parseLazyImports(content) {
  const map = new Map();
  // handles trailing comma inside lazy( ... , )
  const re = /const\s+(\w+)\s*=\s*lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*["']([^"']+)["']\s*\)\s*,?\s*\)\s*;?/gs;
  let m;
  while ((m = re.exec(content)) !== null) map.set(m[1], m[2]);
  return map;
}

function extractSeoTitle(content) {
  const m =
    content.match(/<SEO[^>]+title=["']([^"']+)["']/) ||
    content.match(/<SEO[^>]+title=\{["'`]([^"'`]+)["'`]\}/);
  return m ? m[1].trim() : null;
}

// ── Content converter ─────────────────────────────────────────────────────────
function convertContent(original, pageName, layoutName, layoutFolder) {
  const seoTitle = extractSeoTitle(original);
  const lazyMap  = parseLazyImports(original);
  const imports  = parseImports(original);

  // ── Build kept regular imports ──────────────────────────────────────────
  const keptImports = [];
  for (const imp of imports) {
    if (imp.source === "react-router-dom") continue;

    // React import — strip removed identifiers
    if (imp.source === "react") {
      const kept = imp.namedNames.filter(n => !REMOVE_IDENTIFIERS.has(n));
      if (kept.length === 0 && !imp.defaultName) continue;
      if (imp.namedNames.length > 0) {
        if (kept.length > 0) keptImports.push(`import { ${kept.join(", ")} } from "react";`);
        continue;
      }
    }

    // Skip removed defaults
    if (imp.defaultName && REMOVE_IDENTIFIERS.has(imp.defaultName)) continue;
    // Skip purely-removed named sets
    if (imp.namedNames.length > 0 &&
        imp.namedNames.every(n => REMOVE_IDENTIFIERS.has(n))) continue;

    keptImports.push(imp.raw);
  }

  // ── Lazy → regular imports ──────────────────────────────────────────────
  const lazyToRegular = [];
  for (const [name, src] of lazyMap) {
    lazyToRegular.push(`import ${name} from "${src}";`);
  }

  // ── Extract JSX body ────────────────────────────────────────────────────
  const returnMatch = original.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*\}?\s*$/);
  let jsxBody = returnMatch ? returnMatch[1].trim() : "";

  // Remove <SEO ... />
  jsxBody = jsxBody.replace(/<SEO\b[^>]*\/>/gs, "").trim();

  // Unwrap wrapper components, keep inner content
  for (const tag of ["SuspenseWrapper","ErrorBoundary","Suspense"]) {
    jsxBody = jsxBody.replace(
      new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "g"),
      (_, inner) => inner
    );
  }

  // Clean blank lines
  jsxBody = jsxBody.replace(/\n{3,}/g, "\n\n").trim();

  // If outer wrapper is <> ... </> strip it so we can re-wrap cleanly
  if (jsxBody.startsWith("<>") && jsxBody.endsWith("</>")) {
    jsxBody = jsxBody.slice(2, -3).trim();
  }

  // Indent inner JSX content for layout wrap (4 extra spaces per level)
  const indented = jsxBody
    .split("\n")
    .map(l => "            " + l)
    .join("\n");

  // ── Assemble file ───────────────────────────────────────────────────────
  const metaImport   = seoTitle ? `import { Metadata } from "next";\n` : "";
  const layoutImport = `import ${layoutName} from "${layoutFolder}/${layoutName}";`;
  const reactImport  = `import React from "react";`;

  const allImports = [
    reactImport,
    metaImport,
    layoutImport,
    ...keptImports,
    ...lazyToRegular,
  ].filter(Boolean).join("\n");

  const metadataBlock = seoTitle
    ? `\nexport const metadata: Metadata = {\n    title: "${seoTitle}",\n};\n`
    : "";

  return (
`${allImports}
${metadataBlock}
const Page: React.FC = () => {
    return (
        <>
            <${layoutName}>
${indented}
            </${layoutName}>
        </>
    );
};

export default Page;
`
  );
}

// ── Process one home page file ────────────────────────────────────────────────
function processFile(filePath) {
  const original  = fs.readFileSync(filePath, "utf-8");
  const pageName  = path.basename(filePath, ".tsx");   // e.g. "HomeTwo"
  const segment   = componentNameToRoute(pageName);    // e.g. "index2"
  const outPath   = routeToOutputPath(segment);        // src/app/index2/page.tsx
  const layoutName = pageName + "Layout";              // e.g. "HomeTwoLayout"

  // Determine layout import path by segment type:
  //   index | index2 | index3 ...     → @/layouts/multipage
  //   index-one-page | index2-one-page → @/layouts/singlepage
  //   index-dark | index-{anything}   → @/layouts  (root)
  let layoutFolder;
  if (/^index\d*$/.test(segment)) {
    layoutFolder = "@/layouts/multipage";
  } else if (segment.includes("one-page")) {
    layoutFolder = "@/layouts/singlepage";
  } else {
    layoutFolder = "@/layouts";
  }

  const converted = convertContent(original, pageName, layoutName, layoutFolder);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, converted, "utf-8");

  return { pageName, segment, outPath, layoutName, layoutFolder };
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(HOME_DIR)) {
  console.error(`❌  Directory not found: ${HOME_DIR}`);
  console.error("    Run this from your project root (where src/ lives).");
  process.exit(1);
}

const files = fs
  .readdirSync(HOME_DIR)
  .filter(f => f.endsWith(".tsx") && !f.startsWith("_"))
  .map(f => path.join(HOME_DIR, f));

console.log(`🔍  Scanning: src/home\n`);
console.log(`📁  Found ${files.length} home page file(s).\n`);

// Preview the route mapping first
console.log("  Route mapping:");
for (const f of files) {
  const name    = path.basename(f, ".tsx");
  const segment = componentNameToRoute(name);
  const out     = segment === "index" ? "src/app/page.tsx" : `src/app/${segment}/page.tsx`;
  console.log(`    ${name.padEnd(20)} → ${out}`);
}
console.log("");

// ── Create files ──────────────────────────────────────────────────────────────
console.log(`✨ Creating routes...\n`);
const results = [];
for (const f of files) {
  try {
    const result = processFile(f);
    results.push(result);
    console.log(`  ✓ ${result.pageName.padEnd(20)} → ${result.outPath}`);
  } catch (err) {
    console.error(`  ✗ Failed to process ${path.basename(f)}: ${err.message}`);
  }
}

console.log("");
console.log(`✅ Successfully created ${results.length} route(s)!`);

