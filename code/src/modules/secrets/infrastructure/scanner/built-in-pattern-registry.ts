import type { PatternRegistry } from "../../domain/services/pattern-registry.ts";
import type { DetectorName as DetectorNameVO } from "../../domain/value-objects/detector-name.ts";
import { DetectorName } from "../../domain/value-objects/detector-name.ts";
import { SecretKind } from "../../domain/value-objects/secret-kind.ts";
import { SecretPattern } from "../../domain/value-objects/secret-pattern.ts";

/**
 * Specification of a built-in detector. Kept private to the file
 * because adapters should not bypass the domain VO factories when
 * adding patterns.
 */
interface BuiltInPatternSpec {
  readonly name: string;
  readonly kind: () => SecretKind;
  readonly source: string;
}

/**
 * The built-in detector catalog mirrors the table documented in
 * `docs/11-seguridad-modos.md` §6 ("Capa 1 — Pre-write detection")
 * AND the additional patterns called out by the agent specification
 * (`docs/13-workflow-agentes.md` and the agent system prompt for the
 * crypto-security-expert).
 *
 * Each entry pairs a regex source with the canonical
 * `DetectorName` and `SecretKind`. The list is the SINGLE source of
 * truth for the project's defaults; user-supplied `extra_patterns`
 * from `.mcp-memoria/config.json` extend it (rather than replace
 * it). The composition root's adapter constructor is responsible for
 * concatenating the two lists.
 *
 * Pattern provenance:
 * - `regex.aws_access_key`     — `AKIA[0-9A-Z]{16}` (`docs/11 §6`).
 * - `regex.aws_secret_access_key` — `aws_secret_access_key=...`
 *                                 (`docs/11 §6`).
 * - `regex.jwt`                — `eyJ.eyJ.<sig>` (`docs/11 §6`).
 * - `regex.github_token`       — `ghp_/ghs_` (`docs/11 §6`).
 * - `regex.private_key`        — PEM header (`docs/11 §6`).
 * - `regex.password_in_url`    — `://user:pass@host` (`docs/11 §6`).
 * - `regex.generic_api_key`    — `*key*='...'` (`docs/11 §6`).
 *
 * Detector naming convention:
 * - `regex.<provider>_<artifact>` for provider-specific tokens.
 * - `regex.<artifact>` for generic patterns.
 * - Underscores (NOT dashes) inside the artifact name to keep the
 *   detector name a legal identifier under
 *   `DetectorName`'s `^[A-Za-z][A-Za-z0-9_.-]*$` pattern.
 */
const BUILT_IN_PATTERN_SPECS: readonly BuiltInPatternSpec[] = [
  // -- AWS ----------------------------------------------------------------
  {
    name: "regex.aws_access_key",
    kind: (): SecretKind => SecretKind.apiKey(),
    // Matches `AKIA` + 16 uppercase alphanumerics, the canonical AWS
    // access-key id format. The `\b` boundaries prevent matching
    // when the key is embedded in a longer alphanumeric token.
    source: "\\bAKIA[0-9A-Z]{16}\\b",
  },
  {
    name: "regex.aws_secret_access_key",
    kind: (): SecretKind => SecretKind.apiKey(),
    // Matches `aws_secret_access_key = <40-byte base64-ish blob>`
    // (case-insensitive on the variable name). The trailing class
    // accepts the `+`, `/` and `=` of base64.
    source: "aws_secret_access_key\\s*=\\s*[A-Za-z0-9/+=]{40}",
  },
  // -- OAuth / JWT --------------------------------------------------------
  {
    name: "regex.jwt",
    kind: (): SecretKind => SecretKind.oauthToken(),
    // Three base64url segments separated by dots: header, payload,
    // signature. The `eyJ` prefix is the base64url encoding of
    // `{"` which every JWT header carries.
    source:
      "eyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
  },
  {
    name: "regex.github_token",
    kind: (): SecretKind => SecretKind.oauthToken(),
    // GitHub Personal Access Tokens (`ghp_`) and Server-Side tokens
    // (`ghs_`) are 36+ alphanumeric characters after the prefix.
    source: "gh[ps]_[A-Za-z0-9]{36,}",
  },
  // -- Private keys -------------------------------------------------------
  {
    name: "regex.private_key",
    kind: (): SecretKind => SecretKind.privateKey(),
    // PEM private key header. Any `-----BEGIN ... PRIVATE KEY-----`
    // is a hard reject regardless of the algorithm. The escape on
    // `-` is unnecessary inside a character class but improves
    // readability.
    source: "-----BEGIN [A-Z ]+PRIVATE KEY-----",
  },
  // -- URL with embedded credentials -------------------------------------
  {
    name: "regex.password_in_url",
    kind: (): SecretKind => SecretKind.password(),
    // Matches `proto://user:password@host` patterns.
    source: "://[^/\\s]+:[^@/\\s]+@",
  },
  // -- Generic API keys ---------------------------------------------------
  {
    name: "regex.generic_api_key",
    kind: (): SecretKind => SecretKind.apiKey(),
    // Generic `*key* = "..."` assignments. The leading `[a-z_]*`
    // keeps the false-positive rate manageable (we only match
    // identifiers that look like configuration keys).
    source:
      "[a-z_]*key[a-z_]*\\s*[=:]\\s*['\"][A-Za-z0-9_-]{20,}",
  },
];

/**
 * Hot-path read-only registry whose `getPatterns()` returns the
 * built-in detector list (compiled once at construction).
 *
 * Why eager compilation:
 * - Compiling the regex set inside `getPatterns()` would re-allocate
 *   on every scan. The registry is hot-pathed (one call per
 *   `record_*` write), so eager compilation amortises the cost.
 *
 * Extension via user-supplied patterns:
 * - The constructor accepts an optional `extras` list of
 *   already-built `SecretPattern` instances. Composition root
 *   parses `config.json → secrets.extra_patterns` into VOs and
 *   passes them here. Built-ins always come first so user-supplied
 *   patterns cannot shadow the canonical detectors.
 */
export class BuiltInPatternRegistry implements PatternRegistry {
  private readonly patterns: readonly SecretPattern[];
  private readonly byName: Map<string, SecretPattern>;

  public constructor(extras: readonly SecretPattern[] = []) {
    const builtIns = BUILT_IN_PATTERN_SPECS.map(
      (spec): SecretPattern =>
        SecretPattern.create({
          name: DetectorName.from(spec.name),
          kind: spec.kind(),
          source: spec.source,
        }),
    );
    const all = [...builtIns, ...extras];
    this.patterns = Object.freeze(all);
    this.byName = new Map();
    for (const pattern of all) {
      this.byName.set(pattern.name.toString(), pattern);
    }
  }

  public getPatterns(): readonly SecretPattern[] {
    return this.patterns;
  }

  public getPattern(name: DetectorNameVO): SecretPattern | null {
    return this.byName.get(name.toString()) ?? null;
  }
}
