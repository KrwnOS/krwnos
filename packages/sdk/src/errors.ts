/**
 * Standard error class for first-party and third-party KrwnOS modules.
 *
 * Modules should throw \`KrwnError\` with a stable \`code\` that route
 * handlers (or other callers) can branch on to decide HTTP status
 * mapping. The \`code\` is the contract — the human-readable \`message\`
 * can be freely reworded without breaking callers.
 */
export class KrwnError extends Error {
  constructor(
    public override readonly message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "KrwnError";
  }
}
