# Release Notes — v0.1.1

> Same-day patch release. 2026-04-28.

## Why a same-day patch?

Real-world dogfood from Claude Code immediately after publishing
`@netzi/recall@0.1.0` exposed a critical architectural bug
(**B-MCP-1**) that prevented every MCP tool from completing an
invocation with standard MCP clients.

`@netzi/recall@0.1.0` is **deprecated** and should not be used.
Upgrade to `0.1.1`:

```bash
npm install -g @netzi/recall@latest
```

## What changed

### B-MCP-1 — facades resolve workspace_id from bootstrap, not wire input

Pre-existing bug from the original MVP, surfaced by the v0.1.0 dogfood.

**Symptom.** Calling any of the 5 MCP tools (`mem.context`,
`mem.recall`, `mem.remember`, `mem.task`, `mem.health`) from Claude
Code or any other standard MCP client returned either:

- `McpFacadeNotImplementedError` for the four "regular" tools, or
- a `WorkspaceId must be a valid UUID v7` error for `mem.health`
  (which used a hardcoded `00000000-0000-0000-0000-000000000000`
  placeholder that is not even a valid v7 UUID).

The MCP `initialize` handshake still succeeded — `claude mcp list`
correctly reported "Connected" — but no tool actually worked.

**Cause.** The 5 facade adapters in
`composition/facades/mcp-server-facades.ts` resolved `workspace_id`
exclusively from the wire input (`tools/call`'s `arguments` field),
even though the bootstrap had already resolved the canonical
`WorkspaceId` from `.recall/config.json` via `tryReadWorkspaceId`.
Standard MCP clients do not pass `workspace_id` on each call — the
convention is for the server to derive it from its own cwd.

**Why the v0.1.0 tests did not catch it.** Both unit and E2E suites
explicitly pass `arguments: { workspace_id: ws.workspaceId }` on every
`tools/call`, mimicking a non-existent client behaviour. When tests
mirror the bug, the bug stays.

**Fix.**

- `WorkspaceId` is now injected by constructor into all 5 facade
  adapters from the container's already-resolved value.
- The wire `workspace_id` field is now **optional** on every
  `tools/call`. When present, it overrides (useful for E2E tests and
  potential future multi-workspace clients). When absent, the
  bootstrap value is used.
- Renamed `resolveWorkspaceIdFromWire(raw)` to
  `resolveWorkspaceId(injected, wire)` with the priority documented in
  JSDoc.
- Removed the hardcoded `00000000-0000-0000-0000-000000000000`
  placeholder from `CheckHealthFacadeAdapter`.
- Malformed `workspace_id` overrides now raise
  `InvalidInputError` (`-32602 INVALID_PARAMS`) instead of the
  semantically wrong `McpFacadeNotImplementedError`.

**Coverage gap closed.** A new E2E suite
(`tests/e2e/B-mcp-server-binary.test.ts` § "tools/call without
`workspace_id` (B-MCP-1)") exercises every tool with `arguments: {}`
against the real `dist/server.js` over JSON-RPC stdio — the exact
behaviour of Claude Code. 11 unit tests cover the new resolver paths
(absent / override / malformed).

### Wire schema note: `memoria_db` field preserved

The `mem.health` response shape contains a legacy field name
`size_bytes.memoria_db` carried over from `@netzi/mcp-memoria@0.1.0`.
Renaming it to `recall_db` would break clients that snapshotted the
shape. Keeping the legacy name is a deliberate decision tracked as
explicit wire-schema debt in `docs/02-protocolo-mcp.md` §4.6 and
pinned by a regression test. Will be cleaned up in the next major.

## Engineering

- **2501 tests passing** across 205 test files (+18 vs. v0.1.0).
- All 5 checks EXIT=0 (`typecheck` / `lint` / `validate:modules` /
  `build` / `test`).
- `npm audit --omit=dev` unchanged: 2 high upstream advisories tracked
  as wontfix per ADR-004 (see v0.1.0 notes).

## Install

```bash
npm install -g @netzi/recall@0.1.1
# Or pin explicitly:
npx @netzi/recall@0.1.1 init --mode shared
```

Requires Node.js 20+.

## Acknowledgements

The bug was caught the moment the MCP was first invoked from a real
Claude Code session — 4 minutes after the `@netzi/recall@0.1.0`
`npm publish` returned 200. This is exactly why dogfood matters and
why same-day patches earn their existence.

---

[Full HANDOFF](../HANDOFF.md) ·
[Architecture docs](../docs/) ·
[GitHub](https://github.com/NetziTech/recall)
