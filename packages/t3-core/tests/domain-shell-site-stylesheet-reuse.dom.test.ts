// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountDomainTheme } from "../src/workspace-host/shell/theme-loader";

const source = {
  themeId: "domain-site",
  tokensPath: "/assets/site.css",
  fontLoading: "system-stack" as const,
};

afterEach(() => {
  document.head.querySelectorAll("link[data-domain-theme], link[data-test-site-stylesheet]").forEach(node => node.remove());
});

describe("site-owned stylesheet lifecycle", () => {
  it("reuses the domain HTML stylesheet without moving, cloning or deleting it", () => {
    const site = document.createElement("link");
    site.rel = "stylesheet";
    site.href = source.tokensPath;
    site.setAttribute("data-test-site-stylesheet", "");
    document.head.appendChild(site);
    const status = vi.fn();
    const cleanup = mountDomainTheme(source, status, { reuseSiteStylesheet: true });
    expect(document.head.querySelectorAll('link[href="/assets/site.css"]')).toHaveLength(1);
    expect(document.head.querySelectorAll("link[data-domain-theme]")).toHaveLength(0);
    site.dispatchEvent(new Event("load"));
    expect(status).toHaveBeenCalledWith("ready");
    cleanup();
    expect(site.isConnected).toBe(true);
  });

  it("retains a managed safe same-origin fallback when the site has no matching CSS link", () => {
    const status = vi.fn();
    const cleanup = mountDomainTheme(source, status, { reuseSiteStylesheet: true });
    const managed = document.head.querySelector('link[data-domain-theme]');
    expect(managed).not.toBeNull();
    expect(managed?.getAttribute("href")).toBe("/assets/site.css");
    cleanup();
    expect(managed?.isConnected).toBe(false);
  });

  it("keeps the established managed-link behavior in legacy integrated mode", () => {
    const status = vi.fn();
    const cleanup = mountDomainTheme(source, status);
    expect(document.head.querySelectorAll("link[data-domain-theme]")).toHaveLength(1);
    cleanup();
    expect(document.head.querySelectorAll("link[data-domain-theme]")).toHaveLength(0);
  });
});
