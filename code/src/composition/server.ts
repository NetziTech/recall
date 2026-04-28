/**
 * Build entrypoint for the `mcp-memoria-server` binary. `tsup`
 * bundles this file (see `code/package.json` `build` script) and
 * the result becomes `dist/server.js`.
 *
 * The actual runtime lives in `bootstrap/mcp-server-entrypoint.ts`;
 * this file is a one-liner so the build script can target a stable
 * path under `composition/`.
 */

import "../bootstrap/mcp-server-entrypoint.ts";
