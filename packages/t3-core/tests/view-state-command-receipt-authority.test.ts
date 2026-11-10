import { describe, expect, it } from "vitest";
import type { WorkspaceModuleContext } from "@/workspace-contract";
import {
  deleteWorkspaceView,
  saveWorkspaceView,
} from "@/modules/view-state/commands";

function context(overrides: {
  putObject?: WorkspaceModuleContext["kernel"]["putObject"];
  deleteObject?: WorkspaceModuleContext["kernel"]["deleteObject"];
}): WorkspaceModuleContext {
  const noop = async () => { throw new Error("unused"); };
  return {
    kernel: {
      hasOperation: () => true,
      grantedOperations: [],
      grantedLevels: [],
      sessionInfo: {
        mode: "full", contract_version: "1.2.0", runtime_version: "0.3.5", service_id: "svc",
      },
      listWorkspaces: noop as never,
      getWorkspace: noop as never,
      createWorkspace: noop as never,
      listObjects: noop as never,
      getObject: noop as never,
      listEventsSince: noop as never,
      putObject: overrides.putObject ?? (noop as never),
      deleteObject: overrides.deleteObject ?? (noop as never),
      softDeleteWorkspace: noop as never,
      restoreWorkspace: noop as never,
      purgePreview: noop as never,
      purgeCommit: noop as never,
      purgeCancel: noop as never,
      exportPreview: noop as never,
      exportPackage: noop as never,
      confirmExport: noop as never,
      importPreview: noop as never,
      importCommit: noop as never,
      importCancel: noop as never,
      authorizationForWorkspace: noop as never,
      hasCapability: noop as never,
    },
    router: { navigate: () => {}, current: () => null },
    commands: { has: () => false, invoke: async () => undefined },
    views: { resolve: () => false },
    panels: { open: () => {}, close: () => {} },
    dashboard: { refresh: () => {} },
    terminology: { term: (_key, fallback) => fallback ?? "" },
    diagnostics: { report: () => {} },
    currentWorkspace: { get: () => null, subscribe: () => () => {}, claim: () => {}, release: () => {} },
    profile: { id: "generic", definition: { id: "generic", label: "Generic", description: "", accent: "#000" }, fallback: false },
  };
}

const saveArgs = {
  workspaceId: "w",
  viewId: "v1",
  name: "View",
  profileId: "generic",
  logicalAreaId: null,
  query: "",
  baseRevision: 2,
};

describe("view-state command receipt authority", () => {
  it("accepts only the expected save object identity/schema/revision", async () => {
    const ctx = context({
      putObject: async (input) => ({
        object: {
          workspace_id: "w",
          object_id: "saved-view:v1",
          schema_id: "iwxa.workspace.internal.saved-view",
          schema_version: "1.0.0",
          created_by_service: "svc",
          updated_by_service: "svc",
          created_at: "2026-09-21T00:00:00Z",
          updated_at: "2026-09-21T00:00:00Z",
          revision: 3,
          data: input.data,
          extensions: { owner_module: "iwxa.workspace.view-state" },
        },
        event: {} as never,
        deduplicated: false,
      }),
    });
    await expect(saveWorkspaceView(ctx, saveArgs)).resolves.toMatchObject({
      object: { workspace_id: "w", object_id: "saved-view:v1", revision: 3 },
    });
  });

  it("fails closed when save receipt points to another object or revision", async () => {
    const ctx = context({
      putObject: async (input) => ({
        object: {
          workspace_id: "w",
          object_id: "saved-view:other",
          schema_id: "iwxa.workspace.internal.saved-view",
          schema_version: "1.0.0",
          created_by_service: "svc",
          updated_by_service: "svc",
          created_at: "2026-09-21T00:00:00Z",
          updated_at: "2026-09-21T00:00:00Z",
          revision: 9,
          data: input.data,
          extensions: {},
        },
        event: {} as never,
        deduplicated: false,
      }),
    });
    await expect(saveWorkspaceView(ctx, saveArgs))
      .rejects.toThrow(/VIEW_STATE_COMMIT_RECEIPT_(IDENTITY|REVISION)_MISMATCH/);
  });

  it("fails closed when delete receipt does not confirm the expected revision", async () => {
    const ctx = context({
      deleteObject: async () => ({
        object: {
          workspace_id: "w",
          object_id: "saved-view:v1",
          revision: 2,
        } as never,
        event: {} as never,
        deduplicated: false,
      }),
    });
    await expect(deleteWorkspaceView(ctx, {
      workspaceId: "w", viewId: "v1", baseRevision: 2,
    })).rejects.toThrow("VIEW_STATE_COMMIT_RECEIPT_REVISION_MISMATCH");
  });
});
