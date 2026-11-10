/**
 * T2-02D regression tests.
 *
 * Guards the follow-up corrections to the workspace catalog surface:
 *   - stable date sort with tie-breaker;
 *   - inline vs blocking catalog error notice;
 *   - refreshing indicator without discarding items;
 *   - empty-catalog import action when the domain grants import;
 *   - creation button rendered only when actually available;
 *   - explicit summary-state badges on cards;
 *   - CreateWorkspaceDialog has no unused `profileId` prop;
 *   - AppShell moves keyboard focus to main on internal navigation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  compareWorkspaceDatesDesc,
  compareWorkspaceIds,
} from "../src/modules/base/features/workspaces/workspace-format";

function read(rel: string) {
  return readFileSync(path.resolve(rel), "utf8");
}

describe("workspace-format sort helpers", () => {
  it("orders newer ISO dates first, tolerates invalid values, empties last", () => {
    const input = [
      "2026-01-05T00:00:00Z",
      "",
      "2026-01-10T00:00:00Z",
      "not-a-date",
      undefined,
      "2026-01-01T00:00:00Z",
    ];
    const sorted = [...input].sort((a, b) => compareWorkspaceDatesDesc(a, b));
    expect(sorted[0]).toBe("2026-01-10T00:00:00Z");
    expect(sorted[1]).toBe("2026-01-05T00:00:00Z");
    expect(sorted[2]).toBe("2026-01-01T00:00:00Z");
    // invalid non-empty stays before empties
    expect(sorted[3]).toBe("not-a-date");
    expect(sorted.slice(-2)).toEqual(["", undefined]);
  });

  it("compareWorkspaceDatesDesc returns 0 for identical ISO instants", () => {
    expect(compareWorkspaceDatesDesc("2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
  });

  it("compareWorkspaceIds is deterministic ru-RU compare", () => {
    expect(Math.sign(compareWorkspaceIds("ws-a", "ws-b"))).toBe(-1);
    expect(compareWorkspaceIds("ws-x", "ws-x")).toBe(0);
  });
});

describe("catalog-loader uses shared date/id comparators", () => {
  const src = read("src/modules/base/features/workspaces/catalog-loader.ts");
  it("imports the shared comparators", () => {
    expect(src).toMatch(/compareWorkspaceDatesDesc/);
    expect(src).toMatch(/compareWorkspaceIds/);
  });
  it("no longer performs raw localeCompare on updated_at", () => {
    expect(src).not.toMatch(/updated_at\s*\?\?\s*""\s*\)\s*\.localeCompare/);
  });
});

describe("CatalogErrorNotice — blocking vs inline", () => {
  const src = read("src/modules/base/features/workspaces/CatalogErrorNotice.tsx");
  it("declares both modes", () => {
    expect(src).toContain('"blocking"');
    expect(src).toContain('"inline"');
    expect(src).toContain("catalog-error-blocking");
    expect(src).toContain("catalog-error-inline");
  });
  it("distinguishes the two mode headings", () => {
    expect(src).toContain("Не удалось загрузить");
    expect(src).toContain("показаны данные последней успешной загрузки");
  });
});

describe("WorkspacesView — empty state, refresh, creation gating", () => {
  const src = read("src/modules/base/features/workspaces/WorkspacesView.tsx");

  it("empty catalog shows an import action when import is granted", () => {
    expect(src).toContain("workspaces-empty-import");
    expect(src).toMatch(/onOpenImport/);
    expect(src).toMatch(/canImport\s*=/);
    expect(src).toMatch(/t2\.importPreview/);
    expect(src).toMatch(/t2\.importCommit/);
    expect(src).toMatch(/t2\.importCancel/);
  });

  it("does not render a disabled 'Новая рабочая область' button", () => {
    // Must be capability-conditional, not just `disabled`.
    expect(src).not.toMatch(/data-testid="new-workspace-toggle"[^>]*disabled/);
    expect(src).toMatch(/\{canCreate && \(/);
  });

  it("renders both inline and blocking error notices", () => {
    expect(src).toContain('mode="inline"');
    expect(src).toContain('mode="blocking"');
  });

  it("indicates refresh in header and refresh button label", () => {
    expect(src).toMatch(/refreshing\s*=\s*catalog\.status\s*===\s*"loading"\s*&&\s*hasItems/);
    expect(src).toContain("workspaces-refresh");
    expect(src).toContain("Обновление…");
  });

  it("uses the shared date/id comparators for sorting", () => {
    expect(src).toMatch(/compareWorkspaceDatesDesc/);
    expect(src).toMatch(/compareWorkspaceIds/);
    // No stale locale compare on updated_at/created_at
    expect(src).not.toMatch(/updated_at\s*\|\|\s*""\)\s*\.localeCompare/);
    expect(src).not.toMatch(/created_at\s*\|\|\s*""\)\s*\.localeCompare/);
  });
});

describe("OverviewView — split states and creation gating", () => {
  const src = read("src/modules/base/features/overview/OverviewView.tsx");

  it("uses inline+blocking CatalogErrorNotice instead of ad-hoc alert", () => {
    expect(src).toContain('mode="inline"');
    expect(src).toContain('mode="blocking"');
    expect(src).toContain("CatalogErrorNotice");
  });

  it("shows refresh indicator only when items already exist", () => {
    expect(src).toMatch(/refreshing\s*=\s*catalog\.status\s*===\s*"loading"\s*&&\s*hasItems/);
  });

  it("does not render a disabled create button", () => {
    expect(src).not.toMatch(/data-testid="new-workspace-toggle"[^>]*disabled/);
    expect(src).toMatch(/\{canCreate && \(/);
  });

  it("uses the shared date/id comparators for recent list", () => {
    expect(src).toMatch(/compareWorkspaceDatesDesc/);
    expect(src).toMatch(/compareWorkspaceIds/);
  });
});

describe("CreateWorkspaceDialog — no unused profileId, has focus trap and describedby", () => {
  const src = read("src/modules/base/features/workspaces/CreateWorkspaceDialog.tsx");
  it("does not declare a profileId prop", () => {
    expect(src).not.toMatch(/\bprofileId\b/);
  });
  it("wires aria-describedby to the body copy", () => {
    expect(src).toMatch(/aria-describedby/);
  });
  it("handles Tab key inside the dialog (focus trap)", () => {
    expect(src).toMatch(/e\.key\s*===\s*"Tab"/);
  });
  it("guards Escape while a create call is in flight", () => {
    expect(src).toMatch(/if \(busy\) return;/);
  });
});

describe("WorkspaceCard — Baseline 1.2 removed summary badges and counts", () => {
  const src = read("src/modules/base/features/workspaces/WorkspaceCard.tsx");
  it("no longer renders summary-state badges", () => {
    expect(src).not.toContain("summary-state-complete");
    expect(src).not.toContain("summary-state-unavailable");
    expect(src).not.toContain("summary-state-failed");
    expect(src).not.toContain("Сводка загружена");
    expect(src).not.toContain("Сводка недоступна");
  });
  it("does not render per-workspace count rows", () => {
    expect(src).not.toMatch(/Объектов/);
    expect(src).not.toMatch(/Событий/);
    expect(src).not.toMatch(/Связей/);
  });
  it("does not read WorkspaceSummary / summary.counts", () => {
    expect(src).not.toMatch(/WorkspaceSummary\b/);
    expect(src).not.toMatch(/summary\.counts/);
    expect(src).not.toMatch(/summaryState/);
  });
});

describe("T2-02E — full profile-fallback text on both surfaces", () => {
  const FALLBACK_LINE_A = "Создание временно недоступно: профиль домена загружен в резервном режиме.";
  const FALLBACK_LINE_B = "Существующие данные можно просматривать и экспортировать.";
  it("OverviewView carries the complete two-sentence fallback", () => {
    const src = read("src/modules/base/features/overview/OverviewView.tsx");
    expect(src).toContain(FALLBACK_LINE_A);
    expect(src).toContain(FALLBACK_LINE_B);
  });
  it("WorkspacesView carries the complete two-sentence fallback", () => {
    const src = read("src/modules/base/features/workspaces/WorkspacesView.tsx");
    expect(src).toContain(FALLBACK_LINE_A);
    expect(src).toContain(FALLBACK_LINE_B);
  });
});

describe("T2-02E — refresh status testid gates on loading + prior items", () => {
  it("OverviewView renders workspace-refreshing-status only when refreshing", () => {
    const src = read("src/modules/base/features/overview/OverviewView.tsx");
    expect(src).toContain('data-testid="workspace-refreshing-status"');
    expect(src).toMatch(/\{refreshing && \(/);
  });
  it("WorkspacesView renders workspace-refreshing-status only when refreshing", () => {
    const src = read("src/modules/base/features/workspaces/WorkspacesView.tsx");
    expect(src).toContain('data-testid="workspace-refreshing-status"');
    expect(src).toMatch(/\{refreshing && \(/);
  });
});

describe("T2-02E — separate cancel vs create handlers, dialog does not manage focus", () => {
  it("OverviewView defines cancelCreateDialog + createAndOpenWorkspace and does not cross-call them", () => {
    const src = read("src/modules/base/features/overview/OverviewView.tsx");
    expect(src).toMatch(/const cancelCreateDialog\b/);
    expect(src).toMatch(/const createAndOpenWorkspace\b/);
    expect(src).toMatch(/onCancel=\{cancelCreateDialog\}/);
    expect(src).toMatch(/onCreate=\{createAndOpenWorkspace\}/);
    // success path must not invoke the cancel handler.
    const bodyStart = src.indexOf("createAndOpenWorkspace");
    const body = src.slice(bodyStart, bodyStart + 500);
    expect(body).not.toMatch(/cancelCreateDialog\s*\(/);
  });
  it("WorkspacesView defines cancelCreateDialog + createAndOpenWorkspace and does not cross-call them", () => {
    const src = read("src/modules/base/features/workspaces/WorkspacesView.tsx");
    expect(src).toMatch(/const cancelCreateDialog\b/);
    expect(src).toMatch(/const createAndOpenWorkspace\b/);
    expect(src).toMatch(/onCancel=\{cancelCreateDialog\}/);
    expect(src).toMatch(/onCreate=\{createAndOpenWorkspace\}/);
    const bodyStart = src.indexOf("createAndOpenWorkspace");
    const body = src.slice(bodyStart, bodyStart + 500);
    expect(body).not.toMatch(/cancelCreateDialog\s*\(/);
  });
  it("CreateWorkspaceDialog no longer restores focus itself", () => {
    const src = read("src/modules/base/features/workspaces/CreateWorkspaceDialog.tsx");
    expect(src).not.toMatch(/returnFocusRef/);
    // The dialog may still inspect `document.activeElement` inside the
    // focus-trap keydown handler, but it must NOT do so in the open/close
    // lifecycle effect (that used to save/restore the previously-focused
    // element). Focus restoration is now the parent's responsibility.
    const openEffect = src.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[open\]\);/);
    expect(openEffect).not.toBeNull();
    expect(openEffect![0]).not.toMatch(/document\.activeElement/);
    
  });
});

describe("PROMPT 28 — Host route focus uses animation frame, no setTimeout", () => {
  const src = read("src/workspace-host/router/use-host-route-focus.ts");
  it("uses requestAnimationFrame / cancelAnimationFrame, not setTimeout", () => {
    expect(src).toMatch(/requestAnimationFrame/);
    expect(src).toMatch(/cancelAnimationFrame/);
    expect(src).not.toMatch(/setTimeout/);
  });
  it("skips focusing on the first render via an initial ref guard", () => {
    expect(src).toMatch(/initialRef/);
  });
  it("only refocuses when the active RouteRef id changes", () => {
    expect(src).toMatch(/prevId/);
    expect(src).toMatch(/routeRef\.id/);
  });
});

describe("T2-02E — useWorkspaceCatalog uses loading + prior items snapshot", () => {
  const src = read("src/modules/base/features/workspaces/useWorkspaceCatalog.ts");
  it("sets status:'loading' with items: prev.items when starting a load", () => {
    expect(src).toMatch(/status:\s*"loading"/);
    expect(src).toMatch(/items:\s*prev\.items/);
    expect(src).toMatch(/loadedAt:\s*prev\.loadedAt/);
  });
  it("deduplicates concurrent refreshes via inFlightRef", () => {
    expect(src).toMatch(/inFlightRef/);
    expect(src).toMatch(/if \(inFlightRef\.current\) return inFlightRef\.current/);
  });
});


describe("PROMPT 28 — HostShellContent focuses main on navigation and never on first mount", () => {
  const src = read("src/shell/AppShell.tsx");
  it("declares a ref for the main region", () => {
    expect(src).toMatch(/mainRef/);
    expect(src).toMatch(/ref=\{mainRef\}/);
  });
  it("delegates focus scheduling to useHostRouteFocus", () => {
    expect(src).toMatch(/useHostRouteFocus\(/);
  });
});


// PROMPT 21 §7 — MainArea removed; the shell now dispatches
// import/export via cross-base navigation to iwxa.workspace.exchange.
// The onOpenImport wiring is verified inside the exchange module tests.
