/**
 * HostRouteBinding — the Host-owned mapping between an opaque `RouteRef`
 * and a concrete URL shape (PROMPT 16 §2, §3, §6).
 *
 * Modules only ever hand the Host a `RouteRef`. The URL grammar,
 * fragment pattern, allowed parameters, and opaque-id encoding live
 * here — outside the module boundary.
 */

import type { RouteRef } from "@/workspace-contract";
import {
  ALLOWED_ROUTE_PARAM_NAMES,
  FORBIDDEN_ROUTE_PARAM_NAMES,
  isAllowedRouteParam,
  isForbiddenRouteParam,
} from "./route-params";
import {
  STATIC_WORKSPACE_ROUTE_BASES,
  isReservedStaticRouteBase,
} from "@/composition/static-route-bases";

export interface HostRouteBinding {
  routeRef: RouteRef;
  ownerModuleId: string;
  mode: "static" | "fragment";
  /** MUST match one of {@link STATIC_WORKSPACE_ROUTE_BASES}. */
  staticBase: string;
  /**
   * Only set on fragment routes. Grammar:
   *   `#/segment(/(:param|segment))*`
   *
   * A `:param` token MUST appear in {@link HostRouteBinding.allowedParams}
   * AND in {@link HostRouteBinding.opaqueIdParams}. Fragment routes carry
   * no query, no nested fragment, no whitespace, no reserved characters.
   */
  fragmentPattern?: string;
  allowedParams: readonly string[];
  opaqueIdParams: readonly string[];
}

export type BindingValidationCode =
  | "invalid-static-base"
  | "invalid-fragment-pattern"
  | "forbidden-param"
  | "unknown-param"
  | "invalid-owner"
  | "invalid-route-ref";

export interface BindingValidationError {
  code: BindingValidationCode;
  message: string;
  bindingId?: string;
  param?: string;
}

const PATH_TRAVERSAL = /(^|\/)\.\.(\/|$)/;
const PROTOCOL_RELATIVE = /^\/\//;
const BAD_CHARS = /[\s?#\\]/;
const FRAGMENT_TOKEN = /^(:[a-zA-Z][a-zA-Z0-9_]*|[a-z0-9][a-z0-9._-]*)$/;
const FRAGMENT_PARAM_TOKEN = /^:([a-zA-Z][a-zA-Z0-9_]*)$/;

/**
 * Validate a static base path against §3. Returns null when valid,
 * a diagnostic otherwise.
 */
export function validateStaticBase(base: string): BindingValidationError | null {
  if (typeof base !== "string" || base.length === 0) {
    return { code: "invalid-static-base", message: "staticBase must be a non-empty string" };
  }
  if (PROTOCOL_RELATIVE.test(base)) {
    return { code: "invalid-static-base", message: "staticBase must not be protocol-relative" };
  }
  if (!base.startsWith("/workspace/")) {
    return { code: "invalid-static-base", message: "staticBase must start with /workspace/" };
  }
  if (!base.endsWith("/")) {
    return { code: "invalid-static-base", message: "staticBase must end with /" };
  }
  if (PATH_TRAVERSAL.test(base)) {
    return { code: "invalid-static-base", message: "staticBase must not contain .." };
  }
  if (BAD_CHARS.test(base)) {
    return {
      code: "invalid-static-base",
      message: "staticBase must not contain whitespace, ?, #, or backslash",
    };
  }
  if (!isReservedStaticRouteBase(base)) {
    return {
      code: "invalid-static-base",
      message: `staticBase must be one of: ${STATIC_WORKSPACE_ROUTE_BASES.join(", ")}`,
    };
  }
  return null;
}

/**
 * Validate a fragment pattern against §4. Returns the list of parameter
 * names extracted from the pattern (in appearance order), or an error.
 */
export function parseFragmentPattern(
  pattern: string,
): { ok: true; params: string[] } | { ok: false; error: BindingValidationError } {
  if (typeof pattern !== "string" || pattern.length === 0) {
    return {
      ok: false,
      error: { code: "invalid-fragment-pattern", message: "fragmentPattern must be a non-empty string" },
    };
  }
  if (!pattern.startsWith("#/")) {
    return {
      ok: false,
      error: { code: "invalid-fragment-pattern", message: "fragmentPattern must start with '#/'" },
    };
  }
  const body = pattern.slice(2);
  if (body.length === 0) {
    return { ok: true, params: [] };
  }
  if (body.includes("//")) {
    return {
      ok: false,
      error: { code: "invalid-fragment-pattern", message: "fragmentPattern must not contain '//'" },
    };
  }
  if (/[\s?#&=\\{}[\]"'<>%,;`]/.test(body)) {
    return {
      ok: false,
      error: { code: "invalid-fragment-pattern", message: "fragmentPattern contains a forbidden character" },
    };
  }
  const parts = body.split("/");
  const params: string[] = [];
  for (const part of parts) {
    if (!FRAGMENT_TOKEN.test(part)) {
      return {
        ok: false,
        error: {
          code: "invalid-fragment-pattern",
          message: `fragmentPattern segment "${part}" is not a valid literal or ':param' token`,
        },
      };
    }
    const m = FRAGMENT_PARAM_TOKEN.exec(part);
    if (m) params.push(m[1]);
  }
  return { ok: true, params };
}

/** Validate a single {@link HostRouteBinding}. Returns null on success. */
export function validateHostRouteBinding(
  binding: HostRouteBinding,
): BindingValidationError | null {
  if (!binding || typeof binding !== "object") {
    return { code: "invalid-route-ref", message: "binding must be an object" };
  }
  if (
    !binding.routeRef ||
    typeof binding.routeRef !== "object" ||
    typeof binding.routeRef.id !== "string"
  ) {
    return { code: "invalid-route-ref", message: "binding.routeRef.id must be a string" };
  }
  if (typeof binding.ownerModuleId !== "string" || binding.ownerModuleId.length === 0) {
    return {
      code: "invalid-owner",
      message: "binding.ownerModuleId must be a non-empty string",
      bindingId: binding.routeRef.id,
    };
  }
  const baseErr = validateStaticBase(binding.staticBase);
  if (baseErr) return { ...baseErr, bindingId: binding.routeRef.id };

  for (const p of binding.allowedParams) {
    if (isForbiddenRouteParam(p)) {
      return {
        code: "forbidden-param",
        message: `param "${p}" is on the forbidden list (${FORBIDDEN_ROUTE_PARAM_NAMES.join(", ")})`,
        bindingId: binding.routeRef.id,
        param: p,
      };
    }
    if (!isAllowedRouteParam(p)) {
      return {
        code: "unknown-param",
        message: `param "${p}" is not one of the allowed opaque ids (${ALLOWED_ROUTE_PARAM_NAMES.join(", ")})`,
        bindingId: binding.routeRef.id,
        param: p,
      };
    }
  }
  for (const p of binding.opaqueIdParams) {
    if (!binding.allowedParams.includes(p)) {
      return {
        code: "unknown-param",
        message: `opaqueIdParam "${p}" is not present in allowedParams`,
        bindingId: binding.routeRef.id,
        param: p,
      };
    }
  }

  if (binding.mode === "fragment") {
    if (typeof binding.fragmentPattern !== "string") {
      return {
        code: "invalid-fragment-pattern",
        message: "fragment binding requires fragmentPattern",
        bindingId: binding.routeRef.id,
      };
    }
    const parsed = parseFragmentPattern(binding.fragmentPattern);
    if (!parsed.ok) {
      return { ...parsed.error, bindingId: binding.routeRef.id };
    }
    for (const p of parsed.params) {
      if (!binding.allowedParams.includes(p)) {
        return {
          code: "unknown-param",
          message: `fragmentPattern references ":${p}" which is not in allowedParams`,
          bindingId: binding.routeRef.id,
          param: p,
        };
      }
      if (!binding.opaqueIdParams.includes(p)) {
        return {
          code: "forbidden-param",
          message: `fragmentPattern parameter ":${p}" must be listed in opaqueIdParams`,
          bindingId: binding.routeRef.id,
          param: p,
        };
      }
    }
  } else if (binding.mode === "static") {
    if (binding.fragmentPattern !== undefined) {
      return {
        code: "invalid-fragment-pattern",
        message: "static binding must not declare fragmentPattern",
        bindingId: binding.routeRef.id,
      };
    }
    if (binding.allowedParams.length > 0) {
      return {
        code: "unknown-param",
        message: "static binding must not declare allowedParams",
        bindingId: binding.routeRef.id,
      };
    }
  } else {
    return {
      code: "invalid-fragment-pattern",
      message: `binding.mode must be "static" or "fragment"`,
      bindingId: binding.routeRef.id,
    };
  }
  return null;
}

export function freezeHostRouteBinding(b: HostRouteBinding): HostRouteBinding {
  return Object.freeze({
    ...b,
    routeRef: Object.freeze({ id: b.routeRef.id }),
    allowedParams: Object.freeze([...b.allowedParams]),
    opaqueIdParams: Object.freeze([...b.opaqueIdParams]),
  });
}
