/**
 * Embedder smoke for `TransformersEmbedder` — the sole backend since
 * `v0.1.3` (after `FastembedEmbedder` was removed; see `HANDOFF.md`
 * §6.32 for the swap rationale).
 *
 * Exercises `TransformersEmbedder` against a small corpus of
 * representative sentences and prints:
 *  - the model dimension reported by the adapter,
 *  - the dimension of the produced vectors (defence in depth),
 *  - the cold-start latency (first call, including model download),
 *  - the warm latency (subsequent call),
 *  - the L2 norm of each vector (BGE outputs are L2-normalised, so we
 *    expect a magnitude near 1.0).
 *
 * The script is OPT-IN: it downloads ~50 MB of model weights from
 * HuggingFace Hub the first time, and shells onto the real network.
 * It is NOT part of `npm run ci`. To run:
 *
 *   nvm use --lts=krypton
 *   cd code
 *   npx tsx scripts/embedder-parity-smoke.ts
 *
 * Pass criteria (defined inline below) — printed at the end of the
 * run as either PASS or FAIL with the offending check.
 *
 * The original POC version compared `FastembedEmbedder` and
 * `TransformersEmbedder` side-by-side; the result (dim parity 384,
 * L2-norm 1.0 across both backends, transformers warm batch ~65×
 * faster) is preserved in `HANDOFF.md` §6.32. After the fastembed
 * adapter was removed, this script keeps the smoke as a single-backend
 * regression artefact.
 */

import * as os from "node:os";
import * as path from "node:path";

import { TransformersEmbedder } from "../src/shared/infrastructure/embedder/transformers-embedder.ts";

const CORPUS: readonly string[] = [
  "decision: adopt MCP for recall",
  "learning: SQLCipher requires page-aligned key",
  "task: implement embedder swap proof of concept",
];

const EXPECTED_DIM = 384;
const NORM_TOLERANCE = 0.05; // BGE normalisation should land in [0.95, 1.05]

interface BackendReport {
  readonly backend: string;
  readonly declaredDim: number;
  readonly producedDim: number;
  readonly coldStartMs: number;
  readonly warmCallMs: number;
  readonly vectorL2Norms: readonly number[];
  readonly firstFiveValues: readonly number[];
}

function l2Norm(vector: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) {
    const v = vector[i] ?? 0;
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares);
}

async function exerciseTransformers(): Promise<BackendReport> {
  const cacheDir = path.join(os.homedir(), ".cache", "recall", "models");
  const embedder = new TransformersEmbedder({
    cacheDir,
    modelName: "Xenova/bge-small-en-v1.5",
  });
  const declaredDim = embedder.dimension();

  const coldStart = performance.now();
  const [first] = await embedder.embedBatch([CORPUS[0]!]);
  const coldStartMs = performance.now() - coldStart;
  if (!first) throw new Error("transformers produced no vector");

  const warmStart = performance.now();
  const rest = await embedder.embedBatch([CORPUS[1]!, CORPUS[2]!]);
  const warmCallMs = performance.now() - warmStart;

  const vectors = [first, ...rest];
  return {
    backend: "transformers (Xenova/bge-small-en-v1.5)",
    declaredDim,
    producedDim: first.vector.length,
    coldStartMs,
    warmCallMs,
    vectorL2Norms: vectors.map((v) => l2Norm(v.vector)),
    firstFiveValues: Array.from(first.vector.slice(0, 5)),
  };
}

function formatReport(r: BackendReport): string {
  const lines = [
    `--- ${r.backend} ---`,
    `  declared dim:    ${String(r.declaredDim)}`,
    `  produced dim:    ${String(r.producedDim)}`,
    `  cold-start (1):  ${r.coldStartMs.toFixed(1)} ms`,
    `  warm batch (2):  ${r.warmCallMs.toFixed(1)} ms`,
    `  L2 norms:        [${r.vectorL2Norms.map((n) => n.toFixed(4)).join(", ")}]`,
    `  first 5 values:  [${r.firstFiveValues.map((v) => v.toFixed(6)).join(", ")}]`,
  ];
  return lines.join("\n");
}

function assertParity(reports: readonly BackendReport[]): string[] {
  const failures: string[] = [];
  for (const r of reports) {
    if (r.declaredDim !== EXPECTED_DIM) {
      failures.push(
        `${r.backend}: declared dim ${String(r.declaredDim)} != expected ${String(EXPECTED_DIM)}`,
      );
    }
    if (r.producedDim !== EXPECTED_DIM) {
      failures.push(
        `${r.backend}: produced dim ${String(r.producedDim)} != expected ${String(EXPECTED_DIM)}`,
      );
    }
    for (const norm of r.vectorL2Norms) {
      if (Math.abs(norm - 1.0) > NORM_TOLERANCE) {
        failures.push(
          `${r.backend}: L2 norm ${norm.toFixed(4)} outside [${(1 - NORM_TOLERANCE).toFixed(2)}, ${(1 + NORM_TOLERANCE).toFixed(2)}]`,
        );
      }
    }
  }
  return failures;
}

async function main(): Promise<void> {
  console.log("TransformersEmbedder smoke (HANDOFF.md §6.32)\n");

  const report = await exerciseTransformers();
  console.log(formatReport(report));
  console.log("");

  const failures = assertParity([report]);
  if (failures.length === 0) {
    console.log("PASS — dim 384 + L2-normalised vectors");
  } else {
    console.log("FAIL — invariants broken:");
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

void main().catch((err: unknown) => {
  console.error(
    "smoke failed:",
    err instanceof Error ? `${err.name}: ${err.message}` : err,
  );
  process.exitCode = 1;
});
