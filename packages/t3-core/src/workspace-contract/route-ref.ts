/**
 * Opaque route reference — the ONLY route identifier a Workspace module
 * may pass across the Host boundary.
 *
 * PROMPT 12 §3. A module never receives, constructs, or inspects a raw
 * URL, hash string, or `URLSearchParams`. The Host owns the mapping from
 * `RouteRef → concrete URL` and may change it (hash routing today,
 * History API tomorrow) without breaking modules.
 */

import { WorkspaceContractError } from "./diagnostics";

/** Regex for valid route ref ids (mirrors module-id / theme-id shape). */
export const ROUTE_REF_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export interface RouteRef {
  readonly id: string;
}

/**
 * Construct a validated `RouteRef`. Throws `WorkspaceContractError` when
 * `id` does not match `ROUTE_REF_ID_PATTERN`. IDs are treated as
 * user-facing identifiers of a route contribution, never as URLs.
 */
export function createRouteRef(id: string): RouteRef {
  if (typeof id !== "string" || !ROUTE_REF_ID_PATTERN.test(id)) {
    throw new WorkspaceContractError(
      "manifest-invalid",
      `RouteRef id "${String(id)}" does not match ${ROUTE_REF_ID_PATTERN}`,
      { id },
    );
  }
  return Object.freeze({ id });
}

/** Type-guard suitable for validators that receive `unknown`. */
export function isRouteRef(value: unknown): value is RouteRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    ROUTE_REF_ID_PATTERN.test((value as { id: string }).id)
  );
}
