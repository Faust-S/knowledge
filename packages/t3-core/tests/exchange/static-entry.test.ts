/** §16 — exchange.html multi-entry with base=/workspace/exchange/ is preserved. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Static Exchange entry (§16)", () => {
  it("exchange.html exists at project root with correct base", () => {
    const html = readFileSync(path.resolve("exchange.html"), "utf8");
    expect(html).toContain('base href="/workspace/exchange/"');
    expect(html).toMatch(/src\/main\.tsx/);
  });
  it("vite.config.ts registers exchange.html as a Rollup input", () => {
    const vite = readFileSync(path.resolve("vite.config.ts"), "utf8");
    expect(vite).toMatch(/exchange\.html/);
    expect(vite).toMatch(/rollupOptions/);
  });
});
