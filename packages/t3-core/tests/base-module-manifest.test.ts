/**
 * PROMPT 18 §13 — base module manifest validation.
 */
import { describe, it, expect } from "vitest";
import { validateWorkspaceModuleManifest } from "@/workspace-contract";
import baseModule, { MODULE_ID, BASE_ROUTE_INVENTORY, BASE_NAVIGATION_INVENTORY } from "@/modules/base";
import manifestJson from "@/modules/base/manifest.json";

describe("iwxa.workspace.base — manifest", () => {
  it("has the canonical module id", () => {
    expect(MODULE_ID).toBe("iwxa.workspace.base");
    expect(baseModule.manifest.module_id).toBe("iwxa.workspace.base");
  });

  it("passes strict manifest validation", () => {
    const res = validateWorkspaceModuleManifest(manifestJson);
    expect(res.ok).toBe(true);
    expect(res.errors ?? []).toEqual([]);
  });

  it("pins the expected Workspace + Runtime contract versions", () => {
    expect(manifestJson.compatibility.workspace_contract).toBe("0.1.0");
    expect(manifestJson.compatibility.runtime_contract).toBe("1.3.0");
  });

  it("declares the exact 6-route / 4-nav inventory (packages moved to iwxa.workspace.exchange in PROMPT 21)", () => {
    expect(BASE_ROUTE_INVENTORY.map((r) => r.id).sort()).toEqual([
      "base.activity",
      "base.diagnostics",
      "base.home",
      "base.object",
      "base.workspace",
      "base.workspaces",
    ]);
    expect(BASE_NAVIGATION_INVENTORY.map((n) => n.id).sort()).toEqual([
      "base.nav.activity",
      "base.nav.diagnostics",
      "base.nav.home",
      "base.nav.workspaces",
    ]);
    expect(manifestJson.contributions.dashboard_cards).toEqual([]);
  });

  it("declares no dangerous security capabilities", () => {
    expect(manifestJson.security).toEqual({
      direct_indexeddb: false,
      remote_code: false,
      iwxa_executable_payload: false,
    });
  });
});
