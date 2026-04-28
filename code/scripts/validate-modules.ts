#!/usr/bin/env tsx
/**
 * validate-modules.ts — enforces the modularity rules of
 * `docs/12-lineamientos-arquitectura.md` §1.5 and §1.5.1 (ADR-001).
 *
 * Rules enforced:
 *   1. Modules under `src/modules/<name>/` MUST NOT import from a sibling
 *      module, with the only exceptions explicitly authorised by ADR-001
 *      in `docs/12 §1.5.1`:
 *        - `retrieval/**` → `memory/domain/**`
 *        - `curator/**`   → `memory/domain/**`
 *   2. Imports from `shared/**` are always allowed.
 *   3. Imports relative within the same module are allowed.
 *   4. The composition root (`src/composition/**`) is intentionally
 *      allowed to import any module, since it is the dependency wiring
 *      site (per §1.5 Regla 4). It is therefore NOT validated by this
 *      script.
 *   5. Direct circular imports (file A imports file B which imports
 *      file A) are detected and reported.
 *
 * Mechanics:
 *   - No `tsc` API is used. Each `.ts` file is parsed with a regex over
 *     ECMAScript `import` / `export … from` / `import(...)` forms. This
 *     is sufficient because the codebase forbids dynamic module
 *     resolution and `// @ts-ignore` (see `eslint.config.js` and
 *     `tsconfig.json`), so all module dependencies are statically
 *     declared with literal string specifiers.
 *   - Specifiers are resolved relative to the importing file. Only
 *     specifiers that resolve to within `src/` are inspected; npm
 *     packages and Node built-ins are ignored.
 *
 * Exit code:
 *   - 0 if no violations.
 *   - 1 if any violation is found. A summary is printed regardless.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// ─── Types ─────────────────────────────────────────────────────────────

interface ImportRecord {
  readonly importerAbs: string;
  readonly specifier: string;
  readonly resolvedAbs: string | null;
}

interface Violation {
  readonly importer: string;
  readonly importerModule: string;
  readonly specifier: string;
  readonly target: string;
  readonly targetModule: string;
  readonly reason: string;
}

interface CycleViolation {
  readonly fileA: string;
  readonly fileB: string;
}

interface AuthorisedException {
  readonly fromModule: string;
  /** Glob fragment matched against the resolved import path relative to `src/`. */
  readonly toPathPrefix: string;
}

// ─── Constants ─────────────────────────────────────────────────────────

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);
const PROJECT_ROOT: string = path.resolve(__dirname, "..");
const SRC_DIR: string = path.join(PROJECT_ROOT, "src");
const MODULES_DIR: string = path.join(SRC_DIR, "modules");

/**
 * Cross-module imports authorised by ADR-001 (`docs/12 §1.5.1`).
 *
 * If you add a new entry here, you MUST also amend ADR-001 in the same
 * change set: contexto + decision + alternatives + consecuencias + fecha.
 */
const ADR_001_AUTHORISED_EXCEPTIONS: readonly AuthorisedException[] = [
  { fromModule: "retrieval", toPathPrefix: "modules/memory/domain/" },
  { fromModule: "curator", toPathPrefix: "modules/memory/domain/" },
];

// ─── Helpers ──────────────────────────────────────────────────────────

async function walkTsFiles(rootDir: string): Promise<readonly string[]> {
  const out: string[] = [];

  async function visit(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        await visit(full);
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
  }

  await visit(rootDir);
  return out;
}

/**
 * Returns the immediate sub-directory name under `src/modules/` for the
 * given absolute path, or `null` if the path is not inside `src/modules/`.
 */
function moduleOf(fileAbs: string): string | null {
  const rel = path.relative(MODULES_DIR, fileAbs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const [moduleName] = rel.split(path.sep);
  return moduleName ?? null;
}

const IMPORT_RE: RegExp =
  /(?:^|[\n;])\s*(?:import\s+(?:[\s\S]*?)\s+from\s*|export\s+[\s\S]*?\s+from\s*|import\s*)['"]([^'"]+)['"]/g;

function extractSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  // Strip block + line comments to avoid matching imports inside JSDoc.
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const match of stripped.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (spec !== undefined && spec.length > 0) specifiers.push(spec);
  }
  return specifiers;
}

/**
 * Resolves a specifier relative to an importer to an absolute file path
 * inside `src/`, or `null` if the specifier points outside (npm package,
 * Node builtin, etc.).
 */
function resolveSpecifier(importerAbs: string, specifier: string): string | null {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) return null;
  const importerDir = path.dirname(importerAbs);
  let resolved = path.resolve(importerDir, specifier);
  // Imports use explicit `.ts` extensions in this codebase, so no
  // extension probing is required. If the extension is missing we add
  // `.ts` defensively.
  if (!resolved.endsWith(".ts")) resolved = `${resolved}.ts`;
  if (!resolved.startsWith(SRC_DIR)) return null;
  return resolved;
}

function isAuthorisedException(
  fromModule: string,
  resolvedRelToSrc: string,
): boolean {
  for (const allow of ADR_001_AUTHORISED_EXCEPTIONS) {
    if (allow.fromModule === fromModule && resolvedRelToSrc.startsWith(allow.toPathPrefix)) {
      return true;
    }
  }
  return false;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  // 1. Collect every .ts file under src/.
  const allFiles = await walkTsFiles(SRC_DIR);

  // 2. Build a map of imports per file.
  const imports: ImportRecord[] = [];
  for (const file of allFiles) {
    const source = await fs.readFile(file, "utf8");
    for (const spec of extractSpecifiers(source)) {
      imports.push({
        importerAbs: file,
        specifier: spec,
        resolvedAbs: resolveSpecifier(file, spec),
      });
    }
  }

  // 3. Walk the module graph.
  const violations: Violation[] = [];
  const authorisedTouches = new Map<string, number>();

  for (const rec of imports) {
    if (rec.resolvedAbs === null) continue; // npm pkg / builtin
    const importerModule = moduleOf(rec.importerAbs);
    const targetModule = moduleOf(rec.resolvedAbs);

    // Imports from outside modules/ (e.g. composition/, shared/) are
    // not policed here — composition is allowed to wire modules and
    // shared/ never imports into modules/ directionally.
    if (importerModule === null) continue;

    // Target lives outside any module (shared/ or composition/, etc.).
    // Imports to shared/ are always permitted; imports to composition/
    // from a module would be a layering violation but composition does
    // not own importable types so we ignore that direction.
    if (targetModule === null) continue;

    // Same-module — fine.
    if (importerModule === targetModule) continue;

    const resolvedRelToSrc = path.relative(SRC_DIR, rec.resolvedAbs);

    if (isAuthorisedException(importerModule, resolvedRelToSrc)) {
      const key = `${importerModule}->${targetModule}`;
      authorisedTouches.set(key, (authorisedTouches.get(key) ?? 0) + 1);
      continue;
    }

    violations.push({
      importer: path.relative(PROJECT_ROOT, rec.importerAbs),
      importerModule,
      specifier: rec.specifier,
      target: path.relative(PROJECT_ROOT, rec.resolvedAbs),
      targetModule,
      reason:
        importerModule !== targetModule
          ? `cross-module import not authorised by ADR-001 (${importerModule} -> ${targetModule})`
          : "unexpected",
    });
  }

  // 4. Detect direct cycles (A->B and B->A at the file level).
  const edgeSet = new Set<string>();
  for (const rec of imports) {
    if (rec.resolvedAbs !== null) {
      edgeSet.add(`${rec.importerAbs}=>${rec.resolvedAbs}`);
    }
  }
  const cycles: CycleViolation[] = [];
  for (const edge of edgeSet) {
    const [a, b] = edge.split("=>");
    if (a === undefined || b === undefined) continue;
    if (a === b) continue;
    const reverse = `${b}=>${a}`;
    if (edgeSet.has(reverse) && a < b) {
      cycles.push({
        fileA: path.relative(PROJECT_ROOT, a),
        fileB: path.relative(PROJECT_ROOT, b),
      });
    }
  }

  // 5. Print module summary.
  process.stdout.write("\nModule import audit\n");
  process.stdout.write("===================\n");

  const moduleNames = (await fs.readdir(MODULES_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const mod of moduleNames) {
    const authorised = Array.from(authorisedTouches.entries())
      .filter(([key]) => key.startsWith(`${mod}->`))
      .map(([key, count]) => `${key.split("->")[1] ?? "?"}×${String(count)}`);
    const offenders = violations.filter((v) => v.importerModule === mod);
    const status = offenders.length === 0 ? "OK" : "FAIL";
    const detail =
      authorised.length > 0
        ? ` (authorised cross-imports: ${authorised.join(", ")})`
        : "";
    process.stdout.write(`  [${status}] ${mod}${detail}\n`);
  }

  if (violations.length === 0 && cycles.length === 0) {
    process.stdout.write("\nResult: PASS — no module violations.\n\n");
    return 0;
  }

  if (violations.length > 0) {
    process.stdout.write(`\n${String(violations.length)} cross-module violation(s):\n`);
    for (const v of violations) {
      process.stdout.write(
        `  - ${v.importer}\n      imports "${v.specifier}"\n      → ${v.target}\n      (${v.reason})\n`,
      );
    }
  }

  if (cycles.length > 0) {
    process.stdout.write(`\n${String(cycles.length)} direct import cycle(s):\n`);
    for (const c of cycles) {
      process.stdout.write(`  - ${c.fileA}  <->  ${c.fileB}\n`);
    }
  }

  process.stdout.write("\nResult: FAIL\n\n");
  return 1;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    process.stderr.write(`validate-modules: unexpected error: ${String(err)}\n`);
    process.exit(2);
  });
