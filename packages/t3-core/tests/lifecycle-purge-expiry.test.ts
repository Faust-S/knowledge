import { describe, it, expect } from "vitest";
import {
  INITIAL_PURGE_STATE,
  isPreviewExpired,
  purgeReducer,
} from "@/modules/lifecycle/state/purge-machine";
import { makePreview } from "./lifecycle/_helpers";

describe("expired preview blocks commit", () => {
  it("isPreviewExpired detects past expires_at", () => {
    const past = makePreview("ws-1", { expiresInMs: -10_000 });
    expect(isPreviewExpired(past)).toBe(true);
  });
  it("expire action clears preview and challenge input", () => {
    let s = INITIAL_PURGE_STATE;
    s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-1", acknowledgeNoBackup: false });
    s = purgeReducer(s, { type: "preview-succeeded", preview: makePreview("ws-1") });
    s = purgeReducer(s, { type: "challenge-input", value: "PURGE ws-1" });
    s = purgeReducer(s, { type: "expire" });
    expect(s.status).toBe("expired");
    expect(s.preview).toBeNull();
    expect(s.challengeInput).toBe("");
  });
});
