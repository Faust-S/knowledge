import { describe, it, expect } from "vitest";
import { INITIAL_PURGE_STATE, isChallengeAccepted, purgeReducer } from "@/modules/lifecycle/state/purge-machine";
import { makePreview } from "./lifecycle/_helpers";

const CH = "PURGE ws-abc";

function seed() {
  let s = INITIAL_PURGE_STATE;
  s = purgeReducer(s, { type: "preview-started", workspaceId: "ws-abc", acknowledgeNoBackup: false });
  s = purgeReducer(s, {
    type: "preview-succeeded",
    preview: makePreview("ws-abc", { challenge: CH }),
  });
  return s;
}

describe("challenge is compared EXACTLY", () => {
  it("workspace id alone is rejected", () => {
    let s = seed();
    s = purgeReducer(s, { type: "challenge-input", value: "ws-abc" });
    expect(isChallengeAccepted(s)).toBe(false);
  });
  it("workspace title/label is not an acceptable alternative", () => {
    let s = seed();
    s = purgeReducer(s, { type: "challenge-input", value: "My Workspace" });
    expect(isChallengeAccepted(s)).toBe(false);
  });
  it("trimmed challenge is rejected (leading/trailing whitespace matters)", () => {
    let s = seed();
    s = purgeReducer(s, { type: "challenge-input", value: ` ${CH} ` });
    expect(isChallengeAccepted(s)).toBe(false);
  });
  it("case-folded challenge is rejected", () => {
    let s = seed();
    s = purgeReducer(s, { type: "challenge-input", value: CH.toLowerCase() });
    expect(isChallengeAccepted(s)).toBe(false);
  });
  it("exact match is accepted", () => {
    let s = seed();
    s = purgeReducer(s, { type: "challenge-input", value: CH });
    expect(isChallengeAccepted(s)).toBe(true);
  });
});
