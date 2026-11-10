/** PROMPT 34 §2, §6 — classifyImportError maps canonical UPPER_SNAKE codes only. */
import { describe, expect, it } from "vitest";
import { classifyImportError } from "@/modules/exchange/features/packages/ImportView";

describe("classifyImportError (PROMPT 34 §2)", () => {
  it("maps PREVIEW_EXPIRED to expired", () => {
    expect(classifyImportError({ code: "PREVIEW_EXPIRED" })).toBe("expired");
  });

  it("maps PREVIEW_TOKEN_USED to consumed (flow goes to expired via runCommit)", () => {
    expect(classifyImportError({ code: "PREVIEW_TOKEN_USED" })).toBe("consumed");
  });

  it("maps PLAN_NOT_IN_PREVIEW to stale (requires a new preview)", () => {
    expect(classifyImportError({ code: "PLAN_NOT_IN_PREVIEW" })).toBe("stale");
  });

  it("maps PREVIEW_TOKEN_INVALID / SERVICE_MISMATCH / ORIGIN_MISMATCH / REQUIRED to invalid", () => {
    for (const code of [
      "PREVIEW_TOKEN_INVALID",
      "PREVIEW_SERVICE_MISMATCH",
      "PREVIEW_ORIGIN_MISMATCH",
      "PREVIEW_REQUIRED",
    ]) {
      expect(classifyImportError({ code })).toBe("invalid");
    }
  });

  it("maps LOCK_UNAVAILABLE / WEB_LOCKS_UNAVAILABLE to lock", () => {
    expect(classifyImportError({ code: "LOCK_UNAVAILABLE" })).toBe("lock");
    expect(classifyImportError({ code: "WEB_LOCKS_UNAVAILABLE" })).toBe("lock");
  });

  it("maps PACKAGE_DIGEST_MISMATCH to digest", () => {
    expect(classifyImportError({ code: "PACKAGE_DIGEST_MISMATCH" })).toBe("digest");
  });

  it("does NOT recognise legacy lowercase codes", () => {
    for (const code of [
      "preview_token_expired",
      "preview_token_invalid",
      "preview_token_consumed",
      "lock_conflict",
      "workspace_state_changed",
      "package_digest_mismatch",
    ]) {
      expect(classifyImportError({ code })).toBe("unknown");
    }
  });

  it("falls back to unknown for missing / non-string codes", () => {
    expect(classifyImportError(null)).toBe("unknown");
    expect(classifyImportError(new Error("boom"))).toBe("unknown");
    expect(classifyImportError({})).toBe("unknown");
  });
});
