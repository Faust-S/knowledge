/**
 * Profile activation — a single dynamic import per profile.
 *
 * EVERY profile — including `generic` — is loaded through a dedicated
 * dynamic import so it lands in its own async chunk. Rollup emits one
 * chunk per branch and the entry bundle stays free of profile-specific
 * strings. All known profiles, including health, are available.
 */
import { DomainConfigError, type WorkspaceProfileId } from "./domain-config";
import type { WorkspaceProfileDefinition } from "../profiles/definition";
import {
  getGenericProfileDefinition,
  getProfileDefinition,
  hasProfileDefinition,
} from "../profiles/definition-registry";

export interface ActiveProfile {
  /** Requested profile id — retained for diagnostics even when fallback fires. */
  requestedId: WorkspaceProfileId;
  /** Actual profile definition applied (generic on fallback). */
  definition: WorkspaceProfileDefinition;
  /** True when the requested profile module failed to register a definition. */
  fallback: boolean;
}

async function loadGeneric(): Promise<void> {
  if (!hasProfileDefinition("generic")) {
    await import("../profiles/generic");
  }
}

async function loadProfileModule(id: WorkspaceProfileId): Promise<boolean> {
  switch (id) {
    case "generic": {
      await loadGeneric();
      return hasProfileDefinition("generic");
    }
    case "learning": {
      await import("../profiles/learning");
      return hasProfileDefinition("learning");
    }
    case "personal": {
      await import("../profiles/personal");
      return hasProfileDefinition("personal");
    }
    case "organization": {
      await import("../profiles/organization");
      return hasProfileDefinition("organization");
    }
    case "health": {
      const m = await import("../profiles/health");
      m.registerHealthProfile();
      return hasProfileDefinition("health");
    }
  }
}

export async function activateProfile(
  id: WorkspaceProfileId,
): Promise<ActiveProfile> {
  try {
    const registered = await loadProfileModule(id);
    if (registered) {
      return {
        requestedId: id,
        definition: getProfileDefinition(id),
        fallback: false,
      };
    }
  } catch (e) {
    if (e instanceof DomainConfigError) throw e;
    // Unknown / broken profile module — degrade to generic below.
  }
  // Fallback path: ensure generic is loaded, then use it.
  await loadGeneric();
  return {
    requestedId: id,
    definition: getGenericProfileDefinition(),
    fallback: true,
  };
}
