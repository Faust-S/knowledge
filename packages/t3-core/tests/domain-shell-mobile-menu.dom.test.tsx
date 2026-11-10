// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DomainNavigation } from "../src/workspace-host/shell";
import { RenderWithShell, makeShell } from "./helpers/domain-shell-harness";

function openMenu() {
  const btn = screen.getByTestId("domain-nav-toggle");
  act(() => {
    fireEvent.click(btn);
  });
  return btn;
}

describe("Domain navigation — mobile menu behaviour (PROMPT 14 §7)", () => {
  it("focus moves to first focusable item when menu opens", async () => {
    const shell = makeShell();
    render(
      <RenderWithShell shell={shell}>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    openMenu();
    const panel = screen.getByTestId("domain-nav-panel");
    const firstLink = panel.querySelector("a, button");
    expect(firstLink).not.toBeNull();
    expect(document.activeElement).toBe(firstLink);
  });

  it("Escape closes and restores focus to trigger", () => {
    render(
      <RenderWithShell>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    const btn = openMenu();
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(btn);
  });

  it("backdrop click closes the menu", () => {
    render(
      <RenderWithShell>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    const btn = openMenu();
    const backdrop = screen.getByTestId("domain-nav-backdrop");
    act(() => {
      fireEvent.click(backdrop);
    });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("drawer and sheet expose different data-variant and layout classes", () => {
    const shellDrawer = makeShell({ layout: { mobile_navigation: "drawer" } });
    const drawerRender = render(
      <RenderWithShell shell={shellDrawer}>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("domain-nav-toggle"));
    });
    const drawerPanel = screen.getByTestId("domain-nav-panel");
    expect(drawerPanel.getAttribute("data-variant")).toBe("drawer");
    expect(drawerPanel.className).toMatch(/right-0/);
    expect(drawerPanel.className).toMatch(/w-\[min\(20rem/);
    drawerRender.unmount();

    const shellSheet = makeShell({ layout: { mobile_navigation: "sheet" } });
    render(
      <RenderWithShell shell={shellSheet}>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    act(() => {
      fireEvent.click(screen.getByTestId("domain-nav-toggle"));
    });
    const sheetPanel = screen.getByTestId("domain-nav-panel");
    expect(sheetPanel.getAttribute("data-variant")).toBe("sheet");
    expect(sheetPanel.className).toMatch(/top-14/);
    expect(sheetPanel.className).toMatch(/left-0/);
  });

  it("body scroll is locked while menu is open and restored when closed", () => {
    render(
      <RenderWithShell>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    expect(document.body.style.overflow).not.toBe("hidden");
    const btn = openMenu();
    expect(document.body.style.overflow).toBe("hidden");
    act(() => {
      fireEvent.keyDown(window, { key: "Escape" });
    });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});
