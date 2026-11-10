/**
 * Object schema ids reserved for Workspace Host implementation state.
 *
 * These records are persistent T1 objects, but are NOT domain/business
 * objects and must not appear in the normal profile object catalogue.
 * Every family listed here still requires exactly one owning module.
 */
export const WORKSPACE_SAVED_VIEW_SCHEMA_ID = "iwxa.workspace.internal.saved-view" as const;
export const WORKSPACE_SAVED_VIEW_SCHEMA_VERSION = "1.0.0" as const;

const INTERNAL_SCHEMA_IDS: ReadonlySet<string> = new Set([
  WORKSPACE_SAVED_VIEW_SCHEMA_ID,
]);

export function isWorkspaceInternalObjectSchema(schemaId: string): boolean {
  return INTERNAL_SCHEMA_IDS.has(schemaId);
}
