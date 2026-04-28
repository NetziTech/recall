import { promises as fs } from "node:fs";
import * as path from "node:path";

import { defineConfig } from "tsup";

/**
 * Build configuration for the two distributable entrypoints:
 *   - `dist/cli.js`    — the `recall` CLI binary.
 *   - `dist/server.js` — the `recall-server` MCP stdio server.
 *
 * Native and embedder dependencies are kept EXTERNAL: bundling them
 * would either fail (native `.node` binaries) or balloon the bundle
 * with WASM/ONNX assets we do not need to inline. They are loaded at
 * runtime from the consumer's `node_modules/` (or the workspace's
 * model cache, in the case of `fastembed`). The `dependencies` field
 * of `package.json` is the single source of truth for what is
 * expected at install time.
 *
 * `--bundle` flag note: tsup 7.x+ bundles by default and rejects an
 * explicit `--bundle` flag. Bundling stays implicit here.
 *
 * Migrations bundling (Bug B-009 fix):
 *   The bootstrap's `resolveDefaultMigrationsDir` checks
 *   `<entrypoint-dir>/migrations/` first and falls back to
 *   `<entrypoint-dir>/../migrations/`. After a successful build we
 *   copy `code/migrations/*.sql` into `dist/migrations/` so a packaged
 *   release is self-contained (the binary does not need the
 *   surrounding repo on disk to find its SQL).
 */
export default defineConfig({
  entry: {
    cli: "src/composition/cli.ts",
    server: "src/composition/server.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  shims: false,
  // The shebang on `bootstrap/{cli,mcp-server}-entrypoint.ts` is
  // preserved by tsup automatically when the entry file (or a file
  // it re-exports verbatim) starts with `#!/usr/bin/env node`. The
  // `composition/{cli,server}.ts` shims do NOT carry a shebang on
  // purpose — the bundled output gets one prepended below.
  banner: {
    js: "#!/usr/bin/env node",
  },
  // Native modules and large model runtimes stay external; bundling
  // them is either impossible (`.node` files) or pointless (model
  // weights are downloaded at runtime).
  external: [
    "better-sqlite3-multiple-ciphers",
    "sqlite-vec",
    "fastembed",
    "tiktoken",
    "onnxruntime-node",
    // The MCP SDK ships its own ESM/CJS hybrid; let Node resolve it
    // at runtime so the SDK's internal exports map remains intact.
    "@modelcontextprotocol/sdk",
  ],
  async onSuccess(): Promise<void> {
    // Copy `code/migrations/` → `code/dist/migrations/` so the
    // shipped binary can resolve its SQL via the
    // `<entrypoint-dir>/migrations/` candidate without depending on
    // the surrounding repo layout. Idempotent — safe to re-run on
    // every `tsup` rebuild.
    const srcDir = path.resolve("migrations");
    const dstDir = path.resolve("dist", "migrations");
    try {
      const stat = await fs.stat(srcDir);
      if (!stat.isDirectory()) return;
    } catch {
      // No migrations folder in this checkout — skip silently.
      return;
    }
    await fs.mkdir(dstDir, { recursive: true });
    const entries = await fs.readdir(srcDir);
    for (const entry of entries) {
      if (!entry.endsWith(".sql")) continue;
      const src = path.join(srcDir, entry);
      const dst = path.join(dstDir, entry);
      await fs.copyFile(src, dst);
    }
  },
});
