/**
 * Configured module declarations (PROMPT 18 §9).
 *
 * Pure translator from a validated `workspace.config.json` `modules[]`
 * array into `ModuleDeclaration`s + composition diagnostics. Never
 * resolves loaders, never fetches, never touches a URL or a filesystem
 * path. The input has already been AJV-validated by
 * `src/config/host-config/load-host-config.ts`.
 */

import type { OperationId } from "@/kernel-client";
import type { Level } from "@/kernel-client/contracts/runtime-1.3.0";
import type { ModuleDeclaration } from "@/workspace-host/modules";

export type CompositionDiagnosticCode =
  | "unknown-active-module"
  | "unknown-planned-module"
  | "config-import-path-forbidden"
  | "duplicate-module-declaration";

export interface CompositionDiagnostic {
  code: CompositionDiagnosticCode;
  moduleId: string;
  message: string;
  severity: "error" | "warning" | "info";
  details?: unknown;
}

/**
 * Any of these keys inside a module entry would indicate the config is
 * trying to smuggle an import target. The workspace-config JSON Schema
 * already sets `additionalProperties: false` — this list is a
 * defence-in-depth check ahead of the compile-time loader table.
 */
export const FORBIDDEN_MODULE_ENTRY_KEYS = [
  "url",
  "src",
  "path",
  "import",
  "remote_url",
  "remoteUrl",
  "loader",
  "bundle",
  "code",
] as const;

export interface ResolveModuleDeclarationsInput {
  /** Raw module entries as they appear in workspace.config.json. */
  modules: readonly Record<string, unknown>[];
  /** Compile-time known active module ids (present in AVAILABLE_MODULES). */
  availableModuleIds: readonly string[];
  /** Reserved / recognised planned module ids. */
  plannedModuleIds: readonly string[];
}

export interface ResolveModuleDeclarationsResult {
  /** Declarations passed to ModuleRegistry.start(). Excludes unknown modules. */
  declarations: readonly ModuleDeclaration[];
  /** Non-blocking + blocking composition diagnostics. */
  diagnostics: readonly CompositionDiagnostic[];
}

function coerceStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function coerceLevelArray(value: unknown): readonly Level[] {
  const raw = coerceStringArray(value);
  return raw.filter(
    (v): v is Level => v === "T0" || v === "T1" || v === "T2",
  );
}

function coerceOperationArray(value: unknown): readonly OperationId[] {
  return coerceStringArray(value) as readonly OperationId[];
}

/**
 * Pure resolver. Never throws — every irregularity is a diagnostic.
 */
export function resolveModuleDeclarations(
  input: ResolveModuleDeclarationsInput,
): ResolveModuleDeclarationsResult {
  const declarations: ModuleDeclaration[] = [];
  const diagnostics: CompositionDiagnostic[] = [];
  const seen = new Set<string>();
  const known = new Set(input.availableModuleIds);
  const planned = new Set(input.plannedModuleIds);

  for (const entry of input.modules) {
    const moduleId =
      typeof entry?.module_id === "string" ? entry.module_id : "";
    if (!moduleId) continue;

    // §9 — reject any smuggled loader field.
    for (const key of FORBIDDEN_MODULE_ENTRY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(entry, key)) {
        diagnostics.push({
          code: "config-import-path-forbidden",
          moduleId,
          severity: "error",
          message: `module "${moduleId}" declares forbidden field "${key}" — workspace.config.json cannot supply an import target.`,
          details: { field: key },
        });
      }
    }

    if (seen.has(moduleId)) {
      diagnostics.push({
        code: "duplicate-module-declaration",
        moduleId,
        severity: "error",
        message: `module "${moduleId}" declared more than once in workspace.config.json`,
      });
      continue;
    }
    seen.add(moduleId);

    const stateRaw = entry.state;
    const state: ModuleDeclaration["state"] =
      stateRaw === "active" || stateRaw === "planned" || stateRaw === "disabled"
        ? stateRaw
        : "disabled";

    const declaration: ModuleDeclaration = {
      moduleId,
      state,
      requiredLevels: coerceLevelArray(entry.required_levels),
      requiredOperations: coerceOperationArray(entry.required_operations),
      requiredCapabilitiesAll: coerceStringArray(entry.required_capabilities_all),
      requiredCapabilitiesAny: coerceStringArray(entry.required_capabilities_any),
      dependencies: coerceStringArray(entry.dependencies),
    };

    if (state === "active") {
      if (!known.has(moduleId)) {
        diagnostics.push({
          code: "unknown-active-module",
          moduleId,
          severity: "error",
          message: `module "${moduleId}" is declared active but has no entry in the compile-time loader table.`,
        });
        // Still surface it as a declaration so the registry can report
        // it as `unknown` — otherwise diagnostics would be orphaned.
        declarations.push(declaration);
      } else {
        declarations.push(declaration);
      }
    } else if (state === "planned") {
      if (!known.has(moduleId) && !planned.has(moduleId)) {
        diagnostics.push({
          code: "unknown-planned-module",
          moduleId,
          severity: "info",
          message: `module "${moduleId}" is declared planned but is not in the recognised planned inventory.`,
        });
      }
      declarations.push(declaration);
    } else {
      // disabled — pass through; loader is never invoked.
      declarations.push(declaration);
    }
  }

  return {
    declarations: Object.freeze(declarations),
    diagnostics: Object.freeze(diagnostics),
  };
}
