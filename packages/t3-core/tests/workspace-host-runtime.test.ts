/**
 * tests/workspace-host-runtime.test.ts — PROMPT 19 §4-§6, §9.
 *
 * Exercises the WorkspaceHostRuntime factory end-to-end against a
 * minimal fake session and workspace config:
 *   - starts, activates the base module, exposes base routes as active;
 *   - dispose() rolls everything back cleanly;
 *   - starting a second runtime after dispose is possible.
 */

import { describe, expect, it } from "vitest";
import type { KernelSession } from "@/kernel-client/types";
import { createWorkspaceHostRuntime } from "@/workspace-host/runtime";
import { hostRouteRefs } from "@/workspace-host/router";

function fakeSession(): KernelSession {
  return {
    contract_version: "1.3.0",
    runtime_version: "0.3.6",
    granted_levels: ["T0", "T1", "T2"],
    granted_operations: [
      "t0.validate",
      "t1.listWorkspaces",
      "t1.getWorkspace",
      "t1.createWorkspace",
      "t1.listObjects",
      "t1.getObject",
      "t1.putObject",
      "t1.deleteObject",
      "t1.listEventsSince",
      "t1.purgeStart",
      "t1.purgeCancel",
      "t2.exportPreview",
      "t2.exportSnapshot",
      "t2.importPreview",
      "t2.importCommit",
    ],
  } as unknown as KernelSession;
}

const baseWorkspaceConfig = {
  modules: [
    { module_id: "iwxa.workspace.base", state: "active" as const, dependencies: [] },
  ],
};

describe("WorkspaceHostRuntime (PROMPT 19)", () => {
  it("boots and activates the base module + its routes", async () => {
    const runtime = await createWorkspaceHostRuntime({
      session: fakeSession(),
      workspaceConfig: baseWorkspaceConfig,
      termResolver: (k, f) => f ?? k,
    });
    try {
      const activated = runtime.moduleSnapshot.filter(
        (m) => m.status === "activated",
      );
      expect(activated.map((m) => m.moduleId)).toContain("iwxa.workspace.base");
      const active = runtime.router.registry.listActive();
      expect(active.length).toBeGreaterThan(0);
      // At least one of the base refs must be active.
      const activeIds = new Set(active.map((b) => b.routeRef.id));
      expect(activeIds.has(hostRouteRefs.base.home.id)).toBe(true);
    } finally {
      await runtime.dispose();
    }
  });

  it("dispose() deactivates all routes and empties active list", async () => {
    const runtime = await createWorkspaceHostRuntime({
      session: fakeSession(),
      workspaceConfig: baseWorkspaceConfig,
      termResolver: (k) => k,
    });
    await runtime.dispose();
    expect(runtime.router.registry.listActive()).toHaveLength(0);
  });

  it("can start again after dispose (session change simulation)", async () => {
    const r1 = await createWorkspaceHostRuntime({
      session: fakeSession(),
      workspaceConfig: baseWorkspaceConfig,
      termResolver: (k) => k,
    });
    await r1.dispose();
    const r2 = await createWorkspaceHostRuntime({
      session: fakeSession(),
      workspaceConfig: baseWorkspaceConfig,
      termResolver: (k) => k,
    });
    try {
      expect(r2.router.registry.listActive().length).toBeGreaterThan(0);
    } finally {
      await r2.dispose();
    }
  });

  it("opens original Exchange for native Publisher first licence, without workspace/data grants",async()=>{
    const session={
      ...fakeSession(),granted_operations:[],
    } as unknown as KernelSession;
    const config={modules:[
      {module_id:"iwxa.workspace.base",state:"active" as const,dependencies:[]},
      {module_id:"iwxa.workspace.exchange",state:"active" as const,
        dependencies:["iwxa.workspace.base"]},
    ]};
    // No native owner: original Exchange route must remain inactive when
    // all T2 data transfer operations are ungranted.
    const ordinary=await createWorkspaceHostRuntime({
      session,workspaceConfig:config,termResolver:k=>k,
    });
    try {
      expect(ordinary.publisherHandoff).toBeNull();
      expect(ordinary.router.registry.isActive(hostRouteRefs.exchange.home)).toBe(false);
    }finally {await ordinary.dispose();}
    const holder={
      currentSubject:async()=>({holderId:"holder:person",
        recipientId:"recipient:installed",subjectType:"PERSON" as const,
        bindingEpoch:"epoch:installed"}),
      inspect:async()=>null,apply:async()=>null,receipt:async()=>null,
      statusReadback:async()=>null,
    };
    const native=await createWorkspaceHostRuntime({
      session,workspaceConfig:config,termResolver:k=>k,
      publisherHolder:holder,confirmPublisherHandoff:async()=>true,
      // No signedKernelAccess and NO selected Workspace here.
    });
    try {
      expect(native.currentWorkspaceStore.get()).toBeNull();
      expect(native.publisherHandoff).not.toBeNull();
      expect(native.grantedOperations).toEqual([]);
      expect(native.router.registry.isActive(hostRouteRefs.exchange.home)).toBe(true);
      expect(native.hub.getRouteContribution(hostRouteRefs.exchange.home.id)?.moduleId)
        .toBe("iwxa.workspace.exchange");
    }finally {await native.dispose();}
    expect(native.router.registry.isActive(hostRouteRefs.exchange.home)).toBe(false);
  });
});
