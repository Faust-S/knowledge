// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Breadcrumbs } from "../src/workspace-host/shell";
import { RenderWithShell, makeShell } from "./helpers/domain-shell-harness";

describe("Accessibility policy + breadcrumb flag (PROMPT 11 §8, §9)", () => {
  it("breadcrumbs render when navigation.breadcrumbs === true", () => {
    const shell = makeShell({
      navigation: {
        active_route_strategy: "longest-prefix",
        breadcrumbs: true,
        primary: [],
        utility: [],
      },
    });
    render(
      <RenderWithShell shell={shell}>
        <Breadcrumbs route={{ view: "overview" }} />
      </RenderWithShell>,
    );
    expect(screen.getByTestId("domain-breadcrumbs")).toBeInTheDocument();
  });

  it("breadcrumbs are ABSENT when navigation.breadcrumbs === false", () => {
    const shell = makeShell({
      navigation: {
        active_route_strategy: "longest-prefix",
        breadcrumbs: false,
        primary: [],
        utility: [],
      },
    });
    const { container } = render(
      <RenderWithShell shell={shell}>
        <Breadcrumbs route={{ view: "overview" }} />
      </RenderWithShell>,
    );
    expect(container.querySelector('[data-testid="domain-breadcrumbs"]')).toBeNull();
  });

  it("global stylesheet declares :focus-visible and prefers-reduced-motion rules", async () => {
    const fs = await import("node:fs");
    const css = fs.readFileSync("src/styles/a11y.css", "utf8");
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
