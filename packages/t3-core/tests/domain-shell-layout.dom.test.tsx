// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { DomainShellProvider, useDomainShell } from "../src/workspace-host/shell";
import { genericDomain, genericWorkspace, makeShell } from "./helpers/domain-shell-harness";

function LayoutProbe() {
  const { layout, accessibility } = useDomainShell();
  return (
    <div
      data-testid="probe"
      data-content-width={layout.contentWidth}
      data-density={layout.density}
      data-workspace-chrome={layout.workspaceChrome}
      data-mobile-navigation={layout.mobileNavigation}
      data-min-contrast={accessibility.minimumContrast}
    />
  );
}

describe("Layout policy projection (PROMPT 11 §6)", () => {
  it("wide/comfortable/drawer/AA is applied", () => {
    const shell = makeShell({
      layout: {
        content_width: "wide",
        density: "comfortable",
        mobile_navigation: "drawer",
        header_variant: "domain",
        footer_variant: "domain",
        workspace_chrome: "integrated",
      },
    });
    const { getByTestId } = render(
      <DomainShellProvider
        hostDomain={genericDomain}
        hostShell={shell}
        hostWorkspace={genericWorkspace}
        fixture="generic"
      >
        <LayoutProbe />
      </DomainShellProvider>,
    );
    const el = getByTestId("probe");
    expect(el.getAttribute("data-content-width")).toBe("wide");
    expect(el.getAttribute("data-density")).toBe("comfortable");
    expect(el.getAttribute("data-workspace-chrome")).toBe("integrated");
    expect(el.getAttribute("data-mobile-navigation")).toBe("drawer");
    expect(el.getAttribute("data-min-contrast")).toBe("WCAG-AA");
  });

  it("normal + sheet variants are honoured", () => {
    const shell = makeShell({
      layout: {
        content_width: "normal",
        density: "compact",
        mobile_navigation: "sheet",
        header_variant: "compact",
        footer_variant: "compact",
        workspace_chrome: "integrated",
      },
    });
    const { getByTestId } = render(
      <DomainShellProvider
        hostDomain={genericDomain}
        hostShell={shell}
        hostWorkspace={genericWorkspace}
        fixture="generic"
      >
        <LayoutProbe />
      </DomainShellProvider>,
    );
    const el = getByTestId("probe");
    expect(el.getAttribute("data-content-width")).toBe("normal");
    expect(el.getAttribute("data-density")).toBe("compact");
    expect(el.getAttribute("data-mobile-navigation")).toBe("sheet");
  });

  it("accepts site-owned chrome and keeps accessibility/layout policy", () => {
    const shell = makeShell({
      layout: {
        content_width: "wide",
        density: "comfortable",
        mobile_navigation: "drawer",
        header_variant: "domain",
        footer_variant: "domain",
        workspace_chrome: "site-owned",
      },
    });
    const { getByTestId } = render(
      <DomainShellProvider hostDomain={genericDomain} hostShell={shell} hostWorkspace={genericWorkspace} fixture="generic">
        <LayoutProbe />
      </DomainShellProvider>,
    );
    const el = getByTestId("probe");
    expect(el.getAttribute("data-workspace-chrome")).toBe("site-owned");
    expect(el.getAttribute("data-min-contrast")).toBe("WCAG-AA");
  });

  it("unknown chrome value fails safely to integrated with a diagnostic", () => {
    const shell = makeShell({ layout: { workspace_chrome: "unrecognized-shell" } });
    function DiagnosticProbe() {
      const { layout } = useDomainShell();
      return <span data-testid="diag">{layout.workspaceChrome} {layout.diagnostics.join("|")}</span>;
    }
    const { getByTestId } = render(
      <DomainShellProvider hostDomain={genericDomain} hostShell={shell} hostWorkspace={genericWorkspace} fixture="generic">
        <DiagnosticProbe />
      </DomainShellProvider>,
    );
    expect(getByTestId("diag").textContent).toContain("integrated");
    expect(getByTestId("diag").textContent).toContain("layout-unknown:workspace_chrome");
  });
});
