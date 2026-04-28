/**
 * JSON-RPC error codes used by the MCP server.
 *
 * These constants live in the domain because the *meaning* of each code
 * (workspace not found, encryption locked, secret detected, etc.) is a
 * domain concept. The transport layer (mcp-server infrastructure) uses
 * them when serializing errors, but the domain owns the catalog so that
 * domain errors can advertise their canonical code.
 *
 * Standard JSON-RPC reserves -32000..-32099. The Recall custom
 * range is -32100..-32109 as documented in `docs/02-protocolo-mcp.md` §6.
 *
 * Invariants:
 * - All codes are negative integers.
 * - Codes in -32100..-32109 are project-specific; lower codes are
 *   reserved for JSON-RPC standard errors.
 * - The constant identifiers reflect the business meaning, not the
 *   numeric value.
 */
export const JsonRpcErrorCodes = {
  /** Workspace not found. Client should call `mem.init` first. */
  WORKSPACE_NOT_FOUND: -32100,

  /** Session expired (idle timeout). The MCP auto-starts a new one. */
  SESSION_EXPIRED: -32101,

  /** Embedding service unavailable. Caller may accept FTS5 fallback. */
  EMBEDDING_SERVICE_UNAVAILABLE: -32102,

  /** Disk full. Caller must surface this to the user. */
  DISK_FULL: -32103,

  /** Schema version incompatible (migration failed). */
  SCHEMA_VERSION_INCOMPATIBLE: -32104,

  /** Secret detected in input. Caller must sanitize and retry. */
  SECRET_DETECTED: -32105,

  /** Rate limited (curator currently running). */
  RATE_LIMITED: -32106,

  /** Encrypted workspace is locked; no key available. */
  ENCRYPTED_LOCKED: -32107,

  /** Invalid encryption key. */
  INVALID_KEY: -32108,

  /** Encryption key revoked by rekey. */
  KEY_REVOKED: -32109,
} as const;

/**
 * Numeric union of every defined JSON-RPC error code.
 */
export type JsonRpcErrorCode =
  (typeof JsonRpcErrorCodes)[keyof typeof JsonRpcErrorCodes];
