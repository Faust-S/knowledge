import { describe, it, expect } from "vitest";
import { INITIAL_PURGE_STATE, purgeReducer } from "@/modules/lifecycle/state/purge-machine";
import { makePreview } from "./lifecycle/_helpers";

describe("purge backup=current → advances directly to awaiting-challenge", () => {
  it("no missing-backup gate when backup is current", () => {
    let s = INITIAL_PURGE_STATE;
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: false });
    s = purgeReducer(s, {
      type: "preview-succeeded",
      preview: makePreview("ws-1", { backup: "current" }),
    });
    expect(s.status).toBe("awaiting-challenge");
  });
});
