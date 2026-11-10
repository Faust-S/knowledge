/**
 * RouteRegistry — Host-owned registry of `RouteRef → HostRouteBinding`
 * (PROMPT 16 §5).
 *
 * Guarantees:
 *   - duplicate routeRef.id is refused;
 *   - `registerMany` is atomic — one bad entry rolls back the whole set;
 *   - `removeOwner` deletes every binding of a given module;
 *   - `resolve` never accepts an unknown RouteRef, an extra param, or a
 *     missing required param;
 *   - opaque params travel through `encodeOpaqueRouteParam` /
 *     `decodeOpaqueRouteParam` and are re-validated with
 *     `isSafeOpaqueId` on both sides.
 */

import type { RouteRef } from "@/workspace-contract";
import {
  freezeHostRouteBinding,
  parseFragmentPattern,
  validateHostRouteBinding,
  type BindingValidationError,
  type HostRouteBinding,
} from "./route-binding";
import type { HostLocation, HostRouteMatch } from "./host-route-state";
import {
  RouteParamError,
  decodeOpaqueRouteParam,
  encodeOpaqueRouteParam,
  isForbiddenRouteParam,
} from "./route-params";

export type RouteRegistryErrorCode =
  | BindingValidationError["code"]
  | "duplicate-route-ref"
  | "unknown-route"
  | "route-inactive"
  | "invalid-owner"
  | "missing-param"
  | "unknown-param"
  | "forbidden-param"
  | "unsafe-opaque-id";

export interface RouteRegistryDiagnostic {
  code: RouteRegistryErrorCode;
  message: string;
  routeRefId?: string;
  param?: string;
  ownerModuleId?: string;
}

export interface RegisterManyResult {
  ok: boolean;
  diagnostics: readonly RouteRegistryDiagnostic[];
}

export class RouteRegistry {
  private readonly byId = new Map<string, HostRouteBinding>();
  private readonly byOwner = new Map<string, Set<string>>();
  private readonly activeIds = new Set<string>();
  private readonly activatedByOwner = new Map<string, Set<string>>();
  private readonly activeListeners = new Set<() => void>();

  subscribeActive(listener: () => void): () => void {
    this.activeListeners.add(listener);
    return () => {
      this.activeListeners.delete(listener);
    };
  }

  private notifyActiveChanged(): void {
    for (const listener of [...this.activeListeners]) listener();
  }

  /** Register one binding. Throws on validation failure. */
  register(binding: HostRouteBinding): void {
    const result = this.registerMany([binding]);
    if (!result.ok) {
      const d = result.diagnostics[0];
      throw new RouteRegistryError(
        d?.code ?? "invalid-route-ref",
        d?.message ?? "invalid binding",
        d,
      );
    }
  }

  /**
   * Atomic bulk registration. If any binding is invalid or duplicates an
   * existing id, no binding from the batch is stored.
   */
  registerMany(bindings: readonly HostRouteBinding[]): RegisterManyResult {
    const diagnostics: RouteRegistryDiagnostic[] = [];
    const batch = new Map<string, HostRouteBinding>();
    for (const raw of bindings) {
      const err = validateHostRouteBinding(raw);
      if (err) {
        diagnostics.push({
          code: err.code,
          message: err.message,
          routeRefId: err.bindingId,
          param: err.param,
          ownerModuleId: raw?.ownerModuleId,
        });
        continue;
      }
      const id = raw.routeRef.id;
      if (this.byId.has(id) || batch.has(id)) {
        diagnostics.push({
          code: "duplicate-route-ref",
          message: `RouteRef "${id}" is already registered`,
          routeRefId: id,
          ownerModuleId: raw.ownerModuleId,
        });
        continue;
      }
      batch.set(id, freezeHostRouteBinding(raw));
    }
    if (diagnostics.length > 0) {
      return { ok: false, diagnostics: Object.freeze(diagnostics) };
    }
    for (const [id, b] of batch) {
      this.byId.set(id, b);
      let owned = this.byOwner.get(b.ownerModuleId);
      if (!owned) {
        owned = new Set();
        this.byOwner.set(b.ownerModuleId, owned);
      }
      owned.add(id);
    }
    return { ok: true, diagnostics: [] };
  }

  removeOwner(ownerModuleId: string): void {
    // Also clear any active-route bookkeeping tied to this owner.
    this.deactivateOwnerRoutes(ownerModuleId);
    const owned = this.byOwner.get(ownerModuleId);
    if (!owned) return;
    for (const id of owned) {
      this.byId.delete(id);
      this.activeIds.delete(id);
    }
    this.byOwner.delete(ownerModuleId);
  }

  /**
   * PROMPT 19 §1 — activate a batch of registered RouteRefs on behalf
   * of an owning module. Atomic: any single failure rejects the batch.
   */
  activateOwnerRoutes(
    ownerModuleId: string,
    routeRefs: readonly RouteRef[],
  ): RegisterManyResult {
    const diagnostics: RouteRegistryDiagnostic[] = [];
    const batch = new Set<string>();
    for (const ref of routeRefs) {
      const id = ref?.id;
      if (typeof id !== "string") {
        diagnostics.push({
          code: "unknown-route",
          message: "RouteRef has no id",
          ownerModuleId,
        });
        continue;
      }
      if (!this.byId.has(id)) {
        diagnostics.push({
          code: "unknown-route",
          message: `RouteRef "${id}" is not registered`,
          routeRefId: id,
          ownerModuleId,
        });
        continue;
      }
      if (this.activeIds.has(id) || batch.has(id)) {
        diagnostics.push({
          code: "duplicate-route-ref",
          message: `RouteRef "${id}" is already active`,
          routeRefId: id,
          ownerModuleId,
        });
        continue;
      }
      batch.add(id);
    }
    if (diagnostics.length > 0) {
      return { ok: false, diagnostics: Object.freeze(diagnostics) };
    }
    let owned = this.activatedByOwner.get(ownerModuleId);
    if (!owned) {
      owned = new Set();
      this.activatedByOwner.set(ownerModuleId, owned);
    }
    for (const id of batch) {
      this.activeIds.add(id);
      owned.add(id);
    }
    if (batch.size > 0) this.notifyActiveChanged();
    return { ok: true, diagnostics: [] };
  }

  deactivateOwnerRoutes(ownerModuleId: string): void {
    const owned = this.activatedByOwner.get(ownerModuleId);
    if (!owned) return;
    let changed = false;
    for (const id of owned) {
      if (this.activeIds.delete(id)) changed = true;
    }
    this.activatedByOwner.delete(ownerModuleId);
    if (changed) this.notifyActiveChanged();
  }

  isActive(ref: RouteRef | { id: string } | null | undefined): boolean {
    return !!ref && typeof ref.id === "string" && this.activeIds.has(ref.id);
  }

  listActive(): readonly HostRouteBinding[] {
    const out: HostRouteBinding[] = [];
    for (const id of this.activeIds) {
      const b = this.byId.get(id);
      if (b) out.push(b);
    }
    return Object.freeze(out);
  }


  hasRef(ref: RouteRef | { id: string }): boolean {
    return typeof ref?.id === "string" && this.byId.has(ref.id);
  }

  get(ref: RouteRef | { id: string }): HostRouteBinding | null {
    if (typeof ref?.id !== "string") return null;
    return this.byId.get(ref.id) ?? null;
  }

  list(): readonly HostRouteBinding[] {
    return Object.freeze([...this.byId.values()]);
  }

  /**
   * Resolve a `RouteRef` (+ params) to a concrete URL string. Only the
   * Host may call this — modules see only `RouterFacade.navigate`.
   */
  resolve(ref: RouteRef, params: Readonly<Record<string, string>> = {}): string {
    if (!ref || typeof ref.id !== "string") {
      throw new RouteRegistryError("unknown-route", "RouteRef has no id");
    }
    const binding = this.byId.get(ref.id);
    if (!binding) {
      throw new RouteRegistryError(
        "unknown-route",
        `RouteRef "${ref.id}" is not registered`,
        { routeRefId: ref.id },
      );
    }
    // Screen every caller-supplied param name (defence in depth).
    for (const name of Object.keys(params)) {
      if (isForbiddenRouteParam(name)) {
        throw new RouteRegistryError(
          "forbidden-param",
          `Param "${name}" is on the forbidden list`,
          { routeRefId: ref.id, param: name },
        );
      }
      if (!binding.allowedParams.includes(name)) {
        throw new RouteRegistryError(
          "unknown-param",
          `Param "${name}" is not allowed on RouteRef "${ref.id}"`,
          { routeRefId: ref.id, param: name },
        );
      }
    }
    if (binding.mode === "static") {
      return binding.staticBase;
    }
    const parsed = parseFragmentPattern(binding.fragmentPattern!);
    if (!parsed.ok) {
      throw new RouteRegistryError(
        "invalid-fragment-pattern",
        parsed.error.message,
        { routeRefId: ref.id },
      );
    }
    const body = binding.fragmentPattern!.slice(2);
    const parts = body.length === 0 ? [] : body.split("/");
    const out: string[] = [];
    for (const part of parts) {
      const m = /^:([a-zA-Z][a-zA-Z0-9_]*)$/.exec(part);
      if (!m) {
        out.push(part);
        continue;
      }
      const name = m[1];
      const value = params[name];
      if (value === undefined) {
        throw new RouteRegistryError(
          "missing-param",
          `RouteRef "${ref.id}" requires param "${name}"`,
          { routeRefId: ref.id, param: name },
        );
      }
      if (binding.opaqueIdParams.includes(name)) {
        try {
          out.push(encodeOpaqueRouteParam(name, value));
        } catch (err) {
          if (err instanceof RouteParamError) {
            throw new RouteRegistryError(err.code, err.message, {
              routeRefId: ref.id,
              param: name,
            });
          }
          throw err;
        }
      } else {
        out.push(encodeURIComponent(value));
      }
    }
    return `${binding.staticBase}#/${out.join("/")}`;
  }

  /**
   * Reverse-lookup: locate the binding matching `location` and decode
   * its parameters. Returns null when nothing matches — the Host treats
   * an unmatched location as the base surface.
   */
  match(location: HostLocation): HostRouteMatch | null {
    return this.matchInternal(location, false);
  }

  /**
   * Same URL matching semantics as match(), but inactive bindings are skipped
   * during candidate selection instead of filtering only after the first match.
   */
  matchActive(location: HostLocation): HostRouteMatch | null {
    return this.matchInternal(location, true);
  }

  private matchInternal(location: HostLocation, activeOnly: boolean): HostRouteMatch | null {
    const pathname = location.pathname;
    const hash = location.hash ?? "";

    // Prefer fragment matches over static-only ones so that e.g. the
    // "workspace" fragment binding wins over "home" when hash is present.
    const fragmentCandidates: HostRouteBinding[] = [];
    const staticCandidates: HostRouteBinding[] = [];
    for (const b of this.byId.values()) {
      if (b.staticBase !== pathname) continue;
      if (activeOnly && !this.activeIds.has(b.routeRef.id)) continue;
      if (b.mode === "fragment") fragmentCandidates.push(b);
      else staticCandidates.push(b);
    }

    if (hash && hash !== "#" && hash !== "#/") {
      for (const b of fragmentCandidates) {
        const match = tryMatchFragment(b, hash);
        if (match) return match;
      }
      return null;
    }

    // Empty fragment — resolve the static base binding if any.
    for (const b of staticCandidates) {
      return { binding: b, params: Object.freeze({}) };
    }
    // A static entry may be served at its base URL without an explicit hash.
    // Select the matching Host-declared landing route only when active.
    const landingId = pathname === "/workspace/" ? "host.base.home"
      : pathname === "/workspace/exchange/" ? "host.exchange.home"
      : pathname === "/workspace/lifecycle/" ? "host.lifecycle.home" : null;
    if (landingId) {
      const landing = fragmentCandidates.find((b) => b.routeRef.id === landingId);
      if (landing) return { binding: landing, params: Object.freeze({}) };
    }
    return null;
  }
}

function tryMatchFragment(
  binding: HostRouteBinding,
  hash: string,
): HostRouteMatch | null {
  if (!hash.startsWith("#/")) return null;
  const parsed = parseFragmentPattern(binding.fragmentPattern!);
  if (!parsed.ok) return null;

  const patternBody = binding.fragmentPattern!.slice(2);
  const patternParts = patternBody.length === 0 ? [] : patternBody.split("/");
  const hashBody = hash.slice(2);
  const hashParts = hashBody.length === 0 ? [] : hashBody.split("/");

  if (patternParts.length !== hashParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const h = hashParts[i];
    const m = /^:([a-zA-Z][a-zA-Z0-9_]*)$/.exec(p);
    if (m) {
      const name = m[1];
      try {
        params[name] = binding.opaqueIdParams.includes(name)
          ? decodeOpaqueRouteParam(name, h)
          : decodeURIComponent(h);
      } catch {
        return null;
      }
    } else if (p !== h) {
      return null;
    }
  }
  return { binding, params: Object.freeze(params) };
}

export class RouteRegistryError extends Error {
  readonly code: RouteRegistryErrorCode;
  readonly detail?: Partial<RouteRegistryDiagnostic>;
  constructor(
    code: RouteRegistryErrorCode,
    message: string,
    detail?: Partial<RouteRegistryDiagnostic>,
  ) {
    super(message);
    this.name = "RouteRegistryError";
    this.code = code;
    this.detail = detail;
  }
}
