#!/usr/bin/env node
/**
 * Entrypoint for the `recall-server` binary. Listens on stdio
 * for line-delimited JSON-RPC frames and dispatches to the wired
 * MCP tool use cases.
 *
 * Wire path:
 *   1. Build the composition container with the workspace at
 *      `process.cwd()`. The bootstrap opens the SQLite database and
 *      runs migrations BEFORE returning the container — the MCP
 *      protocol's `initialize` handshake assumes the server is
 *      ready.
 *   2. Wire the `StdioJsonRpcServer` against `process.stdin` /
 *      `process.stdout` and `await server.start()`.
 *   3. Register `SIGTERM` / `SIGINT` to call `server.stop()` and
 *      `shutdown()` so the database closes cleanly.
 *
 * stdout discipline: `StdioJsonRpcServer` writes only JSON-RPC
 * responses to stdout. Every other observability sink (logs, errors)
 * is the `Logger` port (a `PinoLogger` wired to stderr by default).
 */

import process from "node:process";

import { bootstrapComposition } from "./composition-root.ts";

async function main(): Promise<number> {
  // The MCP stdio protocol owns stdout exclusively — every log frame
  // MUST land on stderr or it gets parsed as a JSON-RPC response by
  // strict clients (see Bug B-016 and `docs/02 §6`). The bootstrap
  // accepts a `logDestination` option that the shared logger wiring
  // forwards to pino as a `pino.destination(fd)` sink.
  const { container, shutdown } = await bootstrapComposition({
    workspaceRoot: process.cwd(),
    skipDatabase: false,
    logDestination: 2,
  });

  const server = container.mcpServer.buildStdioServer({
    stdin: process.stdin,
    stdout: process.stdout,
  });

  // Drain the embedding queue in the background. Without this the
  // `embedding_queue` rows that `mem.remember` enqueues never get
  // embedded — `mem.recall` silently falls back to BM25-only and the
  // semantic-recall guarantee of the product is broken (Bug B-MCP-3).
  // The worker is constructed by `buildRetrievalWiring`; the bootstrap
  // entrypoint only owns its lifecycle.
  container.retrieval.embeddingWorker.start();

  // The closure mutates `value` through the `state` object so the
  // narrow analysis in TypeScript / ESLint cannot prove the field is
  // always `false` at the `try`/`finally` boundary below.
  const state: { value: boolean } = { value: false };
  const onSignal = (signal: NodeJS.Signals): void => {
    if (state.value) return;
    state.value = true;
    container.logger.info({ signal }, "mcp-server received signal; shutting down");
    server.stop();
    // Stop the embedding worker before closing the database. The
    // worker awaits any in-flight `drainBatch` so we cannot pull the
    // SQLite connection out from under it.
    void container.retrieval.embeddingWorker
      .stop()
      .finally(() => shutdown())
      .finally(() => {
        process.exit(signal === "SIGTERM" ? 143 : 130);
      });
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  container.logger.info(
    {
      workspaceRoot: process.cwd(),
      protocolVersion: "2024-11-05",
    },
    "recall-server starting; waiting for stdio frames",
  );

  try {
    await server.start();
    return 0;
  } catch (err: unknown) {
    container.logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "mcp-server stopped with an unhandled error",
    );
    return 1;
  } finally {
    if (!state.value) {
      await container.retrieval.embeddingWorker.stop();
      await shutdown();
    }
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((err: unknown) => {
    process.stderr.write(
      `recall-server: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
