// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, act, screen } from "@testing-library/react";
import { DomainShellProvider, useDomainShell } from "../src/workspace-host/shell";
import { genericDomain, genericWorkspace, makeShell } from "./helpers/domain-shell-harness";
import type { DomainShellDoc } from "../src/config/host-config";

function DiagProbe() {
  const { diagnostics, favicon, theme } = useDomainShell();
  return (
    <div>
      <div data-testid="fav-status">{favicon.status}</div>
      <div data-testid="fav-diag">{favicon.diagnostic ?? ""}</div>
      <div data-testid="theme-status">{theme.status}</div>
      <div data-testid="theme-diag">{theme.diagnostic ?? ""}</div>
      <div data-testid="all-diags">{diagnostics.join("|")}</div>
    </div>
  );
}

function mount(shell: DomainShellDoc) {
  return render(
    <DomainShellProvider
      hostDomain={genericDomain}
      hostShell={shell}
      hostWorkspace={genericWorkspace}
      fixture="generic"
    >
      <DiagProbe />
    </DomainShellProvider>,
  );
}

describe("Domain shell diagnostics (PROMPT 14 §3, §8, §9)", () => {
  it("unsafe favicon path is blocked and surfaced as diagnostic", async () => {
    const shell = makeShell({ brand: { favicon_path: "http://evil.example/x.ico" } });
    mount(shell);
    // Effects run synchronously in RTL v14+
    expect(screen.getByTestId("fav-status").textContent).toBe("blocked");
    expect(screen.getByTestId("fav-diag").textContent).toBe("favicon-path-invalid");
    expect(screen.getByTestId("all-diags").textContent).toContain("favicon-path-invalid");
  });

  it("unsafe theme tokens_path is blocked and reported as theme-path-invalid", () => {
    const shell = makeShell();
    // Force unsafe tokens_path via spread; JSON typing.
    const bad: DomainShellDoc = {
      ...shell,
      theme: { ...shell.theme, tokens_path: "https://evil.example/tokens.css" } as DomainShellDoc["theme"],
    };
    mount(bad);
    expect(screen.getByTestId("theme-status").textContent).toBe("blocked");
    expect(screen.getByTestId("theme-diag").textContent).toBe("theme-path-invalid");
  });

  it("stale theme onload from a previous config does not overwrite current state", () => {
    const shellA = makeShell({
      brand: { favicon_path: "/favicon.ico" },
    });
    const { rerender } = mount(shellA);
    // Grab the theme link element created by mount (data-domain-theme).
    const linkA = document.head.querySelector("link[data-domain-theme]") as HTMLLinkElement | null;
    expect(linkA).not.toBeNull();

    // Rerender with a NEW theme id — this cleans up A and mounts B.
    const shellB = makeShell({
      brand: { favicon_path: "/favicon.ico" },
    });
    // Force a different theme id to trigger effect rerun.
    (shellB as { theme: DomainShellDoc["theme"] }).theme = {
      ...shellB.theme,
      theme_id: "iwxa-alt",
    } as DomainShellDoc["theme"];
    rerender(
      <DomainShellProvider
        hostDomain={genericDomain}
        hostShell={shellB}
        hostWorkspace={genericWorkspace}
        fixture="generic"
      >
        <DiagProbe />
      </DomainShellProvider>,
    );

    // Fire a stale 'error' on the removed A link — must be ignored.
    act(() => {
      linkA!.dispatchEvent(new Event("error"));
    });

    // Current theme state must NOT be marked as failed.
    expect(screen.getByTestId("theme-diag").textContent).not.toContain("theme-load-failed");
  });

  it("safe favicon path yields ready status and no diagnostic", () => {
    const shell = makeShell({ brand: { favicon_path: "/favicon.ico" } });
    mount(shell);
    expect(screen.getByTestId("fav-status").textContent).toBe("ready");
    expect(screen.getByTestId("fav-diag").textContent).toBe("");
  });
});
