import { describe, it, expect } from "vitest";
import { INITIAL_PURGE_STATE, purgeReducer } from "@/modules/lifecycle/state/purge-machine";
import { makePreview } from "./lifecycle/_helpers";

describe("second preview after acknowledgement uses acknowledge_no_backup=true", () => {
  it("preview with acknowledge_no_backup=true → awaiting-challenge", () => {
    let s = INITIAL_PURGE_STATE;
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: true });
    s = purgeReducer(s, {
      type: "preview-succeeded",
      preview: makePreview("ws-1", { backup: "missing", acknowledged: true }),
    });
    expect(s.status).toBe("awaiting-challenge");
  });
});
