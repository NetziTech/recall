import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { z } from "zod";

import type { Clock } from "../../../../shared/application/ports/clock.port.ts";
import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import { Timestamp } from "../../../../shared/domain/value-objects/timestamp.ts";
import { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import { EncryptionConfig } from "../../domain/aggregates/encryption-config.ts";
import type { EncryptionConfigRepository } from "../../domain/repositories/encryption-config-repository.ts";
import { KdfAlgorithm } from "../../domain/value-objects/kdf-algorithm.ts";
import { KdfParams } from "../../domain/value-objects/kdf-params.ts";
import { KdfSpec } from "../../domain/value-objects/kdf-spec.ts";
import { EncryptedMasterKey } from "../../domain/value-objects/encrypted-master-key.ts";
import { KeyEnvelope } from "../../domain/value-objects/key-envelope.ts";
import { KeyId } from "../../domain/value-objects/key-id.ts";
import { KeyLabel } from "../../domain/value-objects/key-label.ts";
import { KeyValidatorBlob } from "../../domain/value-objects/key-validator-blob.ts";
import { SaltBytes } from "../../domain/value-objects/salt-bytes.ts";
import { EncryptionConfigPersistenceError } from "../errors/encryption-config-persistence-error.ts";

/**
 * Subdirectory inside a host project that contains the workspace
 * payload. Constant per `docs/03-modelo-datos.md` §1.
 *
 * Duplicated verbatim from
 * `modules/workspace/infrastructure/filesystem/node-workspace-filesystem.ts`
 * on purpose: the workspace and encryption modules MUST NOT
 * cross-import (`docs/12 §1.5`). The literal is a stable wire
 * convention; sharing it via `shared/` would be over-abstraction
 * (one path constant pulled into a transversal module just to avoid
 * a copy is the kind of accidental coupling §1.5 explicitly
 * rejects).
 */
const WORKSPACE_DIRECTORY_NAME = ".mcp-memoria";
const CONFIG_FILE_NAME = "config.json";

/** Permission bits documented in `docs/11-seguridad-modos.md` §7. */
const CONFIG_FILE_MODE = 0o600;

/**
 * Sentinel ASCII text encrypted under the master key and stored as
 * the workspace's `key_validator_blob_b64`. Mirrors
 * `VALIDATOR_SENTINEL_TEXT` in `InitializeEncryptionUseCase`. The
 * adapter MUST NOT recompute the plaintext from anything other than
 * the canonical literal: doing so would let a malformed `config.json`
 * silently downgrade the validator strength.
 */
const VALIDATOR_SENTINEL_TEXT = "VALID-WORKSPACE-V1";

/**
 * Zod schema enforcing the on-disk shape of the encryption slice.
 *
 * The fields mirror `docs/03-modelo-datos.md` §2 ("Campos especificos
 * del modo encrypted"):
 *
 * ```json
 * {
 *   "kdf": "argon2id",
 *   "kdf_params": {
 *     "memory_kib": 65536,
 *     "iterations": 3,
 *     "parallelism": 4,
 *     "salt_b64": "..."
 *   },
 *   "key_validator_blob_b64": {
 *     "iv_b64": "...",
 *     "ciphertext_b64": "...",
 *     "tag_b64": "..."
 *   },
 *   "key_envelopes": [
 *     {
 *       "id": "envelope-1",
 *       "created_at_ms": 1745000000000,
 *       "label": null | "alice@laptop",
 *       "kdf_params": { ... per-envelope KDF params ... },
 *       "envelope": { "iv_b64": "...", "ciphertext_b64": "...", "tag_b64": "..." }
 *     }
 *   ],
 *   "workspace_id": "<uuid v7>",
 *   "created_at_ms": 1745000000000,
 *   "updated_at_ms": 1745000000000
 * }
 * ```
 *
 * The shape extends the doc spec slightly to make the encryption
 * slice round-trip cleanly:
 *
 * - `key_validator_blob_b64` is a sub-object instead of a single
 *   base64 string. The aggregate's `KeyValidatorBlob` carries an
 *   IV, a ciphertext and a tag; concatenating them into one base64
 *   would force the adapter to re-derive lengths from the AEAD
 *   primitive. A sub-object is unambiguous and matches the wire
 *   shape used by `key_envelopes[].envelope`.
 * - `workspace_id`, `created_at_ms`, `updated_at_ms` are persisted
 *   inside the encryption slice so the repo can rehydrate the
 *   aggregate without depending on the workspace's own slice. The
 *   workspace module persists its own `workspace_id` separately;
 *   the adapter validates the two values match on read (defence in
 *   depth against drift between the slices).
 */
const ENVELOPE_AEAD_SCHEMA = z.object({
  iv_b64: z.string().min(1),
  ciphertext_b64: z.string().min(1),
  tag_b64: z.string().min(1),
});

const KDF_PARAMS_SCHEMA = z.object({
  memory_kib: z.number().int().positive(),
  iterations: z.number().int().positive(),
  parallelism: z.number().int().positive(),
  salt_b64: z.string().min(1),
});

const KEY_ENVELOPE_SCHEMA = z.object({
  id: z.string().min(1),
  created_at_ms: z.number().int().nonnegative(),
  label: z.union([z.string().min(1), z.null()]),
  kdf_params: KDF_PARAMS_SCHEMA,
  envelope: ENVELOPE_AEAD_SCHEMA,
});

const ENCRYPTION_SLICE_SCHEMA = z.object({
  kdf: z.string().min(1),
  kdf_params: KDF_PARAMS_SCHEMA,
  key_validator_blob_b64: ENVELOPE_AEAD_SCHEMA,
  key_envelopes: z.array(KEY_ENVELOPE_SCHEMA).min(1),
  workspace_id: z.string().min(1),
  created_at_ms: z.number().int().nonnegative(),
  updated_at_ms: z.number().int().nonnegative(),
});

/**
 * Top-level shape of `config.json` as far as this adapter cares. The
 * `looseObject` wrapper preserves every other slice (workspace,
 * embedder, secrets, retrieval, curator) verbatim on round-trip — the
 * adapter MUST NOT mutate them. Only the four encryption fields
 * declared above are owned by this adapter.
 */
const FULL_CONFIG_SCHEMA = z.looseObject({
  kdf: z.string().optional(),
  kdf_params: KDF_PARAMS_SCHEMA.optional(),
  key_validator_blob_b64: ENVELOPE_AEAD_SCHEMA.optional(),
  key_envelopes: z.array(KEY_ENVELOPE_SCHEMA).optional(),
  encryption_workspace_id: z.string().optional(),
  encryption_created_at_ms: z.number().int().nonnegative().optional(),
  encryption_updated_at_ms: z.number().int().nonnegative().optional(),
});

type RawConfig = Record<string, unknown>;

/**
 * Filesystem-backed adapter for `EncryptionConfigRepository`.
 *
 * Reads and writes the encryption slice of
 * `<workspaceRoot>/.mcp-memoria/config.json` directly, using
 * `node:fs/promises`. The adapter MUST NOT cross-import the
 * workspace module's `WorkspaceFilesystem` port: the encryption
 * module is independent and the only legitimate sharing channel is
 * `shared/` (`docs/12 §1.5`). Both modules end up writing to the
 * same `config.json` file, but they own disjoint top-level slices
 * and the adapter merges them safely:
 *
 * - On read, the adapter parses the whole file with a `looseObject`
 *   schema and projects only the encryption keys.
 * - On write, the adapter reads the existing JSON (if any), merges
 *   the encryption keys on top, and writes the result atomically.
 *   Untouched slices round-trip verbatim.
 *
 * Concurrency:
 * - The adapter does NOT take any process-level lock. The workspace
 *   adapter's `writeConfig` documents the same limitation and the
 *   product (single-user CLI / interactive MCP server) does not
 *   exercise the contention vector. Documented as a known
 *   limitation; flock would be a Fase 5 hardening if needed.
 *
 * Path safety:
 * - The constructor receives an absolute, canonicalised
 *   `workspaceRoot`. The adapter further canonicalises the result
 *   via `path.resolve` before any I/O and rejects suffix paths that
 *   resolve outside the declared root (defensive guard against
 *   composition-root bugs).
 *
 * Atomicity:
 * - `save` and `delete` write to a temporary sibling file in the
 *   same directory and rename atomically. Same-filesystem renames
 *   are atomic on POSIX (`rename(2)`) and on Windows (`MoveFileEx`).
 * - The temporary suffix is randomised via `process.pid + Date.now()`
 *   to avoid collisions when two CLIs initialise concurrently.
 *
 * Permissions:
 * - The config file is written with mode `0o600` (owner-only
 *   read/write). The adapter applies `chmod` after the write to
 *   guarantee the bits even when the umask is permissive.
 */
export class JsonEncryptionConfigRepository
  implements EncryptionConfigRepository
{
  private readonly workspaceRoot: string;
  private readonly clock: Clock;
  private readonly logger: Logger;

  /**
   * @param workspaceRoot Absolute path of the host project. The
   *   adapter writes / reads `<workspaceRoot>/.mcp-memoria/config.json`.
   *   Caller (composition root) MUST canonicalise the path before
   *   construction (the adapter still resolves defensively).
   * @param clock Used to set `updated_at_ms` when persisting after a
   *   `delete` keeps consistency between adapter operations.
   * @param logger Used for non-secret operational messages
   *   (workspace id, kind of operation). NEVER receives passphrase
   *   characters or key material.
   */
  public constructor(input: {
    workspaceRoot: string;
    clock: Clock;
    logger: Logger;
  }) {
    JsonEncryptionConfigRepository.assertSafePath(input.workspaceRoot);
    this.workspaceRoot = path.resolve(input.workspaceRoot);
    this.clock = input.clock;
    this.logger = input.logger;
  }

  public async findByWorkspace(
    workspaceId: WorkspaceId,
  ): Promise<EncryptionConfig | null> {
    const configPath = this.configFilePath();
    const raw = await this.readJsonOrNull(configPath);
    if (raw === null) return null;

    const result = FULL_CONFIG_SCHEMA.safeParse(raw);
    if (!result.success) {
      throw EncryptionConfigPersistenceError.malformed(
        this.workspaceRoot,
        result.error.message,
      );
    }
    const data = result.data;

    // Detect "no encryption slice" by checking the four mandatory
    // fields. If any one is missing, treat the whole slice as
    // absent. This matches the workspace's `mode === "shared" |
    // "private"` paths.
    if (
      data.kdf === undefined ||
      data.kdf_params === undefined ||
      data.key_validator_blob_b64 === undefined ||
      data.key_envelopes === undefined ||
      data.encryption_workspace_id === undefined ||
      data.encryption_created_at_ms === undefined ||
      data.encryption_updated_at_ms === undefined
    ) {
      return null;
    }

    // Validate the slice shape with the strict schema.
    const sliceParse = ENCRYPTION_SLICE_SCHEMA.safeParse({
      kdf: data.kdf,
      kdf_params: data.kdf_params,
      key_validator_blob_b64: data.key_validator_blob_b64,
      key_envelopes: data.key_envelopes,
      workspace_id: data.encryption_workspace_id,
      created_at_ms: data.encryption_created_at_ms,
      updated_at_ms: data.encryption_updated_at_ms,
    });
    if (!sliceParse.success) {
      throw EncryptionConfigPersistenceError.malformed(
        this.workspaceRoot,
        sliceParse.error.message,
      );
    }

    const slice = sliceParse.data;

    // Cross-check the embedded workspace id against the requested
    // one. Protects against the (operational) bug of a misconfigured
    // composition root that points the encryption adapter at the
    // wrong workspace directory.
    if (slice.workspace_id !== workspaceId.toString()) {
      throw EncryptionConfigPersistenceError.malformed(
        this.workspaceRoot,
        `encryption slice workspace id "${slice.workspace_id}" does not match requested workspace "${workspaceId.toString()}"`,
      );
    }

    return JsonEncryptionConfigRepository.toAggregate(slice, this.workspaceRoot);
  }

  public async save(config: EncryptionConfig): Promise<void> {
    const configPath = this.configFilePath();
    const sliceJson = JsonEncryptionConfigRepository.fromAggregate(config);

    const existing = await this.readJsonOrNull(configPath);
    const base: RawConfig =
      existing !== null && typeof existing === "object" && !Array.isArray(existing)
        ? (existing as RawConfig)
        : {};

    const merged: RawConfig = { ...base, ...sliceJson };

    await this.writeAtomic(configPath, merged);

    this.logger.info(
      {
        workspaceId: config.getWorkspaceId().toString(),
        operation: "save-encryption-config",
        envelopeCount: config.envelopeCount(),
      },
      "encryption config persisted",
    );
  }

  public async delete(workspaceId: WorkspaceId): Promise<void> {
    const configPath = this.configFilePath();
    const existing = await this.readJsonOrNull(configPath);
    if (existing === null || typeof existing !== "object") {
      // No file or unrelated content: nothing to delete. Idempotent
      // by contract.
      this.logger.info(
        {
          workspaceId: workspaceId.toString(),
          operation: "delete-encryption-config",
          outcome: "no-config-file",
        },
        "encryption config delete: no config.json present",
      );
      return;
    }

    // Build a fresh object that copies every key EXCEPT the
    // encryption-owned ones. Avoids the `delete` operator (the
    // codebase forbids dynamic property deletion via lint rule
    // `@typescript-eslint/no-dynamic-delete`).
    const ENCRYPTION_OWNED_KEYS = new Set<string>([
      "kdf",
      "kdf_params",
      "key_validator_blob_b64",
      "key_envelopes",
      "encryption_workspace_id",
      "encryption_created_at_ms",
      "encryption_updated_at_ms",
    ]);
    const existingRecord = existing as RawConfig;
    const without: RawConfig = {};
    let removedAnything = false;
    for (const [key, value] of Object.entries(existingRecord)) {
      if (ENCRYPTION_OWNED_KEYS.has(key)) {
        removedAnything = true;
        continue;
      }
      without[key] = value;
    }

    if (!removedAnything) {
      this.logger.info(
        {
          workspaceId: workspaceId.toString(),
          operation: "delete-encryption-config",
          outcome: "no-encryption-slice",
        },
        "encryption config delete: no encryption slice present",
      );
      return;
    }

    await this.writeAtomic(configPath, without);

    this.logger.info(
      {
        workspaceId: workspaceId.toString(),
        operation: "delete-encryption-config",
        outcome: "removed",
        // Bump a non-secret marker so subscribers can correlate.
        atMs: this.clock.now().toEpochMs(),
      },
      "encryption config destroyed",
    );
  }

  // ── helpers ───────────────────────────────────────────────────────

  private configFilePath(): string {
    const candidate = path.resolve(
      this.workspaceRoot,
      WORKSPACE_DIRECTORY_NAME,
      CONFIG_FILE_NAME,
    );
    // Defensive: ensure the resolved path stays under the declared
    // root. `path.resolve` ate any traversal in the inputs, but the
    // composition root may pass a workspace name that itself
    // contains traversal segments (it should not, but we guard).
    const expectedPrefix = path.resolve(
      this.workspaceRoot,
      WORKSPACE_DIRECTORY_NAME,
    );
    if (!candidate.startsWith(`${expectedPrefix}${path.sep}`)) {
      throw EncryptionConfigPersistenceError.pathTraversal(this.workspaceRoot);
    }
    return candidate;
  }

  private async readJsonOrNull(configPath: string): Promise<unknown> {
    let raw: string;
    try {
      raw = await fs.readFile(configPath, "utf8");
    } catch (err: unknown) {
      if (JsonEncryptionConfigRepository.isEnoent(err)) return null;
      throw EncryptionConfigPersistenceError.readFailed(
        this.workspaceRoot,
        err,
      );
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch (err: unknown) {
      throw EncryptionConfigPersistenceError.malformed(
        this.workspaceRoot,
        `JSON parse failure: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async writeAtomic(
    configPath: string,
    payload: RawConfig,
  ): Promise<void> {
    const dir = path.dirname(configPath);
    const tempPath = path.join(
      dir,
      `.${CONFIG_FILE_NAME}.enc-tmp-${String(process.pid)}-${String(Date.now())}`,
    );

    // Ensure the workspace directory exists. The workspace adapter
    // creates it on `init`, but the encryption adapter may run
    // first in unusual flows (test harness, manual recovery).
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    } catch (err: unknown) {
      throw EncryptionConfigPersistenceError.writeFailed(
        this.workspaceRoot,
        err,
      );
    }

    const json = `${JSON.stringify(payload, null, 2)}\n`;
    try {
      await fs.writeFile(tempPath, json, {
        encoding: "utf8",
        mode: CONFIG_FILE_MODE,
      });
      await fs.chmod(tempPath, CONFIG_FILE_MODE);
      await fs.rename(tempPath, configPath);
    } catch (err: unknown) {
      // Best-effort cleanup of the temp file.
      await fs.unlink(tempPath).catch(() => undefined);
      throw EncryptionConfigPersistenceError.writeFailed(
        this.workspaceRoot,
        err,
      );
    }
  }

  private static isEnoent(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false;
    const candidate = err as { readonly code?: unknown };
    return candidate.code === "ENOENT";
  }

  private static assertSafePath(workspaceRoot: string): void {
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
      throw EncryptionConfigPersistenceError.pathTraversal("");
    }
    if (workspaceRoot.includes("\0")) {
      throw EncryptionConfigPersistenceError.pathTraversal(workspaceRoot);
    }
    if (!path.isAbsolute(workspaceRoot)) {
      throw EncryptionConfigPersistenceError.pathTraversal(workspaceRoot);
    }
    // `path.resolve` removes `..` segments, so checking after the
    // resolve is too late. We forbid `..` segments in the input
    // string explicitly: a legitimate workspace root never contains
    // them.
    const normalised = path.normalize(workspaceRoot);
    const segments = normalised.split(path.sep);
    for (const segment of segments) {
      if (segment === "..") {
        throw EncryptionConfigPersistenceError.pathTraversal(workspaceRoot);
      }
    }
  }

  private static toAggregate(
    slice: z.infer<typeof ENCRYPTION_SLICE_SCHEMA>,
    workspaceRoot: string,
  ): EncryptionConfig {
    const algorithm = JsonEncryptionConfigRepository.parseAlgorithm(
      slice.kdf,
      workspaceRoot,
    );
    const kdfParams = JsonEncryptionConfigRepository.parseKdfParams(
      slice.kdf_params,
      algorithm,
      workspaceRoot,
    );
    const kdfSpec = KdfSpec.create({ algorithm, params: kdfParams });

    const validatorBlob = JsonEncryptionConfigRepository.parseValidatorBlob(
      slice.key_validator_blob_b64,
      workspaceRoot,
    );

    const envelopes: KeyEnvelope[] = [];
    for (const raw of slice.key_envelopes) {
      envelopes.push(
        JsonEncryptionConfigRepository.parseEnvelope(raw, workspaceRoot),
      );
    }

    const workspaceId = WorkspaceId.from(slice.workspace_id);

    return EncryptionConfig.rehydrate({
      workspaceId,
      kdfSpec,
      keyValidatorBlob: validatorBlob,
      envelopes,
      createdAt: Timestamp.fromEpochMs(slice.created_at_ms),
      updatedAt: Timestamp.fromEpochMs(slice.updated_at_ms),
    });
  }

  private static fromAggregate(config: EncryptionConfig): RawConfig {
    const kdfSpec = config.getKdfSpec();
    const validatorBlob = config.getKeyValidatorBlob();

    const envelopes = config.getEnvelopes().map((envelope) => ({
      id: envelope.keyId.toString(),
      created_at_ms: envelope.createdAt.toEpochMs(),
      label: envelope.label === null ? null : envelope.label.asString(),
      kdf_params: JsonEncryptionConfigRepository.kdfParamsToJson(
        envelope.kdfParams,
      ),
      envelope: {
        iv_b64: envelope.encryptedMasterKey.withIv((b) => toBase64(b)),
        ciphertext_b64: envelope.encryptedMasterKey.withCiphertext((b) =>
          toBase64(b),
        ),
        tag_b64: envelope.encryptedMasterKey.withTag((b) => toBase64(b)),
      },
    }));

    return {
      kdf: kdfSpec.algorithm.toString(),
      kdf_params: JsonEncryptionConfigRepository.kdfParamsToJson(kdfSpec.params),
      key_validator_blob_b64: {
        iv_b64: validatorBlob.withIv((b) => toBase64(b)),
        ciphertext_b64: validatorBlob.withCiphertext((b) => toBase64(b)),
        tag_b64: validatorBlob.withTag((b) => toBase64(b)),
      },
      key_envelopes: envelopes,
      encryption_workspace_id: config.getWorkspaceId().toString(),
      encryption_created_at_ms: config.getCreatedAt().toEpochMs(),
      encryption_updated_at_ms: config.getUpdatedAt().toEpochMs(),
    };
  }

  private static kdfParamsToJson(
    params: KdfParams,
  ): z.infer<typeof KDF_PARAMS_SCHEMA> {
    return {
      memory_kib: params.memoryKib,
      iterations: params.iterations,
      parallelism: params.parallelism,
      salt_b64: params.salt.withBytes((b) => toBase64(b)),
    };
  }

  private static parseAlgorithm(
    raw: string,
    workspaceRoot: string,
  ): KdfAlgorithm {
    try {
      return KdfAlgorithm.create(raw);
    } catch (err: unknown) {
      throw EncryptionConfigPersistenceError.malformed(
        workspaceRoot,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private static parseKdfParams(
    raw: z.infer<typeof KDF_PARAMS_SCHEMA>,
    algorithm: KdfAlgorithm,
    workspaceRoot: string,
  ): KdfParams {
    try {
      const saltBytes = fromBase64(raw.salt_b64, "kdf_params.salt_b64");
      const salt = SaltBytes.from(saltBytes);
      return KdfParams.create({
        algorithm,
        memoryKib: raw.memory_kib,
        iterations: raw.iterations,
        parallelism: raw.parallelism,
        salt,
      });
    } catch (err: unknown) {
      throw EncryptionConfigPersistenceError.malformed(
        workspaceRoot,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private static parseValidatorBlob(
    raw: z.infer<typeof ENVELOPE_AEAD_SCHEMA>,
    workspaceRoot: string,
  ): KeyValidatorBlob {
    try {
      const expectedPlaintext = new TextEncoder().encode(VALIDATOR_SENTINEL_TEXT);
      const ciphertext = fromBase64(
        raw.ciphertext_b64,
        "key_validator_blob_b64.ciphertext_b64",
      );
      const iv = fromBase64(raw.iv_b64, "key_validator_blob_b64.iv_b64");
      const tag = fromBase64(raw.tag_b64, "key_validator_blob_b64.tag_b64");
      return KeyValidatorBlob.create({
        expectedPlaintext,
        ciphertext,
        iv,
        tag,
      });
    } catch (err: unknown) {
      throw EncryptionConfigPersistenceError.malformed(
        workspaceRoot,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private static parseEnvelope(
    raw: z.infer<typeof KEY_ENVELOPE_SCHEMA>,
    workspaceRoot: string,
  ): KeyEnvelope {
    try {
      // Per-envelope KDF params currently always use argon2id (the
      // sole algorithm allowed by the KdfAlgorithm VO). When the
      // domain catalogue grows, the on-disk envelope will need to
      // carry the algorithm name explicitly.
      const algorithm = KdfAlgorithm.argon2id();
      const kdfParams = JsonEncryptionConfigRepository.parseKdfParams(
        raw.kdf_params,
        algorithm,
        workspaceRoot,
      );
      const ciphertext = fromBase64(
        raw.envelope.ciphertext_b64,
        `key_envelopes[${raw.id}].envelope.ciphertext_b64`,
      );
      const iv = fromBase64(
        raw.envelope.iv_b64,
        `key_envelopes[${raw.id}].envelope.iv_b64`,
      );
      const tag = fromBase64(
        raw.envelope.tag_b64,
        `key_envelopes[${raw.id}].envelope.tag_b64`,
      );
      const encryptedMasterKey = EncryptedMasterKey.create({
        ciphertext,
        iv,
        tag,
      });
      const label = raw.label === null ? null : KeyLabel.create(raw.label);
      return KeyEnvelope.create({
        keyId: KeyId.from(raw.id),
        encryptedMasterKey,
        kdfParams,
        createdAt: Timestamp.fromEpochMs(raw.created_at_ms),
        label,
      });
    } catch (err: unknown) {
      throw EncryptionConfigPersistenceError.malformed(
        workspaceRoot,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/**
 * Decodes a base64 string into a fresh `Uint8Array`. Throws
 * `EncryptionConfigPersistenceError.malformed` (via the caller) if
 * the input is not valid base64. Uses `Buffer.from` because Node 20+
 * still does not expose a stable `atob`-equivalent for binary data
 * outside browsers.
 */
function fromBase64(input: string, field: string): Uint8Array {
  // Reject obviously malformed inputs (whitespace, characters
  // outside the base64 alphabet) before delegating to Node.
  // `Buffer.from(_, "base64")` silently truncates invalid
  // characters; we tighten that behaviour here. Standard alphabet
  // only — the writer always uses canonical (padded, standard)
  // base64 (`toBase64` enforces it).
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error(`${field} is empty`);
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new Error(
      `${field} is not valid base64: contains characters outside the standard alphabet`,
    );
  }
  // Padding must be canonical: total length is a multiple of 4 once
  // padded.
  if (trimmed.length % 4 !== 0) {
    throw new Error(`${field} is not valid base64: incorrect padding length`);
  }
  const buffer = Buffer.from(trimmed, "base64");
  // Round-trip detect: re-encoding the decoded buffer MUST match the
  // canonical input verbatim. Any silent truncation (Node would have
  // done it) shows up here.
  const reencoded = buffer.toString("base64");
  if (reencoded !== trimmed) {
    throw new Error(`${field} is not valid base64: silent truncation detected`);
  }
  return new Uint8Array(buffer);
}

/**
 * Encodes a `Uint8Array` into a base64 string using the canonical
 * (padded, standard alphabet) form. Mirrors `fromBase64`.
 */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64",
  );
}
