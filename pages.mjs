import fs from "fs";
import path from "path";

// ── Config ────────────────────────────────────────────────────────────────────
const PAGES_DIR   = path.resolve("src/pages");
const APP_DIR     = path.resolve("src/app/(pages)");
const EXTENSIONS  = [".tsx"];

// Imports to strip entirely (these concepts don't exist in Next.js pages)
const REMOVE_IMPORT_IDENTIFIERS = new Set([
  "lazy",
  "SEO",
  "ErrorBoundary",
  "SuspenseWrapper",
  "Suspense",          // React.Suspense sometimes used directly
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "About" → "about",  "HomeOne" → "home-one",  "BlogGrid" → "blog-grid" */
function toRouteSegment(name) {
  return name
    .replace(/([A-Z])/g, (m, l, offset) => (offset > 0 ? "-" : "") + l.toLowerCase())
    .replace(/^-/, "");
}

/** Extract SEO title from  <SEO title="..." />  or  <SEO title={"..."} /> */
function extractSeoTitle(content) {
  const m =
    content.match(/<SEO[^>]+title=["']([^"']+)["']/) ||
    content.match(/<SEO[^>]+title=\{["'`]([^"'`]+)["'`]\}/);
  return m ? m[1].trim() : null;
}

/**
 * Parse all import lines in the file and return an array of objects:
 *   { raw, defaultName, namedNames, source }
 */
function parseImports(content) {
  const results = [];
  const re = /^import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    const [raw, clause, source] = m;
    // default import:   import Foo from
    const defaultMatch = clause.match(/^(\w+)$/);
    // named imports:    { A, B }
    const namedMatch = clause.match(/^\{([^}]+)\}$/);
    // mixed:            Foo, { A }  — rare but handle
    const mixedMatch = clause.match(/^(\w+)\s*,\s*\{([^}]+)\}$/);

    results.push({
      raw,
      source,
      defaultName: defaultMatch
        ? defaultMatch[1]
        : mixedMatch
        ? mixedMatch[1]
        : null,
      namedNames: namedMatch
        ? namedMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
        : mixedMatch
        ? mixedMatch[2].split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    });
  }
  return results;
}

/**
 * Collect lazy-loaded components:
 *   const Foo = lazy(() => import("@/features/..."))
 * Returns Map: name → source path
 */
function parseLazyImports(content) {
  const map = new Map();
  // const Name = lazy(() => import("path"))   or   lazy(\n  () => import("path"))
  const re =
    /const\s+(\w+)\s*=\s*lazy\s*\(\s*\(\s*\)\s*=>\s*import\s*\(\s*["']([^"']+)["']\s*\)\s*,?\s*\)\s*;?/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

/**
 * Build the final page.tsx content.
 */
function convertPage(original, pageName) {
  const seoTitle   = extractSeoTitle(original);
  const lazyMap    = parseLazyImports(original);
  const imports    = parseImports(original);

  // ── 1. Collect regular (non-lazy, non-removed) imports ───────────────────
  const keptImports = [];

  for (const imp of imports) {
    // Skip react-router-dom
    if (imp.source === "react-router-dom") continue;

    // Handle  import { lazy, useState, ... } from "react"
    if (imp.source === "react") {
      const kept = imp.namedNames.filter(
        (n) => !REMOVE_IMPORT_IDENTIFIERS.has(n)
      );
      // If there's nothing left from react, skip
      if (kept.length === 0 && !imp.defaultName) continue;
      if (imp.namedNames.length > 0) {
        // Rebuild without removed identifiers
        if (kept.length > 0) {
          keptImports.push(
            `import { ${kept.join(", ")} } from "react";`
          );
        }
        continue;
      }
    }

    // Skip imports whose default name is in the removal list
    if (imp.defaultName && REMOVE_IMPORT_IDENTIFIERS.has(imp.defaultName)) continue;

    // Skip named-only imports that are entirely in removal list
    if (
      imp.namedNames.length > 0 &&
      imp.namedNames.every((n) => REMOVE_IMPORT_IDENTIFIERS.has(n))
    )
      continue;

    keptImports.push(imp.raw.trim().replace(/;?\s*$/, ";"));
  }

  // ── 2. Build regular imports for lazy components ──────────────────────────
  const lazyToRegular = [];
  for (const [name, src] of lazyMap) {
    lazyToRegular.push(`import ${name} from "${src}";`);
  }

  // ── 3. Build the JSX body ─────────────────────────────────────────────────
  // Extract the return statement's JSX content
  const returnMatch = original.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*;?\s*\}?\s*$/);
  let jsxBody = returnMatch ? returnMatch[1].trim() : "";

  // Remove <SEO ... />  (self-closing, possibly multi-line)
  jsxBody = jsxBody.replace(/<SEO\b[^>]*\/>/gs, "").trim();

  // Unwrap <SuspenseWrapper>…</SuspenseWrapper>  →  inner content
  jsxBody = jsxBody.replace(
    /<SuspenseWrapper[^>]*>([\s\S]*?)<\/SuspenseWrapper>/g,
    (_, inner) => inner
  );

  // Unwrap <ErrorBoundary …>…</ErrorBoundary>  →  inner content
  jsxBody = jsxBody.replace(
    /<ErrorBoundary[^>]*>([\s\S]*?)<\/ErrorBoundary>/g,
    (_, inner) => inner
  );

  // Unwrap <Suspense …>…</Suspense>  →  inner content
  jsxBody = jsxBody.replace(
    /<Suspense[^>]*>([\s\S]*?)<\/Suspense>/g,
    (_, inner) => inner
  );

  // Clean up extra blank lines inside JSX
  jsxBody = jsxBody.replace(/\n{3,}/g, "\n\n").trim();

  // ── 4. Assemble final file ────────────────────────────────────────────────
  const metadataBlock = seoTitle
    ? `\nexport const metadata: Metadata = {\n    title: "${seoTitle}",\n};\n`
    : "";

  const metadataImport = seoTitle
    ? `import { Metadata } from "next";\n`
    : "";

  const allImports = [
    metadataImport,
    ...keptImports,
    ...lazyToRegular,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    `${allImports}\n` +
    `${metadataBlock}\n` +
    `export default function Page() {\n` +
    `    return (\n` +
    `        ${jsxBody}\n` +
    `    );\n` +
    `}\n`
  );
}

// ── Process one page file ─────────────────────────────────────────────────────
function processFile(filePath) {
  const original  = fs.readFileSync(filePath, "utf-8");
  const pageName  = path.basename(filePath, ".tsx"); // "About"
  let segment   = toRouteSegment(pageName);        // "about"
  if (segment == 'error404') {
    segment = '404';
  }
  const outDir    = path.join(APP_DIR, segment);
  const outFile   = path.join(outDir, "page.tsx");

  const converted = convertPage(original, pageName);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, converted, "utf-8");

  return { pageName, segment, outFile };
}

// ── Main ──────────────────────────────────────────────────────────────────────
if (!fs.existsSync(PAGES_DIR)) {
  console.error(`❌  Directory not found: ${PAGES_DIR}`);
  console.error("    Run this from your project root (where src/ lives).");
  process.exit(1);
}

const files = fs
  .readdirSync(PAGES_DIR)
  .filter((f) => EXTENSIONS.includes(path.extname(f)) && !f.startsWith("_"))
  .map((f) => path.join(PAGES_DIR, f));

console.log(`🔍  Scanning: src/pages\n`);
console.log(`📁  Found ${files.length} page file(s).\n`);

let converted = 0;
for (const f of files) {
  try {
    const { pageName, segment, outFile } = processFile(f);
    const rel = path.relative(process.cwd(), outFile);
    console.log(`  ✅  ${pageName}.tsx  →  ${rel}`);
    converted++;
  } catch (err) {
    console.error(`  ❌  Failed: ${f}\n     ${err.message}`);
  }
}

console.log(`\n✨  Done! Converted ${converted} page(s) into src/app/(pages)/.`);
