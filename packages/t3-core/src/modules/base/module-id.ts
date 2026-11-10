/**
 * Canonical base module identity (PROMPT 18 §2).
 *
 * The Workspace-owned base module. Every base contribution derives its
 * ownership from this constant. Do NOT invent aliases (`overview`,
 * `workspaces`, `objects`, …) — those synthetic ids are removed.
 */

export const MODULE_ID = "iwxa.workspace.base" as const;
export type ModuleId = typeof MODULE_ID;
