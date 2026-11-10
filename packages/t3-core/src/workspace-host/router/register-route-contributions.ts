/**
 * registerRouteContributions — PROMPT 16 §9.
 *
 * Pure helper that validates a batch of module-supplied
 * `RouteContribution`s against the Host's binding table BEFORE they
 * reach the ModuleRegistry contribution store. Ownership, required
 * operations, and binding presence are enforced here; the module can
 * only reference the opaque `RouteRef` — never a raw path.
 *
 * A single failure rejects the whole batch (atomicity mirrors the
 * ContributionStore rules).
 */

import type { RouteContribution } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";
import type { HostRouteBinding } from "./route-binding";

export type RouteContributionErrorCode =
  | "route-binding-missing"
  | "route-owner-mismatch"
  | "route-operation-missing"
  | "route-capability-missing"
  | "route-not-contribution";

export interface RouteContributionDiagnostic {
  code: RouteContributionErrorCode;
  message: string;
  contributionId?: string;
  routeRefId?: string;
  operation?: OperationId;
  capability?: string;
}

export interface RouteContributionRegistrationInput {
  ownerModuleId: string;
  contributions: readonly RouteContribution[];
  hostBindings: readonly HostRouteBinding[];
  /** Granted operations of the current session. */
  grantedOperations: readonly OperationId[];
  activeCapabilities?: readonly string[];
}

export interface RouteContributionRegistrationResult {
  ok: boolean;
  accepted: readonly RouteContribution[];
  diagnostics: readonly RouteContributionDiagnostic[];
}

export function registerRouteContributions(
  input: RouteContributionRegistrationInput,
): RouteContributionRegistrationResult {
  const diagnostics: RouteContributionDiagnostic[] = [];
  const bindingsById = new Map(input.hostBindings.map((b) => [b.routeRef.id, b]));
  const grantedOps = new Set<string>(input.grantedOperations as readonly string[]);
  const activeCaps = new Set<string>(input.activeCapabilities ?? []);
  const accepted: RouteContribution[] = [];

  for (const c of input.contributions) {
    if (!c || c.kind !== "route") {
      diagnostics.push({
        code: "route-not-contribution",
        message: "contribution is not a route contribution",
        contributionId: (c as { id?: string } | null)?.id,
      });
      continue;
    }
    if (c.moduleId !== input.ownerModuleId) {
      diagnostics.push({
        code: "route-owner-mismatch",
        message: `route "${c.id}" declares moduleId "${c.moduleId}" but batch owner is "${input.ownerModuleId}"`,
        contributionId: c.id,
        routeRefId: c.routeRef.id,
      });
      continue;
    }
    const binding = bindingsById.get(c.routeRef.id);
    if (!binding) {
      diagnostics.push({
        code: "route-binding-missing",
        message: `RouteRef "${c.routeRef.id}" has no Host binding — module cannot register a URL`,
        contributionId: c.id,
        routeRefId: c.routeRef.id,
      });
      continue;
    }
    let opMissing: OperationId | undefined;
    for (const op of c.requiredOperations) {
      if (!grantedOps.has(op)) {
        opMissing = op;
        break;
      }
    }
    if (opMissing) {
      diagnostics.push({
        code: "route-operation-missing",
        message: `route "${c.id}" requires ungranted operation "${opMissing}"`,
        contributionId: c.id,
        routeRefId: c.routeRef.id,
        operation: opMissing,
      });
      continue;
    }
    const requiredAll = c.requiredCapabilitiesAll ?? [];
    const requiredAny = c.requiredCapabilitiesAny ?? [];
    const missingAll = requiredAll.find((capability) => !activeCaps.has(capability));
    if (missingAll || (requiredAny.length > 0 && !requiredAny.some((capability) => activeCaps.has(capability)))) {
      diagnostics.push({
        code: "route-capability-missing",
        message: `route "${c.id}" requires an inactive capability`,
        contributionId: c.id,
        routeRefId: c.routeRef.id,
        capability: missingAll ?? requiredAny.join("|"),
      });
      continue;
    }
    accepted.push(c);
  }

  if (diagnostics.length > 0) {
    return { ok: false, accepted: [], diagnostics: Object.freeze(diagnostics) };
  }
  return {
    ok: true,
    accepted: Object.freeze(accepted),
    diagnostics: [],
  };
}
