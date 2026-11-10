/**
 * Compatibility checker for Workspace Contract + Runtime Contract.
 *
 * The checker is a pure function: it consumes a validated manifest and a
 * `RuntimeCompatibilityView` describing the runtime the Host will bind the
 * module to, and returns a list of diagnostics. An empty list means the
 * module is compatible.
 *
 * IMPORTANT: this function decides ONLY about compatibility. Manifest
 * shape errors, security violations, and duplicate-id detection live in
 * dedicated files.
 */

import type { OperationId } from "../kernel-client";
import type { Level } from "../kernel-client/contracts/runtime-1.3.0";
import {
  EXPECTED_RUNTIME_CONTRACT_VERSION,
  WORKSPACE_CONTRACT_VERSION,
} from "./version";
import { moduleDiagnostic, type ModuleDiagnostic } from "./diagnostics";
import type { WorkspaceModuleManifest } from "./module-manifest";

export interface RuntimeCompatibilityView {
  /** Runtime Contract version reported by the kernel session. */
  contractVersion: string;
  /** Levels the current session has been granted. */
  grantedLevels: readonly Level[];
  /** Canonical operations the current session has been granted. */
  grantedOperations: readonly OperationId[];
  /** Read-only capability ids currently active for the host context. */
  activeCapabilities?: readonly string[];
}

export interface ModuleCompatibilityRequirements {
  /** Runtime levels the module must have access to. */
  requiredLevels: readonly Level[];
  /** Runtime operations the module's declared contributions add up to. */
  requiredOperations: readonly OperationId[];
  /** Every listed capability must be active. */
  requiredCapabilitiesAll?: readonly string[];
  /** When non-empty, at least one listed capability must be active. */
  requiredCapabilitiesAny?: readonly string[];
}

export function checkModuleCompatibility(
  manifest: WorkspaceModuleManifest,
  runtime: RuntimeCompatibilityView,
  requirements: ModuleCompatibilityRequirements = {
    requiredLevels: [],
    requiredOperations: [],
    requiredCapabilitiesAll: [],
    requiredCapabilitiesAny: [],
  },
): ModuleDiagnostic[] {
  const out: ModuleDiagnostic[] = [];

  if (manifest.compatibility.workspace_contract !== WORKSPACE_CONTRACT_VERSION) {
    out.push(
      moduleDiagnostic(
        "workspace-contract-incompatible",
        `Модуль требует Workspace Contract ${manifest.compatibility.workspace_contract}, установлена ${WORKSPACE_CONTRACT_VERSION}.`,
        {
          moduleId: manifest.module_id,
          details: {
            required: manifest.compatibility.workspace_contract,
            installed: WORKSPACE_CONTRACT_VERSION,
          },
        },
      ),
    );
  }

  // Current T2 uses one Runtime Contract; older sessions cannot activate modules.
  if (manifest.compatibility.runtime_contract !== EXPECTED_RUNTIME_CONTRACT_VERSION) {
    out.push(moduleDiagnostic("runtime-contract-incompatible",
      `Модуль требует ${manifest.compatibility.runtime_contract}; требуется ${EXPECTED_RUNTIME_CONTRACT_VERSION}.`,
      { moduleId: manifest.module_id, details: manifest.compatibility.runtime_contract }));
  }
  if (runtime.contractVersion !== EXPECTED_RUNTIME_CONTRACT_VERSION) {
    out.push(moduleDiagnostic("runtime-contract-incompatible",
      `Kernel Runtime Contract ${runtime.contractVersion} отклонён; требуется ${EXPECTED_RUNTIME_CONTRACT_VERSION}.`,
      { moduleId: manifest.module_id, details: runtime.contractVersion }));
  }

  const grantedLevelSet = new Set<string>(runtime.grantedLevels);
  for (const level of requirements.requiredLevels) {
    if (!grantedLevelSet.has(level)) {
      out.push(
        moduleDiagnostic(
          "missing-runtime-level",
          `Модуль требует уровень ${level}, но он не выдан текущей сессии.`,
          { moduleId: manifest.module_id, details: level },
        ),
      );
    }
  }

  const grantedOpSet = new Set<string>(runtime.grantedOperations);
  for (const op of requirements.requiredOperations) {
    if (!grantedOpSet.has(op)) {
      out.push(
        moduleDiagnostic(
          "missing-operation",
          `Модуль требует операцию ${op}, но она не выдана текущей сессии.`,
          { moduleId: manifest.module_id, details: op },
        ),
      );
    }
  }

  const activeCapabilitySet = new Set<string>(runtime.activeCapabilities ?? []);
  const requiredCapabilitiesAll = requirements.requiredCapabilitiesAll ?? [];
  const requiredCapabilitiesAny = requirements.requiredCapabilitiesAny ?? [];
  for (const capability of requiredCapabilitiesAll) {
    if (!activeCapabilitySet.has(capability)) {
      out.push(moduleDiagnostic(
        "missing-capability",
        `Модуль требует capability ${capability}, но она не ACTIVE в текущем контексте.`,
        { moduleId: manifest.module_id, details: capability },
      ));
    }
  }
  if (requiredCapabilitiesAny.length > 0 &&
      !requiredCapabilitiesAny.some((capability) => activeCapabilitySet.has(capability))) {
    out.push(moduleDiagnostic(
      "missing-capability",
      `Модуль требует хотя бы одну ACTIVE capability из объявленного набора.`,
      { moduleId: manifest.module_id, details: requiredCapabilitiesAny },
    ));
  }

  return out;
}
