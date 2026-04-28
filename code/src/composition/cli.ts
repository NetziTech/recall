/**
 * Build entrypoint for the `recall` CLI binary. `tsup` bundles
 * this file (see `code/package.json` `build` script) and the result
 * becomes `dist/cli.js`.
 *
 * The actual runtime lives in `bootstrap/cli-entrypoint.ts`; this
 * file is a one-liner so the build script can target a stable path
 * under `composition/`.
 */

import "../bootstrap/cli-entrypoint.ts";
