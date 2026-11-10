// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DomainBrandMark,
  mountDomainFavicon,
} from "../src/workspace-host/shell";
import { RenderWithShell, makeShell } from "./helpers/domain-shell-harness";

describe("Domain brand assets (PROMPT 11 §3, §4)", () => {
  it("brand mark uses logo_path as an image when path is safe", () => {
    const shell = makeShell({ brand: { logo_path: "/_iwxa/brand/logo.svg", short_name: "IWXA" } });
    render(
      <RenderWithShell shell={shell}>
        <DomainBrandMark />
      </RenderWithShell>,
    );
    const mark = screen.getByTestId("domain-brand-mark");
    expect(mark.getAttribute("data-brand-mark-mode")).toBe("image");
    expect(mark.querySelector("img")?.getAttribute("src")).toBe("/_iwxa/brand/logo.svg");
  });

  it("unsafe or missing logo_path falls back to short_name text", () => {
    const shell = makeShell({ brand: { logo_path: "https://evil.example/x.png", short_name: "IWXA" } });
    render(
      <RenderWithShell shell={shell}>
        <DomainBrandMark />
      </RenderWithShell>,
    );
    const mark = screen.getByTestId("domain-brand-mark");
    expect(mark.getAttribute("data-brand-mark-mode")).toBe("text");
    expect(mark.textContent).toBe("IWXA");
  });

  it("broken image (onError) falls back to short_name text", () => {
    const shell = makeShell({ brand: { logo_path: "/_iwxa/brand/logo.svg", short_name: "SHRT" } });
    render(
      <RenderWithShell shell={shell}>
        <DomainBrandMark />
      </RenderWithShell>,
    );
    const img = screen.getByTestId("domain-brand-mark").querySelector("img")!;
    fireEvent.error(img);
    const mark = screen.getByTestId("domain-brand-mark");
    expect(mark.getAttribute("data-brand-mark-mode")).toBe("text");
    expect(mark.textContent).toBe("SHRT");
  });

  it("favicon helper installs a managed <link>, updates href, and cleans up", () => {
    document.head.querySelectorAll("link[data-domain-favicon]").forEach((n) => n.remove());
    const res = mountDomainFavicon("/favicon.ico");
    expect(res.mounted).toBe(true);
    expect(res.diagnostic).toBeNull();
    const link = document.head.querySelector<HTMLLinkElement>("link[data-domain-favicon]");
    expect(link?.getAttribute("href")).toBe("/favicon.ico");
    res.cleanup();
    expect(document.head.querySelector("link[data-domain-favicon]")).toBeNull();
  });

  it("favicon helper rejects unsafe paths and yields a diagnostic", () => {
    const res = mountDomainFavicon("https://external/favicon.ico");
    expect(res.mounted).toBe(false);
    expect(res.diagnostic).toMatch(/favicon-path-invalid/);
  });
});
