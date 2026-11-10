// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DomainNavigation } from "../src/workspace-host/shell";
import { RenderWithShell, makeShell } from "./helpers/domain-shell-harness";

describe("Domain navigation — workspace entry deduplication (PROMPT 14 §1)", () => {
  it("workspace-entry appears exactly once when a primary item duplicates it", () => {
    const shell = makeShell({
      navigation: {
        active_route_strategy: "longest-prefix",
        breadcrumbs: true,
        primary: [
          { id: "workspace", label: "Workspace", path: "/workspace/", order: 0, kind: "workspace", match_prefix: "/workspace/" },
        ],
        utility: [],
      },
      workspace_entry: { id: "workspace", label: "Workspace", path: "/workspace/", placement: "primary" },
    });
    render(
      <RenderWithShell shell={shell}>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    const entries = screen.getAllByTestId("workspace-entry");
    expect(entries.length).toBe(1);
  });

  it("dedup catches href match under a different id", () => {
    const shell = makeShell({
      navigation: {
        active_route_strategy: "longest-prefix",
        breadcrumbs: true,
        primary: [
          { id: "ws-alt", label: "WS", path: "/workspace/", order: 1, kind: "page", match_prefix: "/workspace/" },
        ],
        utility: [
          { id: "workspace", label: "Workspace", path: "/workspace/", order: 0, kind: "workspace", match_prefix: "/workspace/" },
        ],
      },
      workspace_entry: { id: "workspace", label: "Workspace", path: "/workspace/", placement: "utility" },
    });
    render(
      <RenderWithShell shell={shell}>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    expect(screen.getAllByTestId("workspace-entry").length).toBe(1);
    // The href-matched primary item is also removed.
    expect(screen.queryByText("WS")).toBeNull();
  });

  it("cta placement puts the workspace entry in utility group", () => {
    const shell = makeShell({
      workspace_entry: { id: "workspace", label: "Workspace", path: "/workspace/", placement: "cta" },
      navigation: {
        active_route_strategy: "longest-prefix",
        breadcrumbs: true,
        primary: [],
        utility: [],
      },
    });
    render(
      <RenderWithShell shell={shell}>
        <DomainNavigation pathname="/other" />
      </RenderWithShell>,
    );
    expect(screen.getAllByTestId("workspace-entry").length).toBe(1);
  });
});
