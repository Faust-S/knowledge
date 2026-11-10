/**
 * Workspace Contract — module diagnostic codes.
 *
 * Every failure produced by the Workspace Contract MUST be represented as
 * a `ModuleDiagnostic` with a canonical code from this file. Codes are
 * shared by the manifest validator, the compatibility checker, the
 * security policy checker and (in the future) the ModuleRegistry.
 *
 * Presentation rules:
 *   - The `message` field is a short user-safe string.
 *   - The `details` field is optional and MUST only be rendered in a
 *     dedicated diagnostics surface — never in normal user copy.
 *   - Stack traces are NEVER included in `message`. If a stack is needed
 *     for debugging, it belongs in `details` (still not user copy).
 */

export type ModuleDiagnosticCode =
  | "manifest-invalid"
  | "workspace-contract-incompatible"
  | "runtime-contract-incompatible"
  | "missing-runtime-level"
  | "missing-operation"
  | "missing-capability"
  | "unsafe-storage-access"
  | "remote-code-forbidden"
  | "executable-package-code-forbidden"
  | "duplicate-contribution-id"
  | "activation-error"
  | "deactivation-error";

export interface ModuleDiagnostic {
  code: ModuleDiagnosticCode;
  /** Optional module id — absent when the manifest itself failed to parse. */
  moduleId?: string;
  /** Short user-safe message. Never contains a stack trace. */
  message: string;
  /** Technical detail payload — diagnostics surface only. */
  details?: unknown;
}

export function moduleDiagnostic(
  code: ModuleDiagnosticCode,
  message: string,
  extra: { moduleId?: string; details?: unknown } = {},
): ModuleDiagnostic {
  const out: ModuleDiagnostic = { code, message };
  if (extra.moduleId) out.moduleId = extra.moduleId;
  if (extra.details !== undefined) out.details = extra.details;
  return out;
}

/**
 * Contract error raised only for programmer mistakes at compile time
 * (e.g. `defineWorkspaceModule` called with the wrong shape). Runtime
 * failures MUST be reported via `ModuleDiagnostic`, not thrown.
 */
export class WorkspaceContractError extends Error {
  constructor(
    public readonly code: ModuleDiagnosticCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "WorkspaceContractError";
  }
}
