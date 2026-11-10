import { describe, it, expect } from "vitest";
import { isSafeShellAssetPath } from "../src/workspace-host/shell/safe-shell-path";
import { classifyThemeSource } from "../src/workspace-host/shell/theme-loader";

describe("safe-shell-path (PROMPT 14 §2)", () => {
  it("accepts absolute same-origin paths", () => {
    expect(isSafeShellAssetPath("/favicon.ico")).toBe(true);
    expect(isSafeShellAssetPath("/_iwxa/brand/logo.svg")).toBe(true);
    expect(isSafeShellAssetPath("/a/b/c.css")).toBe(true);
  });

  it("rejects non-strings and empty", () => {
    expect(isSafeShellAssetPath(undefined)).toBe(false);
    expect(isSafeShellAssetPath(null)).toBe(false);
    expect(isSafeShellAssetPath(42 as unknown)).toBe(false);
    expect(isSafeShellAssetPath("")).toBe(false);
  });

  it("rejects schemes", () => {
    for (const p of [
      "http://x/y",
      "https://x/y",
      "data:image/png;base64,AAA",
      "javascript:alert(1)",
      "blob:https://a.example/",
      "file:///etc/passwd",
    ]) {
      expect(isSafeShellAssetPath(p)).toBe(false);
    }
  });

  it("rejects protocol-relative, traversal, backslash, whitespace, control chars", () => {
    expect(isSafeShellAssetPath("//evil.example/x")).toBe(false);
    expect(isSafeShellAssetPath("/a/../b")).toBe(false);
    expect(isSafeShellAssetPath("/a/%2e%2e/b")).toBe(false);
    expect(isSafeShellAssetPath("/a/%2E%2E/b")).toBe(false);
    expect(isSafeShellAssetPath("/a%2fb")).toBe(false);
    expect(isSafeShellAssetPath("/a%5cb")).toBe(false);
    expect(isSafeShellAssetPath("/a\\b")).toBe(false);
    expect(isSafeShellAssetPath("/a b")).toBe(false);
    expect(isSafeShellAssetPath("/a\tb")).toBe(false);
    expect(isSafeShellAssetPath("/a\nb")).toBe(false);
    expect(isSafeShellAssetPath("/a\u0001b")).toBe(false);
  });

  it("rejects paths that don't start with /", () => {
    expect(isSafeShellAssetPath("relative/x")).toBe(false);
    expect(isSafeShellAssetPath("./x")).toBe(false);
  });

  it("classifyThemeSource surfaces theme-path-invalid for unsafe tokens_path", () => {
    const r = classifyThemeSource({ theme_id: "t", tokens_path: "http://x/t.css" });
    expect(r.source).toBeNull();
    expect(r.diagnostic).toBe("theme-path-invalid");
  });
});
