// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DomainNavigation, DomainFooter } from "../src/workspace-host/shell";
import { RenderWithShell, makeShell } from "./helpers/domain-shell-harness";

describe("Domain shell — basic rendering (PROMPT 11 §1, §5)", () => {
  it("renders workspace entry from shell config, not hardcoded label", () => {
    const shell = makeShell({
      workspace_entry: { label: "Custom WS Label" },
    });
    render(
      <RenderWithShell shell={shell}>
        <DomainNavigation pathname="/some/other" />
      </RenderWithShell>,
    );
    expect(screen.getByTestId("workspace-entry").textContent).toBe("Custom WS Label");
  });

  it("does NOT render module entries (kind: module) — deferred until ModuleRegistry", () => {
    const shell = makeShell({
      navigation: {
        active_route_strategy: "longest-prefix",
        breadcrumbs: true,
        primary: [
          { id: "mod1", label: "Module 1", path: "/mod1/", order: 1, kind: "module", match_prefix: "/mod1/" },
          { id: "page1", label: "Page 1", path: "/page1/", order: 2, kind: "page", match_prefix: "/page1/" },
        ],
        utility: [],
      },
    });
    render(
      <RenderWithShell shell={shell}>
        <DomainNavigation pathname="/" />
      </RenderWithShell>,
    );
    // Module entry is hidden; page entry is visible.
    // (module entries are surfaced only in diagnostics, not DOM)
    expect(screen.queryByText("Module 1")).toBeNull();
    expect(screen.getByText("Page 1")).toBeInTheDocument();
  });

  it("footer variant 'none' produces no DOM", () => {
    const shell = makeShell({ layout: { footer_variant: "none" } });
    const { container } = render(
      <RenderWithShell shell={shell}>
        <DomainFooter />
      </RenderWithShell>,
    );
    expect(container.querySelector('[data-testid="domain-footer"]')).toBeNull();
  });
});
