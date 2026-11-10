import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  DomainConfigDoc,
  DomainShellDoc,
  WorkspaceConfigDoc,
} from "../../config/host-config";
import {
  classifyThemeSource,
  mountDomainTheme,
  type ThemeState,
  type ThemeStatus,
} from "./theme-loader";
import { mountDomainFavicon } from "./favicon";
import {
  DEFAULT_TERMINOLOGY,
  createTerm,
  type TerminologyMap,
} from "./terminology";
import {
  resolveDomainNavigation,
  type DomainNavResolution,
  type DomainNavigationSource,
  type DomainNavItemSpec,
} from "./domain-navigation";

// --- Accessibility & layout policy projection -----------------------------

export type ReducedMotionPolicy = "respect-system";
export type MinContrast = "WCAG-AA" | "WCAG-AAA";

export interface AccessibilityPolicy {
  focusVisible: true;
  reducedMotion: ReducedMotionPolicy;
  minimumContrast: MinContrast;
  diagnostics: string[];
}

export type ContentWidth = "normal" | "wide" | "fluid";
export type Density = "comfortable" | "compact";
export type WorkspaceChrome = "integrated" | "site-owned";
export type MobileNavigation = "drawer" | "sheet";

export interface LayoutPolicy {
  headerVariant: "domain" | "compact" | "editor";
  footerVariant: "domain" | "compact" | "none";
  contentWidth: ContentWidth;
  density: Density;
  workspaceChrome: WorkspaceChrome;
  mobileNavigation: MobileNavigation;
  diagnostics: string[];
}

export interface FaviconState {
  status: "idle" | "ready" | "blocked";
  diagnostic: string | null;
}

function readEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
  key: string,
  diagnostics: string[],
): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) {
    return v as T;
  }
  diagnostics.push(`layout-unknown:${key}:${String(v)}`);
  return fallback;
}

function projectAccessibility(raw: unknown): AccessibilityPolicy {
  const diagnostics: string[] = [];
  const src = (raw ?? {}) as Record<string, unknown>;
  if (src.focus_visible !== true) diagnostics.push("a11y-focus-visible-off");
  const reduced = src.reduced_motion === "respect-system" ? "respect-system" : "respect-system";
  if (src.reduced_motion !== "respect-system") diagnostics.push("a11y-reduced-motion-unknown");
  const contrast = readEnum<MinContrast>(
    src.minimum_contrast,
    ["WCAG-AA", "WCAG-AAA"],
    "WCAG-AA",
    "minimum_contrast",
    diagnostics,
  );
  return {
    focusVisible: true,
    reducedMotion: reduced,
    minimumContrast: contrast,
    diagnostics,
  };
}

function projectLayout(raw: unknown): LayoutPolicy {
  const diagnostics: string[] = [];
  const src = (raw ?? {}) as Record<string, unknown>;
  const headerVariant = readEnum(src.header_variant, ["domain", "compact", "editor"] as const, "domain", "header_variant", diagnostics);
  const footerVariant = readEnum(src.footer_variant, ["domain", "compact", "none"] as const, "domain", "footer_variant", diagnostics);
  const contentWidth = readEnum<ContentWidth>(src.content_width, ["normal", "wide", "fluid"], "wide", "content_width", diagnostics);
  const density = readEnum<Density>(src.density, ["comfortable", "compact"], "comfortable", "density", diagnostics);
  const mobileNavigation = readEnum<MobileNavigation>(src.mobile_navigation, ["drawer", "sheet"], "drawer", "mobile_navigation", diagnostics);
  const workspaceChrome = readEnum(src.workspace_chrome, ["integrated", "site-owned"] as const, "integrated", "workspace_chrome", diagnostics);
  return {
    headerVariant,
    footerVariant,
    contentWidth,
    density,
    workspaceChrome,
    mobileNavigation,
    diagnostics,
  };
}

function projectNavigationSource(raw: unknown, shell: DomainShellDoc): DomainNavigationSource {
  const src = (raw ?? {}) as Record<string, unknown>;
  const primary = Array.isArray(src.primary) ? (src.primary as DomainNavItemSpec[]) : [];
  const utility = Array.isArray(src.utility) ? (src.utility as DomainNavItemSpec[]) : [];
  const activeStrategy =
    typeof src.active_route_strategy === "string" ? src.active_route_strategy : "longest-prefix";
  return {
    primary,
    utility,
    activeStrategy,
    workspaceEntry: shell.workspace_entry,
  };
}

// --- Context ---------------------------------------------------------------

export interface DomainShellContextValue {
  domain: DomainConfigDoc;
  shell: DomainShellDoc;
  workspace: WorkspaceConfigDoc;
  fixture: string | null;
  brand: DomainShellDoc["brand"];
  layout: LayoutPolicy;
  accessibility: AccessibilityPolicy;
  terminology: TerminologyMap;
  t: (key: string, fallback?: string) => string;
  navigation: (pathname: string) => DomainNavResolution;
  theme: ThemeState;
  favicon: FaviconState;
  /** Non-fatal issues detected during shell projection and asset load. */
  diagnostics: string[];
}

const Ctx = createContext<DomainShellContextValue | null>(null);

export interface DomainShellProviderProps {
  hostDomain: DomainConfigDoc;
  hostShell: DomainShellDoc;
  hostWorkspace: WorkspaceConfigDoc;
  fixture: string | null;
  children: ReactNode;
}

export function DomainShellProvider(props: DomainShellProviderProps): ReactNode {
  const { hostDomain, hostShell, hostWorkspace, fixture, children } = props;

  const layout = useMemo(() => projectLayout(hostShell.layout), [hostShell.layout]);
  const accessibility = useMemo(
    () => projectAccessibility(hostShell.accessibility),
    [hostShell.accessibility],
  );
  const navSource = useMemo(
    () => projectNavigationSource(hostShell.navigation, hostShell),
    [hostShell],
  );
  const terminology = useMemo<TerminologyMap>(() => {
    const configured = hostWorkspace.terminology ?? {};
    const merged: Record<string, string> = { ...DEFAULT_TERMINOLOGY };
    for (const [k, v] of Object.entries(configured)) {
      if (typeof v === "string" && v.length > 0) merged[k] = v;
    }
    return Object.freeze(merged);
  }, [hostWorkspace.terminology]);
  const t = useMemo(() => createTerm(terminology), [terminology]);

  const [themeState, setThemeState] = useState<ThemeState>(() => ({
    status: "idle",
    themeId: null,
    tokensPath: null,
    diagnostic: null,
  }));
  const themeGenRef = useRef(0);

  useEffect(() => {
    // Generation guard — stale onload/onerror from a previous theme
    // must not overwrite the current state.
    themeGenRef.current += 1;
    const gen = themeGenRef.current;
    const { source, diagnostic } = classifyThemeSource(hostShell.theme);
    if (!source) {
      setThemeState({
        status: "blocked",
        themeId: null,
        tokensPath: null,
        diagnostic: diagnostic ?? "theme-invalid",
      });
      return;
    }
    setThemeState({
      status: "loading",
      themeId: source.themeId,
      tokensPath: source.tokensPath,
      diagnostic: null,
    });
    const cleanup = mountDomainTheme(source, (status: Exclude<ThemeStatus, "idle">, d?: string) => {
      if (gen !== themeGenRef.current) return; // stale callback — ignore
      setThemeState((prev) => ({
        ...prev,
        status,
        diagnostic: d ?? prev.diagnostic,
      }));
    }, { reuseSiteStylesheet: layout.workspaceChrome === "site-owned" });
    return cleanup;
  }, [hostShell.theme, layout.workspaceChrome]);

  // Managed favicon lifecycle — mount here so diagnostics are captured.
  const [faviconState, setFaviconState] = useState<FaviconState>(() => ({
    status: "idle",
    diagnostic: null,
  }));

  useEffect(() => {
    const res = mountDomainFavicon(hostShell.brand.favicon_path);
    setFaviconState({
      status: res.mounted ? "ready" : "blocked",
      diagnostic: res.diagnostic,
    });
    return () => {
      res.cleanup();
    };
  }, [hostShell.brand.favicon_path]);

  const value = useMemo<DomainShellContextValue>(() => {
    const combined: string[] = [
      ...layout.diagnostics,
      ...accessibility.diagnostics,
    ];
    if (themeState.diagnostic) combined.push(themeState.diagnostic);
    if (faviconState.diagnostic) combined.push(faviconState.diagnostic);
    return {
      domain: hostDomain,
      shell: hostShell,
      workspace: hostWorkspace,
      fixture,
      brand: hostShell.brand,
      layout,
      accessibility,
      terminology,
      t,
      navigation: (pathname: string) => resolveDomainNavigation(navSource, pathname),
      theme: themeState,
      favicon: faviconState,
      diagnostics: combined,
    };
  }, [hostDomain, hostShell, hostWorkspace, fixture, layout, accessibility, terminology, t, navSource, themeState, faviconState]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDomainShellContextInternal(): DomainShellContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useDomainShell must be used inside <DomainShellProvider>",
    );
  }
  return ctx;
}

export { Ctx as DomainShellInternalContext };
