/**
 * Workspace profile identifiers.
 *
 * These are the compile-time known profile ids the Workspace can activate.
 * The list is deliberately kept in a tiny file with no runtime dependency
 * so the presentation layer can import it without dragging in the legacy
 * projection/validators from `./domain-config.ts`.
 *
 * Cross-cutting rule (Prompt 09 §3):
 *   - The starting profile of the Host is `workspace.config.json → profile`.
 *   - The actual profile of an opened workspace is `WorkspaceRecord.profile`.
 *   - `domain.json → workspace_profile` is a domain declaration, already
 *     verified by the host-config controller's cross-file invariants and
 *     MUST NOT be consulted as an independent source by the shell.
 */

export const WORKSPACE_PROFILES = [
  "generic",
  "learning",
  "personal",
  "organization",
  "health",
] as const;

export type WorkspaceProfileId = (typeof WORKSPACE_PROFILES)[number];

export const CAPABILITIES = ["T0", "T1", "T2"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Canonical on-device store name, frozen for the Local Store contract. */
export const LOCAL_STORE_NAME = "iwxa-local" as const;

export function isWorkspaceProfileId(value: unknown): value is WorkspaceProfileId {
  return (
    typeof value === "string" &&
    (WORKSPACE_PROFILES as readonly string[]).includes(value)
  );
}
