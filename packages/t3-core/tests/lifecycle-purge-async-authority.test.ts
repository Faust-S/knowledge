import { describe, expect, it } from "vitest";
import {
  INITIAL_PURGE_STATE,
  isPreviewExpired,
  purgeReducer,
} from "@/modules/lifecycle/state/purge-machine";
import { makePreview, makeReceipt } from "./lifecycle/_helpers";

describe("purge async and identity authority", () => {
  it("rejects a preview for a different workspace", () => {
    let state = purgeReducer(INITIAL_PURGE_STATE, {
      type: "preview-started", workspaceId: "a", acknowledgeNoBackup: false,
    });
    state = purgeReducer(state, { type: "preview-succeeded", preview: makePreview("b") });
    expect(state.status).toBe("error");
    expect(state.preview).toBeNull();
    expect(state.error).toBe("PURGE_PREVIEW_IDENTITY_INVALID");
  });

  it("treats malformed preview expiry as unusable", () => {
    expect(isPreviewExpired({ ...makePreview("a"), expires_at: "not-a-date" })).toBe(true);
  });

  it("ignores late preview failure after a newer state replaced previewing", () => {
    let state = purgeReducer(INITIAL_PURGE_STATE, {
      type: "preview-started", workspaceId: "a", acknowledgeNoBackup: false,
    });
    state = purgeReducer(state, { type: "reset" });
    state = purgeReducer(state, { type: "preview-failed", error: "late" });
    expect(state.status).toBe("idle");
  });

  it("rejects a purge receipt for a different workspace", () => {
    let state = purgeReducer(INITIAL_PURGE_STATE, {
      type: "preview-started", workspaceId: "a", acknowledgeNoBackup: false,
    });
    state = purgeReducer(state, { type: "preview-succeeded", preview: makePreview("a") });
    state = purgeReducer(state, { type: "challenge-input", value: "PURGE a" });
    state = purgeReducer(state, { type: "commit-started" });
    state = purgeReducer(state, { type: "commit-succeeded", receipt: makeReceipt("b") });
    expect(state.status).toBe("error");
    expect(state.receipt).toBeNull();
    expect(state.error).toBe("PURGE_RECEIPT_IDENTITY_MISMATCH");
  });

  it("does not let a late cancel completion erase a newer preview", () => {
    let state = purgeReducer(INITIAL_PURGE_STATE, {
      type: "preview-started", workspaceId: "a", acknowledgeNoBackup: false,
    });
    state = purgeReducer(state, { type: "preview-succeeded", preview: makePreview("a") });
    state = purgeReducer(state, {
      type: "preview-started", workspaceId: "b", acknowledgeNoBackup: false,
    });
    state = purgeReducer(state, { type: "cancel-succeeded" });
    expect(state.status).toBe("previewing");
    expect(state.workspaceId).toBe("b");
  });
});
