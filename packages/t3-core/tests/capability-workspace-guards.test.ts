import { describe, expect, it, vi } from "vitest";
import { preflight, type ModuleDeclaration } from "@/workspace-host/modules";
import { CommandRegistry, HostContributionHub, NavigationRegistry } from "@/workspace-host/registries";
import { RouteRegistry, registerRouteContributions, activeHostRouteBindings, hostRouteRefs } from "@/workspace-host/router";
import { createKernelFacade } from "@/workspace-host/context/create-kernel-facade";
import type { CommandContribution, NavigationContribution, RouteContribution, ViewerContribution } from "@/workspace-contract";
import type { KernelSession } from "@/kernel-client/types";

const CAP_A = "cap.workspace.edit";
const CAP_B = "cap.workspace.export";

function declaration(over: Partial<ModuleDeclaration> = {}): ModuleDeclaration {
  return {
    moduleId: "cap.mod",
    state: "active",
    requiredLevels: [],
    requiredOperations: [],
    dependencies: [],
    ...over,
  };
}

const runtime = (caps: readonly string[] = []) => ({
  contractVersion: "1.2.0",
  grantedLevels: ["T0", "T1", "T2"] as const,
  grantedOperations: ["t1.listWorkspaces", "t1.putObject"] as const,
  activeCapabilities: caps,
});

describe("Workspace capability defense-in-depth", () => {
  it("blocks a module before loader when required capability is inactive", () => {
    const res = preflight({
      declaration: declaration({ requiredCapabilitiesAll: [CAP_A] }),
      runtime: runtime([]),
      loaderIds: new Set(["cap.mod"]),
      dependencyFailed: false,
      dependencyDiagnostics: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe("missing-capability");
      expect(res.diagnostics[0]?.code).toBe("missing-capability");
    }
  });

  it("supports requiredCapabilitiesAny without changing operation grants", () => {
    const denied = preflight({
      declaration: declaration({ requiredCapabilitiesAny: [CAP_A, CAP_B] }),
      runtime: runtime([]),
      loaderIds: new Set(["cap.mod"]),
      dependencyFailed: false,
      dependencyDiagnostics: [],
    });
    expect(denied.ok).toBe(false);
    const allowed = preflight({
      declaration: declaration({ requiredCapabilitiesAny: [CAP_A, CAP_B] }),
      runtime: runtime([CAP_B]),
      loaderIds: new Set(["cap.mod"]),
      dependencyFailed: false,
      dependencyDiagnostics: [],
    });
    expect(allowed.ok).toBe(true);
  });

  it("command guard refuses before loader and rechecks before handler", async () => {
    const registry = new CommandRegistry();
    let loaderCalls = 0;
    let runCalls = 0;
    const contribution: CommandContribution = {
      kind: "command",
      id: "cap.command",
      moduleId: "cap.mod",
      labelKey: "cap.command",
      requiredOperations: [],
      requiredCapabilitiesAll: [CAP_A],
      loader: async () => {
        loaderCalls += 1;
        return { run: () => { runCalls += 1; return "ok"; } };
      },
    };
    expect(registry.registerMany("cap.mod", [{
      contributionId: contribution.id,
      ownerModuleId: contribution.moduleId,
      requiredOperations: [],
      requiredCapabilitiesAll: [CAP_A],
      contribution,
    }]).ok).toBe(true);

    expect(registry.isInvocable("cap.command", [], [])).toBe(false);
    await expect(registry.invoke("cap.command", null, [], () => ({}), [], []))
      .rejects.toMatchObject({ code: "capability-not-granted" });
    expect(loaderCalls).toBe(0);
    expect(runCalls).toBe(0);

    const liveOwnerContext = {
      currentWorkspace: { get: () => ({ workspace_id: "ws-1" }) },
      kernel: { hasCapability: async (_workspaceId: string, capabilityId: string) => capabilityId === CAP_A },
    };
    await expect(registry.invoke("cap.command", null, [], () => liveOwnerContext, [], [CAP_A]))
      .resolves.toBe("ok");
    expect(loaderCalls).toBe(1);
    expect(runCalls).toBe(1);
  });

  it("navigation and routes are hidden/refused when capability is inactive", () => {
    const nav = new NavigationRegistry();
    const navigation: NavigationContribution = {
      kind: "navigation",
      id: "cap.nav",
      moduleId: "cap.mod",
      labelKey: "cap.nav",
      routeRef: hostRouteRefs.base.workspaces,
      placement: "primary",
      order: 1,
      requiredOperations: [],
      requiredCapabilitiesAll: [CAP_A],
    };
    expect(nav.registerMany("cap.mod", [{
      contributionId: navigation.id,
      ownerModuleId: navigation.moduleId,
      requiredOperations: [],
      requiredCapabilitiesAll: [CAP_A],
      contribution: navigation,
    }]).ok).toBe(true);
    expect(nav.visibleEntries([], [])).toHaveLength(0);
    expect(nav.visibleEntries([], [CAP_A])).toHaveLength(1);

    const route: RouteContribution = {
      kind: "route",
      id: "cap.route",
      moduleId: "cap.mod",
      routeRef: hostRouteRefs.base.workspaces,
      requiredOperations: [],
      requiredCapabilitiesAll: [CAP_A],
      loader: async () => ({ default: () => null }),
    };
    const denied = registerRouteContributions({
      ownerModuleId: "cap.mod",
      contributions: [route],
      hostBindings: activeHostRouteBindings(),
      grantedOperations: [],
      activeCapabilities: [],
    });
    expect(denied.ok).toBe(false);
    expect(denied.diagnostics[0]?.code).toBe("route-capability-missing");
    const allowed = registerRouteContributions({
      ownerModuleId: "cap.mod",
      contributions: [route],
      hostBindings: activeHostRouteBindings(),
      grantedOperations: [],
      activeCapabilities: [CAP_A],
    });
    expect(allowed.ok).toBe(true);
  });

  it("refuses non-route contributions when their capability requirement is inactive", () => {
    const routeRegistry = new RouteRegistry();
    routeRegistry.registerMany(activeHostRouteBindings());
    const hub = new HostContributionHub({
      routeRegistry,
      hostRouteBindings: activeHostRouteBindings(),
      grantedOperations: [],
      activeCapabilities: [],
    });
    const viewer: ViewerContribution = {
      kind: "viewer",
      id: "cap.viewer",
      moduleId: "cap.mod",
      requiredOperations: [],
      requiredCapabilitiesAll: [CAP_A],
      profileId: "generic",
      schemaId: "note",
      schemaVersionRange: "1.x",
      surface: "detail",
      loader: async () => ({ default: () => null }),
    };
    const denied = hub.registerModule("cap.mod", { viewers: [viewer] });
    expect(denied.ok).toBe(false);
    expect(denied.diagnostics[0]).toMatchObject({ code: "capability-not-granted", group: "viewers" });
    expect(hub.viewers.has("cap.viewer")).toBe(false);

    const allowedHub = new HostContributionHub({
      routeRegistry,
      hostRouteBindings: activeHostRouteBindings(),
      grantedOperations: [],
      activeCapabilities: [CAP_A],
    });
    const allowed = allowedHub.registerModule("cap.mod", { viewers: [viewer] });
    expect(allowed.ok).toBe(true);
    expect(allowedHub.viewers.has("cap.viewer")).toBe(true);
  });

  it("KernelFacade exposes only the live read-only authorization view", async () => {
    const forWorkspace = vi.fn(async (workspace_id: string) => ({
      decision: "ACTIVE" as const,
      workspace_id,
      audience_service_id: "svc.workspace",
      instance_id: "inst-1",
      lineage_id: "lin-1",
      grant_id: "grant-1",
      effective_capabilities: [CAP_A] as readonly string[],
      valid_until: "2027-08-11T00:00:00Z",
      evaluated_at: "2026-08-11T00:00:00Z",
    }));
    const hasCapability = vi.fn(async (_workspace_id: string, capability_id: string) => capability_id === CAP_A);
    const session = {
      contract_version: "1.2.0",
      runtime_version: "0.3.5",
      service: { service_id: "svc.workspace", service_version: "0.34.0-rc.20", base_path: "/workspace/" },
      mode: "normal",
      granted_levels: [],
      granted_operations: [],
      authorization: { forWorkspace, hasCapability },
      t0: {}, t1: {}, t2: {},
    } as unknown as KernelSession;
    const facade = createKernelFacade({ session });
    await expect(facade.authorizationForWorkspace("ws-1")).resolves.toMatchObject({ decision: "ACTIVE", grant_id: "grant-1" });
    await expect(facade.hasCapability("ws-1", CAP_A)).resolves.toBe(true);
    expect(forWorkspace).toHaveBeenCalledWith("ws-1");
    expect(hasCapability).toHaveBeenCalledWith("ws-1", CAP_A);
    expect("authorization" in (facade as unknown as Record<string, unknown>)).toBe(false);
  });
});
