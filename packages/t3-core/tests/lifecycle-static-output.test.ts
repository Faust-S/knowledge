import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("static entry HTML exists for all three bases", () => {
  it.each(["index.html", "exchange.html", "lifecycle.html"])(
    "%s exists and mounts /src/main.tsx",
    (file) => {
      const html = readFileSync(resolve(process.cwd(), file), "utf-8");
      expect(html).toContain('<div id="root">');
      expect(html).toMatch(/src=["']\/src\/main\.tsx["']/);
    },
  );

  it("lifecycle.html sets /workspace/lifecycle/ base", () => {
    const html = readFileSync(resolve(process.cwd(), "lifecycle.html"), "utf-8");
    expect(html).toContain('href="/workspace/lifecycle/"');
  });
});
