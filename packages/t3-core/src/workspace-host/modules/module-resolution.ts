/**
 * Preflight resolution (PROMPT 13 §5).
 *
 * A pure function that decides — BEFORE any dynamic import — whether a
 * module's loader may run. It consumes the declaration from
 * `workspace.config.json`, the runtime compatibility view, the set of
 * loader-table ids, and the dependency-analysis result, and returns
 * either `{ ok: true }` or the terminal status + diagnostics.
 *
 * Only modules that pass preflight are handed to `loadAndActivate`;
 * everything else is quarantined without touching the network / bundler.
 */

import type {
  ModuleDeclaration,
  ModuleRuntimeStatus,
} from "./module-types";
import type { RuntimeCompatibilityView } from "@/workspace-contract";
import { registryDiagnostic, type RegistryDiagnostic } from "./module-diagnostics";

export interface PreflightInput {
  declaration: ModuleDeclaration;
  runtime: RuntimeCompatibilityView;
  loaderIds: ReadonlySet<string>;
  dependencyFailed: boolean;
  dependencyDiagnostics: readonly RegistryDiagnostic[];
}

export type PreflightResult =
  | { ok: true; diagnostics: readonly RegistryDiagnostic[] }
  | {
      ok: false;
      status: ModuleRuntimeStatus;
      diagnostics: readonly RegistryDiagnostic[];
    };

export function preflight(input: PreflightInput): PreflightResult {
  const { declaration, runtime, loaderIds, dependencyFailed, dependencyDiagnostics } =
    input;
  const diagnostics: RegistryDiagnostic[] = [];

  // 1. Declared state.
  if (declaration.state === "planned") {
    return { ok: false, status: "planned", diagnostics: [] };
  }
  if (declaration.state === "disabled") {
    return { ok: false, status: "disabled", diagnostics: [] };
  }

  // 2. Loader must exist. `unknown-module` is diagnosed and the host
  //    continues (PROMPT 13 §3).
  if (!loaderIds.has(declaration.moduleId)) {
    diagnostics.push(
      registryDiagnostic(
        "unknown-module",
        `Модуль "${declaration.moduleId}" объявлен active, но отсутствует в compile-time loader table.`,
        { moduleId: declaration.moduleId },
      ),
    );
    return { ok: false, status: "unknown", diagnostics };
  }

  // 3. Dependency graph verdict.
  if (dependencyFailed) {
    return {
      ok: false,
      status: "dependency-error",
      diagnostics: dependencyDiagnostics,
    };
  }

  // 4. Required levels.
  const grantedLevels = new Set<string>(runtime.grantedLevels);
  for (const level of declaration.requiredLevels) {
    if (!grantedLevels.has(level)) {
      diagnostics.push(
        registryDiagnostic(
          "missing-runtime-level",
          `Модуль "${declaration.moduleId}" требует уровень ${level}, но он не выдан текущей сессии.`,
          { moduleId: declaration.moduleId, details: level },
        ),
      );
    }
  }
  if (diagnostics.some((d) => d.code === "missing-runtime-level")) {
    return { ok: false, status: "missing-level", diagnostics };
  }

  // 5. Required operations.
  const grantedOps = new Set<string>(runtime.grantedOperations);
  for (const op of declaration.requiredOperations) {
    if (!grantedOps.has(op)) {
      diagnostics.push(
        registryDiagnostic(
          "missing-operation",
          `Модуль "${declaration.moduleId}" требует операцию ${op}, но она не выдана текущей сессии.`,
          { moduleId: declaration.moduleId, details: op },
        ),
      );
    }
  }
  if (diagnostics.some((d) => d.code === "missing-operation")) {
    return { ok: false, status: "missing-operation", diagnostics };
  }

  // 6. Capability requirements are an additional Workspace guard. Kernel
  // remains the authority and re-checks guarded primitive operations.
  const activeCaps = new Set<string>(runtime.activeCapabilities ?? []);
  for (const capability of declaration.requiredCapabilitiesAll ?? []) {
    if (!activeCaps.has(capability)) {
      diagnostics.push(registryDiagnostic(
        "missing-capability",
        `Модуль "${declaration.moduleId}" требует capability ${capability}, но она не ACTIVE.`,
        { moduleId: declaration.moduleId, details: capability },
      ));
    }
  }
  const requiredAny = declaration.requiredCapabilitiesAny ?? [];
  if (requiredAny.length > 0 &&
      !requiredAny.some((capability) => activeCaps.has(capability))) {
    diagnostics.push(registryDiagnostic(
      "missing-capability",
      `Модуль "${declaration.moduleId}" требует хотя бы одну ACTIVE capability из объявленного набора.`,
      { moduleId: declaration.moduleId, details: requiredAny },
    ));
  }
  if (diagnostics.some((d) => d.code === "missing-capability")) {
    return { ok: false, status: "missing-capability", diagnostics };
  }

  return { ok: true, diagnostics: [] };
}
