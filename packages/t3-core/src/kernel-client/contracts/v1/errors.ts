/**
 * Auxiliary shell-side error classes.
 *
 * These are NOT part of the frozen Runtime Contract (Baseline 1.2). They
 * are typed sentinels the Workspace UI throws / catches to keep import
 * flows readable. Runtime errors thrown by a real kernel are typed via
 * `IWXAErrorShape` + the shared `ErrorCode` union (see
 * ../runtime-1.2.0/error-catalogue).
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
