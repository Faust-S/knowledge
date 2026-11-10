export { DomainShellProvider } from "./DomainShellProvider";
export type {
  DomainShellContextValue,
  DomainShellProviderProps,
  AccessibilityPolicy,
  LayoutPolicy,
  ContentWidth,
  Density,
  MobileNavigation,
  ReducedMotionPolicy,
  MinContrast,
  FaviconState,
} from "./DomainShellProvider";
export { useDomainShell } from "./useDomainShell";
export { isSafeShellAssetPath } from "./safe-shell-path";
export {
  resolveDomainNavigation,
  normalisePathname,
} from "./domain-navigation";
export type {
  DomainNavItemSpec,
  DomainNavKind,
  DomainNavResolution,
  DomainNavigationSource,
  ResolvedDomainNavItem,
} from "./domain-navigation";
export {
  isSafeThemePath,
  classifyThemeSource,
  mountDomainTheme,
} from "./theme-loader";
export type { ThemeState, ThemeSource, ThemeStatus } from "./theme-loader";
export {
  term,
  createTerm,
  DEFAULT_TERMINOLOGY,
  REQUIRED_TERMINOLOGY_KEYS,
} from "./terminology";
export type { TerminologyMap } from "./terminology";
export {
  Breadcrumbs,
  buildBreadcrumbs,
} from "./Breadcrumbs";
export { DomainNavigation } from "./DomainNavigation";
export { DomainBrandMark } from "./DomainBrandMark";
export { DomainFooter } from "./DomainFooter";
export { mountDomainFavicon } from "./favicon";
export type { FaviconMountResult } from "./favicon";
export type {
  BreadcrumbNode,
  BreadcrumbNodeKind,
  BreadcrumbsHostRoute,
  BreadcrumbsProps,
} from "./Breadcrumbs";
