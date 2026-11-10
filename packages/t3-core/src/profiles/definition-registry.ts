/**
 * Small, explicit registry of profile definitions.
 *
 * The registry starts EMPTY. Each profile — including `generic` — is a
 * dynamic chunk loaded on demand by `activateProfile`; the module's side
 * effect is to call `registerProfileDefinition(...)`. This module
 * intentionally does NOT statically import any profile definition, so
 * nothing lands in the entry bundle.
 */
import type { WorkspaceProfileId } from "../config/domain-config";
import type { WorkspaceProfileDefinition } from "./definition";

const REGISTRY = new Map<WorkspaceProfileId, WorkspaceProfileDefinition>();

const GENERIC_ID: WorkspaceProfileId = "generic";

export function registerProfileDefinition(
  definition: WorkspaceProfileDefinition,
): void {
  if (REGISTRY.has(definition.id)) {
    throw new Error(
      `Profile definition "${definition.id}" is already registered`,
    );
  }
  REGISTRY.set(definition.id, definition);
}

export function hasProfileDefinition(id: WorkspaceProfileId): boolean {
  return REGISTRY.has(id);
}

/**
 * Returns the definition for `id`. Falls back to the registered generic
 * definition when the requested profile is not present. If generic is not
 * yet registered this is a hard configuration error — callers must load
 * the generic chunk before invoking a fallback.
 */
export function getProfileDefinition(
  id: WorkspaceProfileId,
): WorkspaceProfileDefinition {
  const exact = REGISTRY.get(id);
  if (exact) return exact;
  const generic = REGISTRY.get(GENERIC_ID);
  if (!generic) {
    throw new Error(
      "Generic profile definition is not registered — activateProfile('generic') must be awaited before fallback",
    );
  }
  return generic;
}

export function getGenericProfileDefinition(): WorkspaceProfileDefinition {
  const generic = REGISTRY.get(GENERIC_ID);
  if (!generic) {
    throw new Error(
      "Generic profile definition is not registered — activateProfile('generic') must be awaited first",
    );
  }
  return generic;
}

/** Test-only: reset the registry between suites. Never called at runtime. */
export function __resetProfileDefinitionRegistryForTests(): void {
  REGISTRY.clear();
}
