import { describe, expect, it, vi } from "vitest";
import { PanelRegistry, DashboardRegistry } from "@/workspace-host/registries";
import { createPanelsFacade } from "@/workspace-host/context/create-panels-facade";
import { createDashboardFacade } from "@/workspace-host/context/create-dashboard-facade";

describe("Host facade contribution gates", () => {
  it("does not open a panel whose operation or capability requirement is unavailable", () => {
    const registry = new PanelRegistry();
    registry.registerMany("m", [{
      contributionId: "panel",
      ownerModuleId: "m",
      requiredOperations: ["t1.getObject"],
      requiredCapabilitiesAll: ["cap.panel"],
      contribution: {
        kind: "panel", id: "panel", moduleId: "m",
        requiredOperations: ["t1.getObject"],
        requiredCapabilitiesAll: ["cap.panel"],
        slot: "sidebar",
        loader: async () => ({ default: () => null }),
      },
    }]);
    const request = vi.fn();
    createPanelsFacade({ registry, state: { request }, grantedOperations: [], activeCapabilities: [] }).open("panel");
    expect(request).not.toHaveBeenCalled();
    createPanelsFacade({
      registry, state: { request },
      grantedOperations: ["t1.getObject"], activeCapabilities: ["cap.panel"],
    }).open("panel");
    expect(request).toHaveBeenCalledWith("panel", "open");
  });

  it("does not refresh a dashboard card whose gates are unavailable", () => {
    const registry = new DashboardRegistry();
    registry.registerMany("m", [{
      contributionId: "card",
      ownerModuleId: "m",
      requiredOperations: ["t1.listObjects"],
      requiredCapabilitiesAny: ["cap.a", "cap.b"],
      contribution: {
        kind: "dashboard_card", id: "card", moduleId: "m",
        requiredOperations: ["t1.listObjects"],
        requiredCapabilitiesAny: ["cap.a", "cap.b"],
        size: "small",
        loader: async () => ({ default: () => null }),
      },
    }]);
    const refresh = vi.fn();
    createDashboardFacade({ registry, state: { refresh }, grantedOperations: [], activeCapabilities: [] }).refresh("card");
    expect(refresh).not.toHaveBeenCalled();
    createDashboardFacade({
      registry, state: { refresh },
      grantedOperations: ["t1.listObjects"], activeCapabilities: ["cap.b"],
    }).refresh("card");
    expect(refresh).toHaveBeenCalledWith("card");
  });
});
