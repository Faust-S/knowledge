import { describe, it, expect } from "vitest";
import { INITIAL_PURGE_STATE, purgeReducer } from "@/modules/lifecycle/state/purge-machine";
import { makePreview } from "./lifecycle/_helpers";

describe("stale-detected collapses the flow safely", () => {
  it("stale-detected clears preview and enters stale", () => {
    let s = INITIAL_PURGE_STATE;
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: false });
    s = purgeReducer(s, { type: "preview-succeeded", preview: makePreview("ws-1") });
    s = purgeReducer(s, { type: "challenge-input", value: "PURGE ws-1" });
    s = purgeReducer(s, { type: "stale-detected" });
    expect(s.status).toBe("stale");
    expect(s.preview).toBeNull();
    expect(s.challengeInput).toBe("");
    // Cannot commit from stale.
    const attempt = purgeReducer(s, { type: "commit-started" });
    expect(attempt.status).toBe("stale");
  });
});
