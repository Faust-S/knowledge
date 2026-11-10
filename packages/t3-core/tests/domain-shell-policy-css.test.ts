import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
const accessibility = readFileSync(join(process.cwd(), "src/styles/a11y.css"), "utf8");

describe("Host layout and domain-owned design", () => {
  it("preserves focus, route-focus, reduced-motion and density policy", () => {
    expect(css).toMatch(/:focus-visible\s*\{/);
    expect(css).toContain("var(--workspace-accent, currentColor)");
    expect(css).toMatch(/main\[tabindex="-1"\][^{]*\{[^}]*outline:\s*none/);
    expect(css).toMatch(/main\[tabindex="-1"\]:focus-visible[^{]*\{[^}]*box-shadow:\s*inset/);
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(css).toContain('[data-density="comfortable"]');
    expect(css).toContain('[data-density="compact"]');
    expect(css).toMatch(/\[data-density\][^{]*button[^{]*\{[^}]*min-height:\s*44px/);
  });

  it("does not translate domain design into a parallel Host palette", () => {
    expect(css).toContain('#root:has(> [data-workspace-chrome="site-owned"])');
    expect(css).toContain("body[data-t2-site-owned]");
    expect(css).toContain('@layer base');
    expect(css).not.toContain("--color-slate-950: var(--workspace-");
    expect(css).not.toContain("--workspace-color-on-primary");
    expect(css).not.toContain("--workspace-color-primary-hover");
    expect(css).not.toContain("color-mix(in srgb");
  });

  it("keeps Host accessibility fallback inside the Host root", () => {
    expect(accessibility).toContain(":where(#root) :focus-visible");
    expect(accessibility).toContain(":where(#root) .skip-link");
    expect(accessibility).not.toContain("outline: 2px solid rgba(255, 255, 255, 0.75)");
  });
});
