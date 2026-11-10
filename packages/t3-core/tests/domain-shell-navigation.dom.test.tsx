// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DomainNavigation } from "../src/workspace-host/shell";
import { RenderWithShell, makeShell } from "./helpers/domain-shell-harness";

describe("Domain navigation — DOM behaviour (PROMPT 11 §1, §7)", () => {
  it("active workspace entry gets aria-current=page and is not a link", () => {
    render(
      <RenderWithShell>
        <DomainNavigation pathname="/workspace/" />
      </RenderWithShell>,
    );
    const entry = screen.getByTestId("workspace-entry");
    expect(entry.getAttribute("aria-current")).toBe("page");
    expect(entry.tagName.toLowerCase()).toBe("span");
  });

  it("workspace entry outside /workspace/ renders as a link to the configured path", () => {
    const shell = makeShell({ workspace_entry: { path: "/workspace/" } });
    render(
      <RenderWithShell shell={shell}>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    const entry = screen.getByTestId("workspace-entry");
    expect(entry.tagName.toLowerCase()).toBe("a");
    expect(entry.getAttribute("href")).toBe("/workspace/");
  });

  it("mobile toggle sets aria-expanded and aria-controls; Escape closes", () => {
    render(
      <RenderWithShell>
        <DomainNavigation pathname="/" />
      </RenderWithShell>,
    );
    const btn = screen.getByTestId("domain-nav-toggle");
    const controls = btn.getAttribute("aria-controls");
    expect(controls && controls.length > 0).toBe(true);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    // Escape
    fireEvent.keyDown(window, { key: "Escape" });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("mobile toggle has a 44px+ tap target", () => {
    render(
      <RenderWithShell>
        <DomainNavigation pathname="/" />
      </RenderWithShell>,
    );
    const btn = screen.getByTestId("domain-nav-toggle");
    // Class-based check for min-h-11 / min-w-11 (44px in Tailwind default).
    expect(btn.className).toMatch(/min-h-11/);
    expect(btn.className).toMatch(/min-w-11/);
  });
});
