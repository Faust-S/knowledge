// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionBar } from "../src/shell/ActionBar";
import type { KernelFacade } from "../src/workspace-contract";
import { DomainFooter } from "../src/workspace-host/shell";
import { RenderWithShell, makeShell } from "./helpers/domain-shell-harness";

describe("Domain footer variants (PROMPT 11 §5)", () => {
  it("variant 'domain' renders short name, descriptor and home link", () => {
    const shell = makeShell({
      layout: { footer_variant: "domain" },
      brand: { short_name: "IWXA", descriptor: "Descr X", home_path: "/" },
    });
    render(
      <RenderWithShell shell={shell}>
        <DomainFooter />
      </RenderWithShell>,
    );
    const home = screen.getByTestId("domain-footer-home");
    expect(home.getAttribute("href")).toBe("/");
    expect(home.textContent).toBe("IWXA");
    expect(screen.getByTestId("domain-footer-descriptor").textContent).toMatch(/Descr X/);
  });

  it("variant 'compact' hides descriptor", () => {
    const shell = makeShell({ layout: { footer_variant: "compact" } });
    render(
      <RenderWithShell shell={shell}>
        <DomainFooter />
      </RenderWithShell>,
    );
    expect(screen.getByTestId("domain-footer-home")).toBeInTheDocument();
    expect(screen.queryByTestId("domain-footer-descriptor")).toBeNull();
  });

  it("variant 'none' renders nothing", () => {
    const shell = makeShell({ layout: { footer_variant: "none" } });
    const { container } = render(
      <RenderWithShell shell={shell}>
        <DomainFooter />
      </RenderWithShell>,
    );
    expect(container.querySelector('[data-testid="domain-footer"]')).toBeNull();
  });
});

describe("Generic fixture descriptor (PROMPT 11 §10)", () => {
  it("does not contain the old Synthetic Learning descriptor", async () => {
    const fx = (await import("../fixtures/host-configs/generic/domain-shell.json")).default as {
      brand: { descriptor: string };
    };
    expect(fx.brand.descriptor).toBe("Универсальная рабочая область IWXA");
    expect(fx.brand.descriptor).not.toMatch(/Synthetic/i);
  });
});

describe("Host technical details inside a site-owned shell", () => {
  const kernel = {
    sessionInfo: {
      mode: "full",
      runtime_version: "0.3.6",
      contract_version: "1.3.0",
      service_id: "iwxa.qa.test",
    },
    grantedLevels: ["T2"],
    hasOperation: (op: string) => op === "t1.createWorkspace",
  } as unknown as KernelFacade;

  it("renders a div, not a second footer, while retaining kernel capability detail", () => {
    const { container } = render(<ActionBar kernel={kernel} asFooter={false} />);
    const panel = screen.getByTestId("kernel-technical-details");
    expect(panel.tagName).toBe("DIV");
    expect(container.querySelector("footer")).toBeNull();
    const trigger = screen.getByRole("button", { name: /Технические сведения/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel.textContent).toContain("0.3.6");
    expect(panel.textContent).toContain("1.3.0");
    expect(panel.textContent).toContain("Создание рабочей области");
    expect(panel.textContent).toContain("да");
  });

  it("keeps the original footer element by default for existing integrated domains", () => {
    render(<ActionBar kernel={kernel} />);
    expect(screen.getByTestId("kernel-technical-details").tagName).toBe("FOOTER");
  });
});
