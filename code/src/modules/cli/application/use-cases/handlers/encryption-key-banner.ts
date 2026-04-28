/**
 * Renders the human-grouped encryption key banner shown ONCE on
 * stdout per `docs/11-seguridad-modos.md` §3 ("Que ocurre al
 * inicializar"). The wide ASCII box matches the spec verbatim
 * (column-aligned). The banner is multi-line text; the caller writes
 * it through the `Stdout` port.
 *
 * Why the rendering lives here (CLI application layer) rather than
 * in an infrastructure formatter:
 *   - The banner is a contract with the user — its exact wording is
 *     part of `docs/11`. Putting it in a use-case helper makes it
 *     easy to assert against the documented copy in tests.
 *   - It contains no business logic; it is a pure formatter so
 *     making it a class would be ceremony.
 */
export function renderEncryptionKeyBanner(printableKey: string): string {
  const lines = [
    "╔══════════════════════════════════════════════════════════════╗",
    "║ Clave de cifrado para este workspace                         ║",
    "║                                                              ║",
    `║   ${padBoxLine(printableKey, 58)}║`,
    "║                                                              ║",
    "║ COPIA Y GUARDA esta clave en lugar seguro (1Password, etc.)  ║",
    "║ Compartela con tu equipo por canal seguro.                   ║",
    "║ Si la pierdes, la memoria es irrecuperable.                  ║",
    "║                                                              ║",
    "║ Esta clave NO se vuelve a mostrar.                           ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
  ];
  return lines.join("\n");
}

function padBoxLine(token: string, width: number): string {
  if (token.length >= width) return token.slice(0, width);
  return `${token}${" ".repeat(width - token.length)} `;
}
