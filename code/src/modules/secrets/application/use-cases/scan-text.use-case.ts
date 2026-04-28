import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type { WorkspaceId } from "../../../../shared/domain/value-objects/workspace-id.ts";
import type { SecretsScanner } from "../../domain/services/secrets-scanner.ts";
import type { SanitizedText } from "../../domain/value-objects/sanitized-text.ts";
import type { ScanText } from "../ports/in/scan-text.port.ts";

/**
 * Use case: scan a text payload for secrets.
 *
 * Today the use case is a thin pass-through over the `SecretsScanner`
 * driven port plus a logging hook. The split exists so the
 * application layer can grow concerns later (per-workspace pattern
 * overrides loaded from `.recall/config.json`, telemetry of
 * scan latencies, in-process result caching) without rippling
 * through the input-port consumers.
 *
 * Why a class (not a free function):
 * - The composition root injects the `SecretsScanner` adapter and
 *   the `Logger` exactly once at server start-up. A function would
 *   force every caller to plumb both arguments.
 *
 * Security:
 * - The use case logs only the *event* (count of findings, kinds)
 *   at debug level. NEVER logs the original text, the sanitised
 *   text, or any byte that could echo back the secret. The
 *   `SecretFinding.position.evidence` field is already redacted by
 *   the domain VO; the use case still avoids logging it as defence
 *   in depth.
 */
export class ScanTextUseCase implements ScanText {
  public constructor(
    private readonly scanner: SecretsScanner,
    private readonly logger: Logger,
  ) {}

  public async scan(input: {
    text: string;
    workspaceId: WorkspaceId;
  }): Promise<SanitizedText> {
    const result = await this.scanner.scan(input.text, input.workspaceId);
    if (result.hasFindings()) {
      this.logger.warn(
        {
          workspaceId: input.workspaceId.toString(),
          findingCount: result.findingCount(),
        },
        "secrets scan produced findings",
      );
    } else {
      this.logger.debug(
        {
          workspaceId: input.workspaceId.toString(),
          textLength: input.text.length,
        },
        "secrets scan clean",
      );
    }
    return result;
  }
}
