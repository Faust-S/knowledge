import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useDomainShell } from "./useDomainShell";
import type { ResolvedDomainNavItem } from "./domain-navigation";

export interface DomainNavigationProps {
  /**
   * Current pathname (defaults to `window.location.pathname` when
   * available). Passed in for testability.
   */
  pathname?: string;
}

/**
 * DomainNavigation — renders `navigation.primary`, `navigation.utility`
 * and the `workspace_entry` from `domain-shell.json`.
 *
 *  - Workspace entry is deduplicated against primary/utility lists so it
 *    is rendered exactly once at its configured placement.
 *  - Mobile navigation supports two visual variants:
 *      drawer — side panel with backdrop, fixed to viewport
 *      sheet  — top-anchored panel under the header, backdrop
 *    Both trap focus, close on Escape and backdrop click, lock body
 *    scroll while open, and restore focus to the trigger on close.
 */
export function DomainNavigation({ pathname }: DomainNavigationProps) {
  const { navigation, layout, shell, t } = useDomainShell();

  const currentPath =
    pathname ??
    (typeof window !== "undefined" ? window.location.pathname : "/");
  const raw = navigation(currentPath);
  const workspaceEntrySpec = shell.workspace_entry;
  const isWorkspaceDuplicate = useCallback(
    (item: ResolvedDomainNavItem) =>
      item.id === workspaceEntrySpec.id ||
      item.href === workspaceEntrySpec.path ||
      (item.kind === "workspace" && item.href === workspaceEntrySpec.path),
    [workspaceEntrySpec.id, workspaceEntrySpec.path],
  );
  // Module entries are deferred until ModuleRegistry ships; workspace
  // duplicates are removed to guarantee a single workspace_entry.
  const resolved = {
    ...raw,
    primary: raw.primary.filter((i) => i.kind !== "module" && !isWorkspaceDuplicate(i)),
    utility: raw.utility.filter((i) => i.kind !== "module" && !isWorkspaceDuplicate(i)),
  };
  const insideWorkspace = currentPath.startsWith("/workspace/") || currentPath === "/workspace";
  const workspaceLabel = workspaceEntrySpec.label || t("workspace");
  const workspacePlacement = workspaceEntrySpec.placement;
  const workspacePath = workspaceEntrySpec.path;

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const closeMenu = useCallback(() => setOpen(false), []);

  // Escape closes and restores focus to the trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus the first focusable link when opened; body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel) {
      const first = panel.querySelector<HTMLElement>(
        "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      first?.focus();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Focus trap inside panel on Tab.
  const onPanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(
      panel.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((el) => !el.hasAttribute("aria-hidden"));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const renderNavList = (
    items: ResolvedDomainNavItem[],
    group: "primary" | "utility",
  ) => {
    if (items.length === 0) return null;
    return (
      <ul
        data-testid={`domain-nav-${group}`}
        data-nav-group={group}
        className="flex flex-wrap items-center gap-1"
      >
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={item.href}
              onClick={closeMenu}
              aria-current={item.active ? "page" : undefined}
              data-nav-item-id={item.id}
              data-nav-item-kind={item.kind}
              className={`inline-flex items-center min-h-11 px-3 py-2 rounded text-sm ${
                item.active
                  ? "bg-slate-800 text-slate-100"
                  : "text-slate-300 hover:bg-slate-800/50"
              }`}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    );
  };

  const workspaceEntryNode = useMemo(() => {
    const active = insideWorkspace;
    const commonCls =
      "inline-flex items-center min-h-11 px-3 py-2 rounded text-sm border border-slate-800";
    if (active) {
      return (
        <span
          data-testid="workspace-entry"
          data-workspace-entry-active="true"
          aria-current="page"
          className={`${commonCls} bg-slate-800 text-slate-100`}
        >
          {workspaceLabel}
        </span>
      );
    }
    return (
      <a
        href={workspacePath}
        data-testid="workspace-entry"
        data-workspace-entry-active="false"
        onClick={closeMenu}
        className={`${commonCls} text-slate-300 hover:bg-slate-800/50`}
      >
        {workspaceLabel}
      </a>
    );
  }, [insideWorkspace, workspaceLabel, workspacePath, closeMenu]);

  const insertWorkspaceInto = (group: "primary" | "utility") =>
    workspacePlacement === group ||
    (workspacePlacement === "cta" && group === "utility");

  const mobileMode = layout.mobileNavigation; // "drawer" | "sheet"

  // Panel classes: inline row on desktop; overlay with variant-specific
  // shape on mobile when open.
  const panelBase = "md:static md:flex md:flex-row md:items-center md:gap-3 md:flex-wrap md:p-0 md:bg-transparent md:border-0 md:max-w-none md:overflow-visible md:h-auto md:z-auto";
  const panelClosed = "hidden";
  const panelOpenDrawer =
    "fixed top-0 right-0 bottom-0 z-50 w-[min(20rem,85vw)] max-w-full bg-slate-950 border-l border-slate-800 p-4 overflow-y-auto flex flex-col items-stretch gap-3";
  const panelOpenSheet =
    "fixed left-0 right-0 top-14 z-50 max-h-[calc(100dvh-3.5rem)] bg-slate-950 border-t border-slate-800 p-4 overflow-y-auto flex flex-col items-stretch gap-3";
  const panelCls = `${open ? (mobileMode === "sheet" ? panelOpenSheet : panelOpenDrawer) : panelClosed} ${panelBase}`;

  return (
    <nav
      aria-label="Доменная навигация"
      data-testid="domain-navigation"
      data-mobile-mode={mobileMode}
      className="flex items-center gap-2 flex-wrap"
    >
      {/* Mobile trigger */}
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label="Открыть доменную навигацию"
        data-testid="domain-nav-toggle"
        onClick={() => setOpen((v) => !v)}
        className="md:hidden inline-flex items-center justify-center min-h-11 min-w-11 px-2 rounded border border-slate-800 text-slate-200"
      >
        <span aria-hidden="true">☰</span>
      </button>

      {/* Backdrop — mobile only, only when open */}
      {open ? (
        <div
          data-testid="domain-nav-backdrop"
          aria-hidden="true"
          onClick={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      ) : null}

      {/* Desktop / open-mobile panel */}
      <div
        ref={panelRef}
        id={panelId}
        data-testid="domain-nav-panel"
        data-open={open ? "true" : "false"}
        data-variant={mobileMode}
        onKeyDown={onPanelKeyDown}
        className={panelCls}
      >
        <div className="flex md:flex-row flex-col items-stretch md:items-center gap-2 md:flex-wrap">
          {insertWorkspaceInto("primary") ? workspaceEntryNode : null}
          {renderNavList(resolved.primary, "primary")}
        </div>
        <div className="flex md:flex-row flex-col items-stretch md:items-center gap-2 md:flex-wrap md:ml-auto">
          {renderNavList(resolved.utility, "utility")}
          {insertWorkspaceInto("utility") ? workspaceEntryNode : null}
        </div>
      </div>
    </nav>
  );
}
