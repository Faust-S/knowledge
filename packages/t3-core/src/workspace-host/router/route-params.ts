/**
 * Route parameter grammar (PROMPT 16 §4).
 *
 * Host routes carry ONLY opaque identifiers. Payloads, tokens, previews,
 * receipts, plan objects, titles, and profile hints MUST NEVER appear in
 * a URL. The blocklist below is enforced by every registry entry point;
 * a violation is a Host defect, never a runtime prompt for the user.
 */

import { isSafeOpaqueId } from "@/shell/routing";

/** Parameter names permitted anywhere in the Host route grammar. */
export const ALLOWED_ROUTE_PARAM_NAMES = ["workspaceId", "objectId"] as const;

export type AllowedRouteParamName = (typeof ALLOWED_ROUTE_PARAM_NAMES)[number];

/**
 * Explicit blocklist. Duplicates the fields the T2 exchange / lifecycle
 * surfaces exchange in-memory so a regression cannot smuggle them into
 * the address bar.
 */
export const FORBIDDEN_ROUTE_PARAM_NAMES = [
  "payload",
  "data",
  "title",
  "profile",
  "package",
  "bytes",
  "previewToken",
  "purgeToken",
  "digest",
  "importPlan",
  "exportReceipt",
  "intent",
] as const;

export type ForbiddenRouteParamName =
  (typeof FORBIDDEN_ROUTE_PARAM_NAMES)[number];

export function isAllowedRouteParam(name: string): name is AllowedRouteParamName {
  return (ALLOWED_ROUTE_PARAM_NAMES as readonly string[]).includes(name);
}

export function isForbiddenRouteParam(
  name: string,
): name is ForbiddenRouteParamName {
  return (FORBIDDEN_ROUTE_PARAM_NAMES as readonly string[]).includes(name);
}

/** Encode an opaque id after validating it with `isSafeOpaqueId`. */
export function encodeOpaqueRouteParam(name: string, value: string): string {
  if (!isSafeOpaqueId(value)) {
    throw new RouteParamError(
      "unsafe-opaque-id",
      `Route parameter "${name}" is not a safe opaque id.`,
    );
  }
  return encodeURIComponent(value);
}

/** Decode + re-validate an opaque id. Symmetric with `encodeOpaqueRouteParam`. */
export function decodeOpaqueRouteParam(name: string, encoded: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    throw new RouteParamError(
      "unsafe-opaque-id",
      `Route parameter "${name}" is not valid percent-encoding.`,
    );
  }
  if (!isSafeOpaqueId(decoded)) {
    throw new RouteParamError(
      "unsafe-opaque-id",
      `Route parameter "${name}" is not a safe opaque id after decoding.`,
    );
  }
  return decoded;
}

export type RouteParamErrorCode =
  | "unsafe-opaque-id"
  | "forbidden-param"
  | "unknown-param"
  | "unknown-route"
  | "missing-param";

export class RouteParamError extends Error {
  readonly code: RouteParamErrorCode;
  constructor(code: RouteParamErrorCode, message: string) {
    super(message);
    this.name = "RouteParamError";
    this.code = code;
  }
}
