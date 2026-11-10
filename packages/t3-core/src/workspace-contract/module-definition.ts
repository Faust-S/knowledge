/**
 * `defineWorkspaceModule` — the ONLY way to declare a Workspace module.
 *
 * The function is a compile-time typing helper + shape guard. It
 * intentionally does NOT:
 *   - resolve manifest against the JSON Schema (use
 *     `validateWorkspaceModuleManifest` for that);
 *   - call `activate()` (that is the ModuleRegistry's job);
 *   - accept remote URLs, bundle bytes, or any dynamic loader.
 *
 * Modules that need to be shipped inside `.iwxa` packages are FORBIDDEN.
 * The Workspace Host trusts only compile-time modules that were built
 * into the shell bundle.
 */

import { WorkspaceContractError, moduleDiagnostic, type ModuleDiagnostic } from "./diagnostics";
import {
  validateWorkspaceModuleManifest,
  type WorkspaceModuleManifest,
} from "./module-manifest";
import type { WorkspaceModuleContext } from "./module-context";
import {
  CONTRIBUTION_GROUPS,
  type AnyContribution,
  type ContributionSet,
} from "./contributions";
import { isRouteRef } from "./route-ref";
import { ALL_OPERATIONS, type OperationId } from "../kernel-client";

export interface WorkspaceModuleActivationDiagnostic {
  code: string;
  message: string;
  details?: unknown;
  /**
   * Severity — PROMPT 15 §8. `"warning"` (default) does NOT change the
   * module status. `"error"` triggers activation rollback and marks the
   * module as `activation-error`.
   */
  severity?: "warning" | "error";
}

export interface WorkspaceModuleActivationResult {
  /**
   * Contributions the Host should mount. All lazy loaders are called by
   * the Host, never by the module itself.
   */
  contributions?: Partial<ContributionSet>;
  /** Optional per-module diagnostics surfaced to the diagnostics panel. */
  diagnostics?: readonly WorkspaceModuleActivationDiagnostic[];
}

export interface WorkspaceModuleDefinition<
  TManifest extends WorkspaceModuleManifest = WorkspaceModuleManifest,
> {
  manifest: TManifest;
  activate(
    context: WorkspaceModuleContext,
  ):
    | WorkspaceModuleActivationResult
    | void
    | Promise<WorkspaceModuleActivationResult | void>;
  deactivate?(): void | Promise<void>;
}

/**
 * Forbidden shapes that must never appear in a module definition — they
 * are the entry points for remote or executable module payloads that the
 * Workspace Host refuses to run.
 */
const FORBIDDEN_DEFINITION_KEYS = [
  "url",
  "remoteUrl",
  "remote_url",
  "src",
  "importMap",
  "import_map",
  "moduleFederation",
  "module_federation",
  "bundle",
  "bundleBytes",
  "bundle_bytes",
  "code",
  "sourceCode",
  "source_code",
] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function assertShape(def: unknown): asserts def is WorkspaceModuleDefinition {
  if (!isPlainObject(def)) {
    throw new WorkspaceContractError(
      "manifest-invalid",
      "defineWorkspaceModule expects a definition object.",
    );
  }
  const manifest = def.manifest;
  if (!isPlainObject(manifest)) {
    throw new WorkspaceContractError(
      "manifest-invalid",
      "defineWorkspaceModule: `manifest` must be an object literal.",
    );
  }
  if (typeof def.activate !== "function") {
    throw new WorkspaceContractError(
      "manifest-invalid",
      "defineWorkspaceModule: `activate` must be a function.",
    );
  }
  if (def.deactivate !== undefined && typeof def.deactivate !== "function") {
    throw new WorkspaceContractError(
      "manifest-invalid",
      "defineWorkspaceModule: `deactivate` must be a function when provided.",
    );
  }
  for (const key of FORBIDDEN_DEFINITION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(def, key)) {
      throw new WorkspaceContractError(
        "remote-code-forbidden",
        `defineWorkspaceModule: field "${key}" is forbidden — modules are compile-time only, no remote or bundled code.`,
      );
    }
  }
  // Manifest-level red flags — these mirror the JSON Schema constraints
  // but are checked here so a bogus TypeScript literal is rejected before
  // ever reaching AJV.
  const security = (manifest as { security?: unknown }).security;
  if (isPlainObject(security)) {
    if (security.direct_indexeddb === true) {
      throw new WorkspaceContractError(
        "unsafe-storage-access",
        "defineWorkspaceModule: security.direct_indexeddb must be false — direct IndexedDB access is forbidden.",
      );
    }
    if (security.remote_code === true) {
      throw new WorkspaceContractError(
        "remote-code-forbidden",
        "defineWorkspaceModule: security.remote_code must be false — remote code loading is forbidden.",
      );
    }
    if (security.iwxa_executable_payload === true) {
      throw new WorkspaceContractError(
        "executable-package-code-forbidden",
        "defineWorkspaceModule: security.iwxa_executable_payload must be false — executable payloads inside .iwxa packages are forbidden.",
      );
    }
  }
}

/**
 * Register a module definition with the Workspace Contract. Returns the
 * same object with strong types preserved (identity function pattern) so
 * consumers keep full inference in `activate(context)` and the manifest.
 */
export function defineWorkspaceModule<
  TManifest extends WorkspaceModuleManifest,
>(
  definition: WorkspaceModuleDefinition<TManifest>,
): WorkspaceModuleDefinition<TManifest> {
  assertShape(definition);
  // PROMPT 12 §6 — AJV manifest validation is now MANDATORY inside
  // defineWorkspaceModule. A manifest that fails the normative schema is
  // rejected before the definition is returned; AJV error objects are
  // attached to the thrown WorkspaceContractError for diagnostics.
  const res = validateWorkspaceModuleManifest(definition.manifest);
  if (!res.ok) {
    throw new WorkspaceContractError(
      "manifest-invalid",
      "defineWorkspaceModule: манифест модуля не соответствует нормативной JSON-схеме.",
      { ajvErrors: res.errors, diagnostics: res.diagnostics },
    );
  }
  Object.defineProperty(definition, WORKSPACE_MODULE_BRAND, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return definition;
}

// -------------------------------------------------------------------------
// PROMPT 15 §6 — brand every module definition returned by
// defineWorkspaceModule with an internal non-enumerable Symbol so the
// ModuleRegistry can reject hand-crafted definitions that bypass the
// contract's shape/manifest/security checks. The symbol is
// non-serializable (does not survive JSON.stringify) and non-enumerable
// (does not appear in Object.keys/for-in).
// -------------------------------------------------------------------------

export const WORKSPACE_MODULE_BRAND: unique symbol = Symbol.for(
  "iwxa.workspace-module-definition",
);

export function isVerifiedWorkspaceModule(
  value: unknown,
): value is WorkspaceModuleDefinition {
  if (value === null || typeof value !== "object") return false;
  const brand = (value as Record<PropertyKey, unknown>)[
    WORKSPACE_MODULE_BRAND
  ];
  return brand === true;
}

// -------------------------------------------------------------------------
// PROMPT 12 §5 — validate the CONTRIBUTIONS returned by activate() against
// the manifest that owns them. Every ID must be owned by the same module,
// every route contribution must carry a valid opaque RouteRef, every
// required operation must be a normative OperationId, and every loader
// must be an actual function. Duplicate IDs inside a contribution group
// are rejected as well. Returns diagnostics rather than throwing so the
// (future) ModuleRegistry can present them without partial acceptance.
// -------------------------------------------------------------------------

const OPERATION_ID_SET: ReadonlySet<string> = new Set(
  ALL_OPERATIONS as readonly string[],
);

export function validateActivationContributions(
  manifest: WorkspaceModuleManifest,
  result: WorkspaceModuleActivationResult | void,
): ModuleDiagnostic[] {
  const diagnostics: ModuleDiagnostic[] = [];
  if (!result || !result.contributions) return diagnostics;

  const push = (message: string, details?: unknown) =>
    diagnostics.push(
      moduleDiagnostic("manifest-invalid", message, {
        moduleId: manifest.module_id,
        details,
      }),
    );

  const contributions = result.contributions as Partial<ContributionSet>;
  const ownerId = manifest.module_id;

  for (const group of CONTRIBUTION_GROUPS) {
    const list = contributions[group];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      push(`contributions.${group} должен быть массивом.`);
      continue;
    }

    const seenIds = new Set<string>();
    for (const raw of list as AnyContribution[]) {
      if (raw === null || typeof raw !== "object") {
        push(`contributions.${group} содержит не-объектный элемент.`);
        continue;
      }
      const c = raw as AnyContribution;

      // Module ownership
      if (c.moduleId !== ownerId) {
        push(
          `contributions.${group}#${c.id}: moduleId "${c.moduleId}" не совпадает с manifest.module_id "${ownerId}".`,
          { expected: ownerId, actual: c.moduleId },
        );
      }

      // Duplicate id detection within the same group
      if (typeof c.id !== "string" || c.id.length === 0) {
        push(`contributions.${group} содержит контрибуцию без id.`);
      } else if (seenIds.has(c.id)) {
        push(
          `contributions.${group} содержит дубликат id "${c.id}".`,
          { id: c.id },
        );
      } else {
        seenIds.add(c.id);
      }

      // requiredOperations must be normative OperationIds
      if (!Array.isArray(c.requiredOperations)) {
        push(`contributions.${group}#${c.id}: requiredOperations должен быть массивом.`);
      } else {
        for (const op of c.requiredOperations as readonly OperationId[]) {
          if (typeof op !== "string" || !OPERATION_ID_SET.has(op)) {
            push(
              `contributions.${group}#${c.id}: неизвестная operation "${String(op)}".`,
              { operation: op },
            );
          }
        }
      }

      for (const [key, value] of [["requiredCapabilitiesAll", c.requiredCapabilitiesAll], ["requiredCapabilitiesAny", c.requiredCapabilitiesAny]] as const) {
        if (value !== undefined && (!Array.isArray(value) || value.some((cap) => typeof cap !== "string" || cap.length < 3))) {
          push(`contributions.${group}#${c.id}: ${key} должен быть массивом capability id.`);
        }
      }

      // Route refs
      if (c.kind === "route" || c.kind === "navigation") {
        const ref = (c as { routeRef?: unknown }).routeRef;
        if (!isRouteRef(ref)) {
          push(
            `contributions.${group}#${c.id}: routeRef отсутствует или невалиден.`,
            { routeRef: ref },
          );
        }
      }

      // Loader function presence
      if (
        c.kind === "route" ||
        c.kind === "viewer" ||
        c.kind === "editor" ||
        c.kind === "panel" ||
        c.kind === "dashboard_card" ||
        c.kind === "command" ||
        c.kind === "validator" ||
        c.kind === "migration" ||
        c.kind === "legacy_importer"
      ) {
        const loader = (c as { loader?: unknown }).loader;
        if (typeof loader !== "function") {
          push(
            `contributions.${group}#${c.id}: loader должен быть функцией.`,
          );
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Collect every contribution declared by an activation result. Used by
 * the (future) ModuleRegistry to detect duplicate ids across groups.
 */
export function collectContributions(
  result: WorkspaceModuleActivationResult | void,
): AnyContribution[] {
  if (!result || !result.contributions) return [];
  const out: AnyContribution[] = [];
  for (const g of CONTRIBUTION_GROUPS) {
    const list = (result.contributions as Partial<ContributionSet>)[g];
    if (Array.isArray(list)) out.push(...(list as AnyContribution[]));
  }
  return out;
}

export interface DuplicateContributionReport {
  group: string;
  id: string;
  count: number;
}

export function findDuplicateContributionIds(
  contributions: readonly AnyContribution[],
): DuplicateContributionReport[] {
  const buckets = new Map<string, number>();
  for (const c of contributions) {
    const key = `${c.kind}:${c.id}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const dupes: DuplicateContributionReport[] = [];
  for (const [key, count] of buckets) {
    if (count > 1) {
      const [group, id] = key.split(/:(.+)/);
      dupes.push({ group, id, count });
    }
  }
  return dupes;
}
