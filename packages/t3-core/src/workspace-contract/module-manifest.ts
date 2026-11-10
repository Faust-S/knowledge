/**
 * Workspace module manifest — AJV validator + typed view.
 *
 * The JSON manifest is authoritative: it MUST conform to
 * `src/config/schemas/keys-2.0/workspace-module-manifest.schema.json`.
 * This module produces a strict TypeScript view AFTER AJV validation.
 * The Workspace Contract MUST NOT extend the JSON schema surface — every
 * new manifest field belongs to the schema first.
 */

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import manifestSchema from "../config/schemas/keys-2.0/workspace-module-manifest.schema.json";
import {
  SUPPORTED_MODULE_MANIFEST_VERSION,
  WORKSPACE_CONTRACT_VERSION,
} from "./version";
import { CONTRIBUTION_GROUPS } from "./contributions";
import { moduleDiagnostic, type ModuleDiagnostic } from "./diagnostics";

// --- Types -----------------------------------------------------------------

export interface WorkspaceModuleManifestCompatibility {
  workspace_contract: string;
  runtime_contract: "1.3.0";
}

export interface WorkspaceModuleManifestSecurity {
  /**
   * The three keys the Host security policy MUST see set to `false` before
   * the module is allowed to activate. The AJV schema pins them to `false`
   * via `const`; TypeScript reflects that with `false` literal types.
   */
  direct_indexeddb: false;
  remote_code: false;
  iwxa_executable_payload: false;
}

/**
 * Manifest contribution declarations are opaque JSON arrays: the ROLE of
 * the manifest is to declare presence + counts + ids; the shape of each
 * contribution is enforced by the TypeScript types in `./contributions`
 * once the module is compiled and activated.
 */
export interface WorkspaceModuleManifestContributions {
  routes: unknown[];
  navigation: unknown[];
  editors: unknown[];
  viewers: unknown[];
  commands: unknown[];
  panels: unknown[];
  dashboard_cards: unknown[];
  validators: unknown[];
  migrations: unknown[];
  legacy_importers: unknown[];
}

export interface WorkspaceModuleManifest {
  module_manifest_version: "1.0.0";
  module_id: string;
  module_version: string;
  title: string;
  compatibility: WorkspaceModuleManifestCompatibility;
  contributions: WorkspaceModuleManifestContributions;
  security: WorkspaceModuleManifestSecurity;
}

// --- Validator -------------------------------------------------------------

const ajv = new Ajv2020({
  strict: false,
  allErrors: true,
  loadSchema: () => {
    throw new Error("workspace-module-manifest validator must not load remote $schema");
  },
});
addFormats(ajv);
const compiled = ajv.compile(
  manifestSchema as object,
) as ValidateFunction<WorkspaceModuleManifest>;

export interface ManifestValidationResult {
  ok: boolean;
  manifest: WorkspaceModuleManifest | null;
  diagnostics: ModuleDiagnostic[];
  /** Raw AJV errors (technical, for diagnostics surface only). */
  errors: ErrorObject[] | null;
}

/**
 * Validate a raw manifest against the normative JSON Schema and derive
 * a strict TypeScript view. Returns diagnostics rather than throwing.
 */
export function validateWorkspaceModuleManifest(
  raw: unknown,
): ManifestValidationResult {
  const ok = compiled(raw);
  if (!ok) {
    const errors = compiled.errors ?? [];
    return {
      ok: false,
      manifest: null,
      errors,
      diagnostics: [
        moduleDiagnostic(
          "manifest-invalid",
          "Манифест модуля не соответствует нормативной схеме Keys 2.0.",
          {
            moduleId:
              typeof (raw as { module_id?: unknown } | null)?.module_id === "string"
                ? (raw as { module_id: string }).module_id
                : undefined,
            details: errors,
          },
        ),
      ],
    };
  }
  const manifest = raw as WorkspaceModuleManifest;

  // Defence-in-depth: JSON schema declares these constants already, but
  // reconfirm here so a future schema drift cannot silently loosen the
  // Workspace Contract expectations.
  const diagnostics: ModuleDiagnostic[] = [];
  if (manifest.module_manifest_version !== SUPPORTED_MODULE_MANIFEST_VERSION) {
    diagnostics.push(
      moduleDiagnostic(
        "manifest-invalid",
        `Ожидается module_manifest_version=${SUPPORTED_MODULE_MANIFEST_VERSION}.`,
        { moduleId: manifest.module_id, details: manifest.module_manifest_version },
      ),
    );
  }
  for (const g of CONTRIBUTION_GROUPS) {
    if (!Array.isArray(manifest.contributions[g])) {
      diagnostics.push(
        moduleDiagnostic(
          "manifest-invalid",
          `Группа contributions.${g} должна быть массивом.`,
          { moduleId: manifest.module_id },
        ),
      );
    }
  }
  if (diagnostics.length > 0) {
    return { ok: false, manifest: null, errors: null, diagnostics };
  }
  return { ok: true, manifest, errors: null, diagnostics: [] };
}

/**
 * Convenience helper for tests and future ModuleRegistry:
 * returns the current Workspace Contract version that manifests are
 * expected to declare in `compatibility.workspace_contract`.
 */
export function expectedWorkspaceContractVersion(): string {
  return WORKSPACE_CONTRACT_VERSION;
}
