/** §7 — confirm-failed preserves the artifact so the user may retry. */
import { describe, expect, it } from "vitest";
import {
  INITIAL_EXPORT_STATE, exportReducer,
} from "@/modules/exchange/features/state/export-machine";
import type { PackageArtifact, ExportPreview } from "@/kernel-client/contracts/v1";
import type { WorkspaceRecord } from "@/kernel-client";

const ws = (id: string) => ({ workspace_id: id, profile: "generic", deleted_at: null } as unknown as WorkspaceRecord);
const preview = {
  workspaces: ["a"],
  counts: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
  approx_bytes: 0,
  summary: {
    included: { workspaces: 1, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    excluded_by_permission: { workspaces: 0, objects: 0, events: 0, relations: 0, assets: 0, schemas: 0 },
    scope_mode: "workspace" as const,
  },
  unsupported: [], conflicts: [],
} as unknown as ExportPreview;
const artifact = { filename: "a.iwxa", bytes: new Uint8Array(), size: 0,
  package_digest: "d", semantic_digest: "sd",
  manifest: { workspaces: ["a"] } } as unknown as PackageArtifact;

describe("Confirm resilience (§7)", () => {
  it("rejects a confirm receipt that duplicates one workspace id and omits another", () => {
    const catalog = [ws("a"), ws("b")];
    const multiPreview = { ...preview, workspaces: ["a", "b"] } as unknown as ExportPreview;
    const multiArtifact = {
      ...artifact,
      manifest: { workspaces: ["a", "b"] },
    } as unknown as PackageArtifact;
    let s = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
    s = exportReducer(s,
      { type: "workspaces-loaded", catalog, initialWorkspaces: ["a", "b"] });
    s = exportReducer(s, { type: "preview-started" });
    s = exportReducer(s, { type: "preview-succeeded", preview: multiPreview });
    s = exportReducer(s, { type: "package-started" });
    s = exportReducer(s, { type: "package-succeeded", artifact: multiArtifact });
    s = exportReducer(s, { type: "download-initiated" });
    s = exportReducer(s, { type: "confirm-started" });
    s = exportReducer(s, {
      type: "confirm-succeeded",
      receipt: {
        package_digest: "d",
        workspace_ids: ["a", "a"],
        confirmed_at: new Date().toISOString(),
        confirmations: 1,
      } as any,
    });
    expect(s.status).toBe("download-initiated");
    expect(s.receipt).toBeNull();
    expect(s.error).toBe("EXPORT_CONFIRM_RECEIPT_IDENTITY_MISMATCH");
  });

  it("confirm-failed keeps artifact and returns to download-initiated", () => {
    let s = exportReducer(INITIAL_EXPORT_STATE, { type: "load-workspaces" });
    s = exportReducer(s,
      { type: "workspaces-loaded", catalog: [ws("a")], initialWorkspaces: ["a"] });
    s = exportReducer(s, { type: "preview-started" });
    s = exportReducer(s, { type: "preview-succeeded", preview });
    s = exportReducer(s, { type: "package-started" });
    s = exportReducer(s, { type: "package-succeeded", artifact });
    s = exportReducer(s, { type: "download-initiated" });
    s = exportReducer(s, { type: "confirm-started" });
    s = exportReducer(s, { type: "confirm-failed", error: "network" });
    expect(s.status).toBe("download-initiated");
    expect(s.artifact).toBe(artifact);
    expect(s.error).toBe("network");
  });
});
