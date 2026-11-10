/**
 * Workspace error taxonomy (Prompt 13).
 *
 * These codes describe *technical* failures that the shell must surface to
 * the user without inventing a fallback architecture (no silent local
 * mirrors, no auto-clear, no guesswork). Every code has:
 *   - a human, non-technical safe message (shown in production);
 *   - an explicit data-status verdict ("were my data lost?");
 *   - a curated list of safe next actions.
 *
 * The list is closed on purpose — a new failure mode must be added here
 * before the shell can render it, otherwise the boundary will fall through
 * to the "unknown" code (which itself is explicit, not silent).
 */

export type WorkspaceErrorCode =
  | "config_invalid"
  | "kernel_unavailable"
  | "migration_required"
  | "quota_exceeded"
  | "conflict"
  | "unsupported_schema"
  | "package_corrupted"
  | "health_build_required"
  | "unknown";

export const ALL_ERROR_CODES: readonly WorkspaceErrorCode[] = [
  "config_invalid",
  "kernel_unavailable",
  "migration_required",
  "quota_exceeded",
  "conflict",
  "unsupported_schema",
  "package_corrupted",
  "health_build_required",
  "unknown",
] as const;

/** Verdict shown to the user about their data. Never omit this. */
export type DataStatus =
  | "preserved" // kernel confirms data is intact in local store
  | "unchanged" // operation was refused before touching data
  | "at_risk" // kernel can't confirm — user should export before acting
  | "unknown"; // truly indeterminate (only for `unknown` code)

/** Safe action identifiers. Ordering rules are enforced in registry.ts. */
export type ErrorActionId =
  | "retry"
  | "reload"
  | "open_readonly"
  | "export_iwxa" // MUST come before any destructive action
  | "resolve_conflict"
  | "run_migration"
  | "pick_other_package"
  | "view_dev_details" // dev-only, hidden in production
  | "contact_support"
  | "clear_workspace" // destructive — never allowed before export_iwxa
  | "reset_kernel"; // destructive — never allowed before export_iwxa

export const DESTRUCTIVE_ACTIONS: ReadonlySet<ErrorActionId> = new Set([
  "clear_workspace",
  "reset_kernel",
]);
