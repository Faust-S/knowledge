/**
 * Client-side errors for development and UI tests, not a legacy Runtime
 * compatibility layer. Real Kernel errors are returned by the current client.
 */
export class PackageCorruptedError extends Error {
  readonly code = "package_corrupted" as const;
  constructor(message = "package_corrupted", public readonly details?: unknown) {
    super(message);
    this.name = "PackageCorruptedError";
  }
}
export class PreviewTokenInvalidError extends Error {
  readonly code = "preview_token_invalid" as const;
  constructor(message = "preview_token_invalid", public readonly details?: unknown) {
    super(message);
    this.name = "PreviewTokenInvalidError";
  }
}
