/**
 * ModuleRegistry diagnostics — PROMPT 13 / PROMPT 15.
 *
 * Extends the base Workspace Contract diagnostic vocabulary with registry-
 * specific codes. Every registry failure is surfaced as a `RegistryDiagnostic`
 * carrying a canonical `code`, a short USER-SAFE `message` (no stack), and
 * an optional `details` bucket that MAY contain technical payloads (AJV
 * errors, dependency chains, thrown Error objects) — but only for the
 * dedicated diagnostics surface, never for normal user copy.
 */

import type { ModuleDiagnostic, ModuleDiagnosticCode } from "@/workspace-contract";

export type RegistryDiagnosticCode =
  | ModuleDiagnosticCode
  | "unknown-module"
  | "duplicate-module-id"
  | "missing-dependency"
  | "inactive-dependency"
  | "dependency-cycle"
  | "dependency-unavailable"
  | "module-id-mismatch"
  | "loader-failed"
  | "contribution-invalid"
  | "definition-unverified"
  | "context-invalid"
  | "module-reported"
  | "active-dependents";

export interface RegistryDiagnostic {
  code: RegistryDiagnosticCode;
  moduleId?: string;
  /** Optional severity — defaults to "error" for registry failures. */
  severity?: "warning" | "error";
  /** Short user-safe message. NEVER contains a stack trace. */
  message: string;
  /** Technical detail payload — diagnostics surface only. */
  details?: unknown;
}

export function registryDiagnostic(
  code: RegistryDiagnosticCode,
  message: string,
  extra: { moduleId?: string; details?: unknown; severity?: "warning" | "error" } = {},
): RegistryDiagnostic {
  const out: RegistryDiagnostic = { code, message };
  if (extra.moduleId) out.moduleId = extra.moduleId;
  if (extra.details !== undefined) out.details = extra.details;
  if (extra.severity) out.severity = extra.severity;
  return out;
}

export function fromModuleDiagnostic(d: ModuleDiagnostic): RegistryDiagnostic {
  const out: RegistryDiagnostic = { code: d.code, message: d.message };
  if (d.moduleId) out.moduleId = d.moduleId;
  if (d.details !== undefined) out.details = d.details;
  return out;
}

export function toErrorDetails(err: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (err instanceof Error) {
    const out: { name: string; message: string; stack?: string } = {
      name: err.name,
      message: err.message,
    };
    if (typeof err.stack === "string") out.stack = err.stack;
    return out;
  }
  return { name: "NonError", message: String(err) };
}
