/**
 * tests/host-route-ref-binding.test.ts — PROMPT 16 §9.
 */
import { describe, expect, it } from "vitest";
import { createRouteRef, type RouteContribution } from "@/workspace-contract";
import {
  activeHostRouteBindings,
  hostRouteRefs,
  registerRouteContributions,
} from "@/workspace-host/router";

function route(
  id: string,
  moduleId: string,
  routeRefId: string,
  requiredOperations: string[] = [],
): RouteContribution {
  return {
    kind: "route",
    id,
    moduleId,
    requiredOperations: requiredOperations as never,
    routeRef: createRouteRef(routeRefId),
    loader: async () => ({ default: () => null }),
  };
}

describe("registerRouteContributions", () => {
  it("binds the universal domain product route without allowing arbitrary URLs", () => {
    const binding = activeHostRouteBindings().find(b => b.routeRef.id === hostRouteRefs.domain.home.id);
    expect(binding).toMatchObject({ staticBase: "/workspace/", fragmentPattern: "#/domain", ownerModuleId: "workspace-host" });
    const res = registerRouteContributions({ ownerModuleId: "trusted.domain", contributions: [route("domain.home", "trusted.domain", hostRouteRefs.domain.home.id)], hostBindings: activeHostRouteBindings(), grantedOperations: [] });
    expect(res.ok).toBe(true);
  });
  it("accepts a route pointing at an existing Host binding", () => {
    const res = registerRouteContributions({
      ownerModuleId: "mod",
      contributions: [route("r1", "mod", hostRouteRefs.base.workspaces.id)],
      hostBindings: activeHostRouteBindings(),
      grantedOperations: [],
    });
    expect(res.ok).toBe(true);
    expect(res.accepted).toHaveLength(1);
  });

  it("rejects a route whose RouteRef has no Host binding", () => {
    const res = registerRouteContributions({
      ownerModuleId: "mod",
      contributions: [route("r1", "mod", "host.ghost.route")],
      hostBindings: activeHostRouteBindings(),
      grantedOperations: [],
    });
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]?.code).toBe("route-binding-missing");
  });

  it("rejects a route whose moduleId disagrees with the owner", () => {
    const res = registerRouteContributions({
      ownerModuleId: "mod",
      contributions: [route("r1", "other", hostRouteRefs.base.workspaces.id)],
      hostBindings: activeHostRouteBindings(),
      grantedOperations: [],
    });
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]?.code).toBe("route-owner-mismatch");
  });

  it("rejects when a required operation is not granted", () => {
    const res = registerRouteContributions({
      ownerModuleId: "mod",
      contributions: [
        route("r1", "mod", hostRouteRefs.base.workspaces.id, ["t1.putObject"]),
      ],
      hostBindings: activeHostRouteBindings(),
      grantedOperations: ["t1.listWorkspaces" as never],
    });
    expect(res.ok).toBe(false);
    expect(res.diagnostics[0]?.code).toBe("route-operation-missing");
  });

  it("is atomic — one bad route rejects the whole batch", () => {
    const res = registerRouteContributions({
      ownerModuleId: "mod",
      contributions: [
        route("r1", "mod", hostRouteRefs.base.workspaces.id),
        route("r2", "mod", "host.ghost.route"),
      ],
      hostBindings: activeHostRouteBindings(),
      grantedOperations: [],
    });
    expect(res.ok).toBe(false);
    expect(res.accepted).toHaveLength(0);
  });
});
