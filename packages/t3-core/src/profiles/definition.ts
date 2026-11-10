/**
 * WorkspaceProfileDefinition — the ONLY presentation contract a profile
 * ships. Describes how the shell groups and titles objects of a profile.
 *
 * A definition MUST NOT contain:
 *   - kernel functions or storage operations;
 *   - cross-service handoff routes (T3 concept);
 *   - JSON Schemas or record-shape validation;
 *   - business calculations;
 *   - transformations of user data.
 */
import type { WorkspaceProfileId } from "../config/domain-config";

export interface WorkspaceObjectSection {
  id: string;
  title: string;
  description?: string;
  /** schema_id values that belong to this section. Empty = catch-all. */
  schemaIds: readonly string[];
  emptyTitle: string;
  emptyDescription: string;
}

export interface WorkspaceObjectOwnerCommandDescriptor {
  /** Profile-scoped stable descriptor id. */
  id: string;
  /** User-facing label; does not grant execution authority. */
  label: string;
  /** Exact Host CommandRegistry contribution id owned by the business owner module. */
  commandId: string;
  /** Canonical schema_id values admitted by this command. Empty is invalid/fail-closed. */
  schemaIds: readonly string[];
  /** Exact required selection cardinality. */
  selectionSize: number;
  /** When true, every selected canonical object must have the same schema_id. */
  sameSchema: boolean;
}

export interface WorkspaceProfileDefinition {
  id: WorkspaceProfileId;
  label: string;
  description: string;
  logoText: string;
  /** CSS colour value. Applied via --workspace-accent, never as a Tailwind class. */
  accent: string;
  sections: readonly WorkspaceObjectSection[];
  /**
   * Optional T2.5 P2 object-command declarations. Profiles declare descriptors only;
   * execution remains in the existing Host CommandRegistry / owner module path.
   */
  objectOwnerCommands?: readonly WorkspaceObjectOwnerCommandDescriptor[];
  unknownObjectsSection: {
    title: string;
    description: string;
  };
}
