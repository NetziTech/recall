import type { Logger } from "../../../../shared/application/ports/logger.port.ts";
import type {
  RememberInputWire,
  RememberOutputWire,
} from "../dtos/wire-types.dto.ts";
import type { Remember } from "../ports/in/remember.port.ts";
import type { RememberFacade } from "../ports/out/remember-facade.port.ts";

/**
 * Use case implementing the `mem.remember` driving port.
 *
 * Forwards the validated wire DTO to the `RememberFacade` output
 * port. The facade is responsible for kind-dispatch, secrets
 * detection, persistence, similarity scan and embedding queueing
 * (`docs/02-protocolo-mcp.md` §4.4).
 *
 * Logging includes `kind` so operators can correlate write volumes
 * by memory type without parsing payload bodies.
 */
export class RememberUseCase implements Remember {
  public constructor(
    private readonly facade: RememberFacade,
    private readonly logger: Logger,
  ) {}

  public async remember(input: RememberInputWire): Promise<RememberOutputWire> {
    this.logger.debug(
      { tool: "mem.remember", kind: input.kind },
      "tool invocation started",
    );
    const output = await this.facade.remember(input);
    this.logger.info(
      {
        tool: "mem.remember",
        kind: output.kind,
        id: output.id,
        upserted: output.upserted,
        embeddingStatus: output.embedding_status,
        similarCount: output.similar_existing?.length ?? 0,
      },
      "tool invocation completed",
    );
    return output;
  }
}
