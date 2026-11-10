import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Product-first Host presentation contract", () => {
  it("does not mount a second navigation or technical bar over the product", () => {
    const shell = source("src/shell/AppShell.tsx");
    expect(shell).toContain('layout.workspaceChrome === "site-owned"');
    expect(shell).toContain('data-product-first');
    expect(shell).toContain('!productFirst && <div data-t2-ui="sidebar"');
    expect(shell).toContain('!productFirst && <ActionBar');
    expect(shell).toContain('preferDomainLanding={layout.workspaceChrome === "site-owned"}');
    expect(shell).toContain('HostPanelSurface slot="inspector"');
    expect(shell).toContain('KernelStatus state={state} onRetry={onRetry}');
  });

  it("preserves the site first paint and contextual loading and errors", () => {
    const app = source("src/App.tsx");
    const loader = source("src/workspace-host/rendering/ModuleRouteLoading.tsx");
    const shell = source("src/shell/AppShell.tsx");
    expect(app).toContain('document.body.hasAttribute("data-t2-site-owned")');
    expect(loader).toContain('data-t2-ui="product-loading"');
    expect(shell).toContain('data-t2-ui="product-error"');
    expect(shell).toContain('runtimeState.status === "error"');
  });
});
