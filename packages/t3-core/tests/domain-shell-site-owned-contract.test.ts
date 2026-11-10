import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateShellDoc } from "../src/config/host-config/validators";

const source = (file: string) => readFileSync(join(process.cwd(), file), "utf8");
const schema = JSON.parse(source("src/config/schemas/keys-2.0/domain-shell.schema.json")) as {
  properties: { layout: { properties: { workspace_chrome: { enum: string[] } } } };
};

describe("T2 site-owned functional styling contract", () => {
  it("permits isolated HTTP loopback without accepting remote HTTP hosts", () => {
    const pattern = new RegExp(
      (schema as unknown as { properties: { origin: { pattern: string } } }).properties.origin.pattern,
    );
    for (const origin of [
      "https://komplektovod.ru",
      "https://example.com",
      "http://127.0.0.1:4173",
      "http://localhost:4173",
    ]) {
      expect(pattern.test(origin)).toBe(true);
    }
    for (const origin of [
      "http://komplektovod.ru",
      "http://example.com:4173",
      "http://127.0.0.1",
      "http://localhost",
      "http://127.0.0.1:4173/path",
      "http://localhost.evil.example:4173",
      "http://192.168.1.20:4173",
      "http://0.0.0.0:4173",
    ]) {
      expect(pattern.test(origin)).toBe(false);
    }
  });

  it("validates real site-owned Host documents at a permitted loopback origin", () => {
    const fixture = JSON.parse(source("fixtures/host-configs/generic/domain-shell.json"));
    const realLocal = { ...fixture, origin: "http://127.0.0.1:4173" };
    realLocal.layout = { ...realLocal.layout, workspace_chrome: "site-owned" };
    expect(validateShellDoc(realLocal).valid).toBe(true);
    expect(validateShellDoc({ ...realLocal, origin: "http://example.com:4173" }).valid).toBe(false);
    expect(validateShellDoc({ ...realLocal, origin: "http://192.168.1.2:4173" }).valid).toBe(false);
  });

  it("preserves legacy integrated and opt-in site-owned schema modes", () => {
    expect(schema.properties.layout.properties.workspace_chrome.enum).toEqual(["integrated", "site-owned"]);
  });

  it("site-owned omits duplicate brand chrome while keeping Kernel controls", () => {
    const app = source("src/shell/AppShell.tsx");
    expect(app).toContain('layout.workspaceChrome === "site-owned"');
    expect(app).toContain("!siteOwned && <DomainFooter />");
    expect(app).toContain("<ActionBar kernel={kernel} asFooter={!siteOwned} />");
    expect(app).toContain("<HostModuleNavigation");
    expect(app).toContain("<ModuleRouteOutlet");
    expect(app).toContain("<KernelStatus state={state} onRetry={onRetry} />");
  });

  it("publishes stable CSS hooks rather than demanding a T2 color palette", () => {
    const hooks: Record<string, string[]> = {
      "src/shell/AppShell.tsx": ["workspace", "layout", "sidebar", "content"],
      "src/workspace-host/rendering/ModuleNavigation.tsx": ["navigation", "navigation-item"],
      "src/modules/base/features/overview/OverviewView.tsx": ["overview", "card", "primary-action"],
      "src/modules/base/features/workspaces/CreateWorkspaceDialog.tsx": ["dialog", "primary-action"],
      "src/workspace-host/rendering/HostDashboardSurface.tsx": ["dashboard", "dashboard-card"],
      "src/modules/exchange/routes/ExchangeHomeRoute.tsx": ["exchange"],
      "src/modules/lifecycle/routes/LifecycleHomeRoute.tsx": ["lifecycle"],
      "src/modules/lifecycle/routes/LifecycleTrashRoute.tsx": ["lifecycle", "dialog", "receipt"],
    };
    for (const [file, markers] of Object.entries(hooks)) {
      for (const name of markers) expect(source(file)).toContain(`data-t2-ui="${name}"`);
    }
    const css = source("src/styles.css");
    expect(css).not.toContain("--workspace-color-primary");
    expect(css).not.toContain("--color-emerald-800: var(");
  });
});
