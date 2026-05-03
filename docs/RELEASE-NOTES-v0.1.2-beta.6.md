# Release Notes — v0.1.2-beta.6

> 2026-05-03. **Cosmetic carryover closed.** The JSON-RPC
> `initialize.serverInfo.version` now reads from `package.json` at
> boot rather than from a hardcoded literal that drifted twice
> (beta.4 and beta.5 both shipped reporting `0.1.2-beta.3`).
> Behaviour-preserving on every tool path; no new features. Soak
> period before promoting `0.1.2` stable.

## TL;DR

The single carryover tracked across HANDOFF §0 (Caveat cosmetico)
and §6.20 (Siguiente accion concreta #1) is closed and shipped
behind `npm install -g @netzi/recall@beta`:

| PR | Tag | Outcome |
|---|---|---|
| [#37](https://github.com/NetziTech/recall/pull/37) | server-info-version | New `resolvePackageVersion()` reads `version` from `package.json` at boot. Validates `name === "@netzi/recall"` so the resolver does not return e.g. vitest's `1.1.1` when running under the test runner. Returns the `0.0.0-unknown` sentinel if no candidate parses cleanly so the bootstrap never blocks on missing metadata. |

## How to install

```bash
# beta channel (this release)
npm install -g @netzi/recall@beta

# latest stable (deprecated 0.1.1, kept as warning until v0.1.2 stable lands)
npm install -g @netzi/recall@latest
```

After `v0.1.2` stable ships, the `latest` dist-tag will move to
`0.1.2` and `0.1.1` will be hard-deprecated.

## What was the bug

The bootstrap had this inline:

```ts
const serverInfo = options.serverInfo ?? {
  name: "recall",
  version: "0.1.2-beta.3",  // <-- hardcoded
  protocolVersion: "2024-11-05",
};
```

Releases v0.1.2-beta.4 and v0.1.2-beta.5 bumped `code/package.json`
but did NOT update this literal. The result: `npm view @netzi/recall
dist-tags.beta` returned `0.1.2-beta.5`, but the JSON-RPC handshake
on the same installed binary reported `0.1.2-beta.3`. Cosmetic only
(every tool kept working), but confused debugging.

The pre-existing E2E assertion was `expect(typeof serverInfo.version
).toBe("string")` — a textbook SHAPE-not-VALUES regression that
silently accepted any string. The Phase-9 rule "VALORES no SHAPE"
wasn't applied here originally; tightening the assertion is part of
this release.

## Highlights of the fix

### Use case — `resolvePackageVersion()`

New helper in `code/src/bootstrap/composition-root.ts`. Resolution
mirrors the `resolveDefaultMigrationsDir()` pattern (B-CLI-5):

1. **Anchored on `argv[1]`** — with `fs.realpathSync` to follow
   npm-global symlinks (`~/.nvm/.../bin/recall` → `~/.nvm/.../lib/
   node_modules/@netzi/recall/dist/server.js`). Tries
   sibling-of-`dist/` then sibling-of-`src/`.
2. **Anchored on `import.meta.url`** — useful for unit tests +
   tsx-imported bootstrap paths where `argv[1]` does not point at
   this module.

### Defences

- **Validates `name === "@netzi/recall"`** on each candidate. Without
  this, the unit test caught the resolver returning vitest's own
  `1.1.1` (anchored on the vitest binary's `argv[1]`). The name guard
  is also defence-in-depth against custom Node launchers.
- **Returns `0.0.0-unknown` sentinel** if no candidate parses
  cleanly. The bootstrap never blocks on missing package metadata;
  the obviously-fake string surfaces on the handshake so any client
  inspecting `initialize` can flag the install as broken.

### Cognitive complexity refactor (round 2)

PR #37 first push tripped two SonarQube quality-gate violations:

- **S3776 CRITICAL** — `resolvePackageVersion` complexity 19 > 15
  (4 nested try/catch + name-guard + version-shape checks inside
  the candidate loop).
- **S4144 MAJOR** — `resolvePackageVersion` and
  `resolveDefaultMigrationsDir` shared an identical inline
  `pushCandidate` helper + identical anchor walks.

Refactor — single shared helper + extract-method:

- New `collectFsCandidates(builder)` walks both anchors
  (`argv[1]` with realpath; `import.meta.url`) and de-duplicates
  the builder-supplied candidates. Discriminator `AnchorKind` lets
  the caller decide per-anchor candidates (the migrations resolver
  intentionally skips `<here>/../migrations` under `importMeta`
  because that path resolves to `code/src/migrations/` which never
  exists).
- New `readPackageVersionField(candidate)` encapsulates the
  parse + name-guard + version-shape branches. Returns `null` on
  every failure mode so the caller is a flat
  `for ... if (version !== null) return`.
- Both `resolveDefaultMigrationsDir` and `resolvePackageVersion`
  invoke `collectFsCandidates` instead of inlining the anchor walk.
  The migrations resolver keeps its 3-candidate per-argv-anchor
  shape and reduced 2-candidate `importMeta` shape — preserving
  B-CLI-5 + the asymmetry that protects against the non-existent
  `code/src/migrations/` candidate.

## Tests (VALUES not SHAPE)

- **New unit suite** `code/tests/unit/bootstrap/composition-root.test.ts`
  (3 tests): exact-match against `code/package.json#version`,
  non-empty + non-sentinel guard, SemVer-shape regex.
- **Tightened existing E2E** in `B-mcp-server-binary.test.ts`:
  ```diff
  - expect(typeof result.serverInfo.version).toBe("string");
  + expect(result.serverInfo.version).toBe(readPackageJsonVersion());
  ```
- **E2E harness fix** — `binary-harness.ts` now copies
  `code/package.json` to the staging tree (`<staging>/code/
  package.json`) so the bundled binary's resolver finds the same
  version string the test asserts. Mirrors the npm-install layout.

**Total: 2560 tests passing in 212 files** (was 2557 in 211 at
beta.5).

## Why this escaped beta.4 and beta.5

The pre-existing E2E assertion accepted any string. Two consecutive
releases shipped reporting an old version because nobody noticed
during PR review (the literal lived in a comment-heavy file that did
not naturally surface in version-bump diffs). Codifying the VALUE
assertion + reading from `package.json` at runtime eliminates the
class of bug.

## Engineering metrics

- 5+1 EXIT=0 on PR #37 (round 2 after Sonar refactor):
  `typecheck` + `lint` + `lint:tests` + `validate:modules` +
  `build` + `test`.
- **2560 tests passing in 212 files** (+3 vs 2557 at beta.5).
- SonarQube quality gate `MCP Memoria Strict` PASSED on round 2
  (Reliability A, Security A, Maintainability A, 0 bugs /
  0 vulnerabilities / 0 blockers / 0 critical violations,
  coverage on overall code 96.4%, sqale_debt_ratio 1.45% on new
  code — well under the 5% limit).
- Cero `any`, cero `as any`, cero `// @ts-ignore`.

## Outstanding caveats

- `encryption_status="locked"` is still the conservative default for
  workspaces in `encrypted` mode (B-MCP-2 caveat carried forward).
- `size_bytes.vectors_db = 0` (always). The vec0 virtual table lives
  inside `recall.db`; there is no separate vectors file. Wire field
  preserved for back-compat with v0.1.0 clients.
- Two upstream `tar` highs via `fastembed` remain `wontfix` per
  ADR-004 (`docs/12 §1.5.4`).

## Path to v0.1.2 stable

This is the last cosmetic / non-functional fix planned before
promoting `0.1.2` to the `latest` dist-tag. The plan:

1. Soak `0.1.2-beta.6` in real use for 24-48h via Claude Code's
   MCP client.
2. If no new bugs surface (the dogfood loop has caught one bug per
   beta release since `beta.0`), cut `release/0.1.2` (no suffix)
   from `develop`.
3. `npm publish` (without `--tag beta` → publishes to `latest`),
   then `npm deprecate @netzi/recall@0.1.0` + `@0.1.1` with
   messages pointing at `0.1.2`.

## Acknowledgements

- The carryover was caught by the post-publish smoke of beta.5
  itself — the smoke script logged `serverInfo.version: "0.1.2-beta.3"`
  next to the actual installed binary `0.1.2-beta.5`. Lesson
  reinforced Phase-9 / Phase-15: structured smoke against the real
  package + dogfood DB catches what no test in the repo can.
- The Sonar refactor (round 2) was triggered by the quality gate,
  not human review. The gate's S4144 caught the inline `pushCandidate`
  duplication that nobody noticed during the first PR push — the
  gate is doing useful work as a second reviewer.
