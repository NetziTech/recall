/**
 * Re-export of `registerMvpTools` (Fase 4 brief item
 * B.tool-registry-bootstrap). The concrete registration logic lives
 * in `composition/tools/tool-registry-bootstrap.ts` so the
 * "composition is the only multi-module site" rule stays intact.
 */

export { registerMvpTools } from "../composition/tools/tool-registry-bootstrap.ts";
