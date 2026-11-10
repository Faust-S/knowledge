/**
 * Dynamic-import + post-import validation (PROMPT 13 §6 / PROMPT 15).
 *
 * Called ONLY after `preflight` returns ok. Loads the module through the
 * compile-time loader table, then validates in strict order:
 *   1. loader default export shape;
 *   2. PROMPT 15 §6 — internal Symbol brand added by
 *      `defineWorkspaceModule`;
 *   3. AJV manifest re-validation;
 *   4. `manifest.module_id === declaration.moduleId`;
 *   5. Workspace + Runtime contract compatibility;
 *   6. activate() invocation (best-effort deactivate on failure — see
 *      ModuleRegistry, which owns the rollback);
 *   7. contribution shape validation;
 *   8. PROMPT 15 §8 — inspection of activation-reported diagnostics
 *      (severity: warning vs error).
 *
 * The `activateInvoked` flag on every result tells the registry whether
 * side effects may have been produced (rollback via `deactivate()`).
 */

import {
  checkModuleCompatibility,
  isVerifiedWorkspaceModule,
  validateActivationContributions,
  validateWorkspaceModuleManifest,
  type RuntimeCompatibilityView,
  type WorkspaceModuleActivationDiagnostic,
  type WorkspaceModuleActivationResult,
  type WorkspaceModuleContext,
  type WorkspaceModuleDefinition,
  type AnyContribution,
  type ContributionGroup,
  CONTRIBUTION_GROUPS,
} from "@/workspace-contract";
import type { ModuleDeclaration, ModuleLoaderTable, ModuleRuntimeStatus } from "./module-types";
import {
  fromModuleDiagnostic,
  registryDiagnostic,
  toErrorDetails,
  type RegistryDiagnostic,
} from "./module-diagnostics";

export interface LoadAndActivateInput {
  declaration: ModuleDeclaration;
  loaderTable: ModuleLoaderTable;
  runtime: RuntimeCompatibilityView;
  context: WorkspaceModuleContext;
}

export type LoadAndActivateResult =
  | {
      ok: true;
      definition: WorkspaceModuleDefinition;
      activation: WorkspaceModuleActivationResult | void;
      ownedContributions: readonly {
        group: ContributionGroup;
        contribution: AnyContribution;
      }[];
      diagnostics: readonly RegistryDiagnostic[];
      activateInvoked: true;
    }
  | {
      ok: false;
      status: Exclude<
        ModuleRuntimeStatus,
        | "activated"
        | "pending"
        | "planned"
        | "disabled"
        | "unknown"
        | "duplicate-module-id"
        | "dependency-error"
        | "missing-level"
        | "missing-operation"
        | "deactivation-error"
        | "context-invalid"
      >;
      diagnostics: readonly RegistryDiagnostic[];
      definition?: WorkspaceModuleDefinition;
      activateInvoked: boolean;
    };

export async function loadAndActivate(
  input: LoadAndActivateInput,
): Promise<LoadAndActivateResult> {
  const { declaration, loaderTable, runtime, context } = input;
  const moduleId = declaration.moduleId;

  const loader = loaderTable[moduleId];
  if (typeof loader !== "function") {
    return {
      ok: false,
      status: "loader-failed",
      activateInvoked: false,
      diagnostics: [
        registryDiagnostic(
          "loader-failed",
          `Loader для модуля "${moduleId}" отсутствует в compile-time таблице.`,
          { moduleId },
        ),
      ],
    };
  }

  // 1. Dynamic import.
  let imported: { default: WorkspaceModuleDefinition };
  try {
    imported = await loader();
  } catch (err) {
    return {
      ok: false,
      status: "loader-failed",
      activateInvoked: false,
      diagnostics: [
        registryDiagnostic(
          "loader-failed",
          `Не удалось загрузить модуль "${moduleId}".`,
          { moduleId, details: toErrorDetails(err) },
        ),
      ],
    };
  }

  const definition = imported?.default;
  if (!definition || typeof definition !== "object") {
    return {
      ok: false,
      status: "loader-failed",
      activateInvoked: false,
      diagnostics: [
        registryDiagnostic(
          "loader-failed",
          `Модуль "${moduleId}" не экспортирует WorkspaceModuleDefinition.`,
          { moduleId },
        ),
      ],
    };
  }

  // 2. PROMPT 15 §6 — Symbol brand check.
  if (!isVerifiedWorkspaceModule(definition)) {
    return {
      ok: false,
      status: "definition-unverified",
      activateInvoked: false,
      diagnostics: [
        registryDiagnostic(
          "definition-unverified",
          `Модуль "${moduleId}" экспортирует определение, не созданное через defineWorkspaceModule.`,
          { moduleId },
        ),
      ],
    };
  }

  // 3. AJV manifest re-validation.
  const manifestCheck = validateWorkspaceModuleManifest(definition.manifest);
  if (!manifestCheck.ok || !manifestCheck.manifest) {
    return {
      ok: false,
      status: "incompatible",
      definition,
      activateInvoked: false,
      diagnostics: manifestCheck.diagnostics.map(fromModuleDiagnostic),
    };
  }
  const manifest = manifestCheck.manifest;

  // 4. module_id parity.
  if (manifest.module_id !== moduleId) {
    return {
      ok: false,
      status: "module-id-mismatch",
      definition,
      activateInvoked: false,
      diagnostics: [
        registryDiagnostic(
          "module-id-mismatch",
          `Загруженный manifest.module_id "${manifest.module_id}" не совпадает с объявленным "${moduleId}".`,
          {
            moduleId,
            details: { declared: moduleId, loaded: manifest.module_id },
          },
        ),
      ],
    };
  }

  // 5. Contract compatibility.
  const compat = checkModuleCompatibility(manifest, runtime, {
    requiredLevels: declaration.requiredLevels,
    requiredOperations: declaration.requiredOperations,
    requiredCapabilitiesAll: declaration.requiredCapabilitiesAll ?? [],
    requiredCapabilitiesAny: declaration.requiredCapabilitiesAny ?? [],
  });
  if (compat.length > 0) {
    return {
      ok: false,
      status: "incompatible",
      definition,
      activateInvoked: false,
      diagnostics: compat.map(fromModuleDiagnostic),
    };
  }

  // 6. activate() — isolated. From here on, `activateInvoked = true`.
  let activation: WorkspaceModuleActivationResult | void;
  try {
    activation = await definition.activate(context);
  } catch (err) {
    return {
      ok: false,
      status: "activation-error",
      definition,
      activateInvoked: true,
      diagnostics: [
        registryDiagnostic(
          "activation-error",
          `activate() модуля "${moduleId}" завершился ошибкой.`,
          { moduleId, details: toErrorDetails(err) },
        ),
      ],
    };
  }

  // 7. Contribution validation.
  const contribDiags = validateActivationContributions(manifest, activation);
  if (contribDiags.length > 0) {
    return {
      ok: false,
      status: "contribution-invalid",
      definition,
      activateInvoked: true,
      diagnostics: contribDiags.map((d) => ({
        ...fromModuleDiagnostic(d),
        code: "contribution-invalid" as const,
      })),
    };
  }

  // 8. PROMPT 15 §8 — module-reported diagnostics: severity-aware.
  const reported: RegistryDiagnostic[] = [];
  let fatalReported = false;
  if (activation && Array.isArray(activation.diagnostics)) {
    for (const d of activation.diagnostics as readonly WorkspaceModuleActivationDiagnostic[]) {
      const severity: "warning" | "error" =
        d.severity === "error" ? "error" : "warning";
      if (severity === "error") fatalReported = true;
      reported.push({
        code: "module-reported",
        moduleId,
        severity,
        message: d.message,
        details: { moduleCode: d.code, details: d.details },
      });
    }
  }

  if (fatalReported) {
    return {
      ok: false,
      status: "activation-error",
      definition,
      activateInvoked: true,
      diagnostics: reported,
    };
  }

  // 9. Bucketize contributions.
  const owned: { group: ContributionGroup; contribution: AnyContribution }[] = [];
  if (activation && activation.contributions) {
    for (const group of CONTRIBUTION_GROUPS) {
      const list = activation.contributions[group];
      if (!Array.isArray(list)) continue;
      for (const c of list as AnyContribution[]) {
        owned.push({ group, contribution: c });
      }
    }
  }

  return {
    ok: true,
    definition,
    activation,
    ownedContributions: owned,
    diagnostics: reported,
    activateInvoked: true,
  };
}
