import { describe, expect, it } from "vitest";
import {
  purgeCancelHandler,
  purgePreviewHandler,
  restoreWorkspaceHandler,
} from "@/modules/lifecycle/commands";
import { makeCtx, makeKernel } from "./lifecycle-module.test";

describe("lifecycle command receipt authority", () => {
  it("rejects restore receipt for a different workspace", async () => {
    const kernel = makeKernel(undefined, {
      restoreWorkspace: async () => ({ workspace_id: "other", restored_at: "2026-09-21T00:00:00Z" }),
    });
    await expect(
      restoreWorkspaceHandler.run(makeCtx(kernel), { workspaceId: "expected" }),
    ).rejects.toThrow("LIFECYCLE_RECEIPT_IDENTITY_MISMATCH");
  });

  it("rejects purge preview identity drift before it reaches route state", async () => {
    const kernel = makeKernel(undefined, {
      purgePreview: async () => ({
        purge_token: "tok",
        challenge: "PURGE other",
        expires_at: "2026-09-22T00:00:00Z",
        workspace_id: "other",
        workspace_state_timestamp: 1,
        counts: { objects:0,events:0,relations:0,assets:0,permissions:0,service_state:0,outbox:0 },
        last_export: { prepared:null,confirmed:null,backup_status:"current",warning:null },
        acknowledge_no_backup: false,
      }),
    });
    await expect(
      purgePreviewHandler.run(makeCtx(kernel), { workspaceId: "expected" }),
    ).rejects.toThrow("PURGE_PREVIEW_IDENTITY_MISMATCH");
  });

  it("does not report purge cancellation success when Runtime returns false", async () => {
    const kernel = makeKernel(undefined, {
      purgeCancel: async () => false,
    });
    await expect(
      purgeCancelHandler.run(makeCtx(kernel), { purgeToken: "tok" }),
    ).rejects.toThrow("PURGE_CANCEL_NOT_CONFIRMED");
  });
});
