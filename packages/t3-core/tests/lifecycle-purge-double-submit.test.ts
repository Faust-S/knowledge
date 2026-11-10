import { describe, it, expect } from "vitest";
import { INITIAL_PURGE_STATE, purgeReducer, isChallengeAccepted } from "@/modules/lifecycle/state/purge-machine";
import { makePreview, makeReceipt } from "./lifecycle/_helpers";

describe("double preview and double commit are blocked at the reducer level", () => {
  it("commit-started from anywhere but awaiting-challenge is a no-op", () => {
    let s = INITIAL_PURGE_STATE;
    // From idle:
    expect(purgeReducer(s, { type: "commit-started" }).status).toBe("idle");
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: false });
    // From previewing:
    expect(purgeReducer(s, { type: "commit-started" }).status).toBe("previewing");
    s = purgeReducer(s, { type: "preview-succeeded", preview: makePreview("ws-1") });
    // From awaiting-challenge but with wrong input: still blocked.
    s = purgeReducer(s, { type: "challenge-input", value: "wrong" });
    expect(isChallengeAccepted(s)).toBe(false);
    expect(purgeReducer(s, { type: "commit-started" }).status).toBe("awaiting-challenge");
    // Correct input then commit-started transitions once.
    s = purgeReducer(s, { type: "challenge-input", value: "PURGE ws-1" });
    s = purgeReducer(s, { type: "commit-started" });
    expect(s.status).toBe("committing");
    // Second commit-started is a no-op.
    const again = purgeReducer(s, { type: "commit-started" });
    expect(again.status).toBe("committing");
    // commit-succeeded from committed is a no-op.
    s = purgeReducer(s, { type: "commit-succeeded", receipt: makeReceipt("ws-1") });
    const dupCommit = purgeReducer(s, {
      type: "commit-succeeded",
      receipt: makeReceipt("ws-1"),
    });
    expect(dupCommit).toBe(s);
  });
});
