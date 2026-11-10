/**
 * PROMPT 35 §2, §3 — Runtime errors are classified by canonical
 * UPPER_SNAKE `code`, never by error text. Legacy /stale|state[-_ ]changed/
 * heuristics are gone.
 */
import { describe, it, expect } from "vitest";
import { classifyPurgeError } from "@/modules/lifecycle/routes/LifecycleTrashRoute";
import { CommandInvocationError } from "@/workspace-host/registries/CommandRegistry";

describe("classifyPurgeError (PROMPT 35 §2)", () => {
  it("PURGE_EXPIRED / PURGE_TOKEN_INVALID / PURGE_TOKEN_USED ⇒ expired", () => {
    for (const code of ["PURGE_EXPIRED", "PURGE_TOKEN_INVALID", "PURGE_TOKEN_USED"]) {
      expect(classifyPurgeError({ code })).toBe("expired");
    }
  });

  it("PURGE_STATE_CHANGED ⇒ stale", () => {
    expect(classifyPurgeError({ code: "PURGE_STATE_CHANGED" })).toBe("stale");
  });

  it("LOCK_UNAVAILABLE / WEB_LOCKS_UNAVAILABLE ⇒ lock", () => {
    expect(classifyPurgeError({ code: "LOCK_UNAVAILABLE" })).toBe("lock");
    expect(classifyPurgeError({ code: "WEB_LOCKS_UNAVAILABLE" })).toBe("lock");
  });

  it("PURGE_CHALLENGE_MISMATCH ⇒ challenge", () => {
    expect(classifyPurgeError({ code: "PURGE_CHALLENGE_MISMATCH" })).toBe("challenge");
  });

  it("does NOT match legacy free-text error messages", () => {
    expect(classifyPurgeError(new Error("workspace state changed"))).toBe("unknown");
    expect(classifyPurgeError(new Error("token stale"))).toBe("unknown");
    expect(classifyPurgeError(new Error("stale preview"))).toBe("unknown");
    expect(classifyPurgeError("PURGE_STATE_CHANGED")).toBe("unknown"); // string, not { code }
  });

  it("does NOT recognise legacy lowercase codes", () => {
    for (const code of [
      "purge_expired",
      "purge_state_changed",
      "purge_challenge_mismatch",
      "lock_unavailable",
    ]) {
      expect(classifyPurgeError({ code })).toBe("unknown");
    }
  });

  it("falls back to unknown for missing / non-object errors", () => {
    expect(classifyPurgeError(null)).toBe("unknown");
    expect(classifyPurgeError(undefined)).toBe("unknown");
    expect(classifyPurgeError({})).toBe("unknown");
    expect(classifyPurgeError(42)).toBe("unknown");
  });

  it("classifies canonical Kernel codes inside a genuine CommandRegistry handler-threw wrapper", () => {
    const codes = [
      ["PURGE_EXPIRED", "expired"],
      ["PURGE_TOKEN_INVALID", "expired"],
      ["PURGE_TOKEN_USED", "expired"],
      ["PURGE_STATE_CHANGED", "stale"],
      ["LOCK_UNAVAILABLE", "lock"],
      ["WEB_LOCKS_UNAVAILABLE", "lock"],
      ["PURGE_CHALLENGE_MISMATCH", "challenge"],
    ] as const;
    for (const [code, expected] of codes) {
      const wrapped = new CommandInvocationError(
        "handler-threw",
        "lifecycle.purge-commit",
        "handler threw",
        { code, message: "untrusted Kernel error text" },
      );
      expect(classifyPurgeError(wrapped)).toBe(expected);
    }
  });

  it("does not mistake arbitrary wrapper causes or free text for a canonical code", () => {
    expect(classifyPurgeError(new CommandInvocationError(
      "operation-not-granted",
      "lifecycle.purge-commit",
      "not granted",
      { code: "PURGE_EXPIRED" },
    ))).toBe("unknown");
    expect(classifyPurgeError(new CommandInvocationError(
      "handler-threw",
      "lifecycle.purge-commit",
      "PURGE_EXPIRED",
      new Error("PURGE_EXPIRED"),
    ))).toBe("unknown");
    expect(classifyPurgeError({ code: "handler-threw", cause: { code: "purge_expired" } })).toBe("unknown");
  });
});
