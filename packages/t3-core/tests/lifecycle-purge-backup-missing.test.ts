import { describe, it, expect } from "vitest";
import { INITIAL_PURGE_STATE, purgeReducer, isChallengeAccepted } from "@/modules/lifecycle/state/purge-machine";
import { makePreview } from "./lifecycle/_helpers";

describe("purge backup=missing requires explicit acknowledgement", () => {
  it("first preview with missing backup blocks at awaiting-no-backup-ack", () => {
    let s = INITIAL_PURGE_STATE;
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: false });
    s = purgeReducer(s, {
      type: "preview-succeeded",
      preview: makePreview("ws-1", { backup: "missing", acknowledged: false }),
    });
    expect(s.status).toBe("awaiting-no-backup-ack");
    expect(isChallengeAccepted(s)).toBe(false);
    // Cannot commit from this state.
    const attempt = purgeReducer(s, { type: "commit-started" });
    expect(attempt.status).toBe("awaiting-no-backup-ack");
  });

  it("ack-no-backup clears prior preview so no commit can leak against it", () => {
    let s = INITIAL_PURGE_STATE;
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: false });
    s = purgeReducer(s, {
      type: "preview-succeeded",
      preview: makePreview("ws-1", { backup: "missing", acknowledged: false }),
    });
    s = purgeReducer(s, { type: "ack-no-backup" });
    expect(s.status).toBe("previewing");
    expect(s.preview).toBeNull();
    expect(s.noBackupAcknowledged).toBe(true);
  });
});
