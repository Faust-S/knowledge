/**
 * Longest-prefix domain navigation resolution.
 *
 * The Domain Shell publishes primary/utility navigation entries under
 * `domain-shell.json → navigation.*`. The Workspace host consumes them but
 * does NOT invent items. Rules (Prompt 09 §5):
 *
 *  - active item = longest match on `match_prefix`
 *  - the compared value is `pathname` only — query and fragment are stripped
 *  - a `disabled: true` (or otherwise malformed) entry never becomes a link
 *  - `kind: "external"` is out of scope until a normative external policy
 *    is published; such entries are surfaced as diagnostics
 *  - `module` entries are not linked yet (ModuleRegistry lives in Prompt 10)
 */

export type DomainNavKind = "page" | "module" | "workspace" | "external";

export interface DomainNavItemSpec {
  id: string;
  label: string;
  path: string;
  order: number;
  kind: DomainNavKind;
  match_prefix: string;
  disabled?: boolean;
}

export interface ResolvedDomainNavItem {
  id: string;
  label: string;
  /** Absolute path suitable for an `href`. Never external. */
  href: string;
  kind: DomainNavKind;
  order: number;
  matchPrefix: string;
  active: boolean;
}

export interface DomainNavResolution {
  primary: ResolvedDomainNavItem[];
  utility: ResolvedDomainNavItem[];
  workspaceEntry: ResolvedDomainNavItem | null;
  /** Non-fatal issues (skipped external entries, disabled items, etc.). */
  diagnostics: string[];
}

export interface DomainNavigationSource {
  primary: DomainNavItemSpec[];
  utility: DomainNavItemSpec[];
  workspaceEntry: {
    id: string;
    label: string;
    path: string;
    placement: "primary" | "utility" | "cta";
  };
  activeStrategy: string;
}

/** Strip query string and fragment; do not decode. */
export function normalisePathname(input: string): string {
  const noHash = input.split("#", 1)[0] ?? "";
  const noQuery = noHash.split("?", 1)[0] ?? "";
  return noQuery.length === 0 ? "/" : noQuery;
}

function isSameOriginPath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  // Must start with a single slash and not be protocol-relative.
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (/[\s\u0000-\u001f]/.test(path)) return false;
  return true;
}

function longestPrefixMatchLength(
  pathname: string,
  matchPrefix: string,
): number {
  if (!matchPrefix.startsWith("/")) return 0;
  if (pathname === matchPrefix) return matchPrefix.length;
  // Prefix must land on a segment boundary — "/wor" should NOT match
  // "/workspaces". Prefixes that already end in "/" trivially satisfy this.
  const boundary = matchPrefix.endsWith("/") ? matchPrefix : `${matchPrefix}/`;
  if (pathname === matchPrefix || pathname.startsWith(boundary)) {
    return matchPrefix.length;
  }
  return 0;
}

export function resolveDomainNavigation(
  source: DomainNavigationSource,
  currentPathname: string,
): DomainNavResolution {
  const normalised = normalisePathname(currentPathname);
  const diagnostics: string[] = [];

  const usable = (item: DomainNavItemSpec): boolean => {
    if (!item || typeof item !== "object") return false;
    if (item.disabled === true) {
      diagnostics.push(`nav-item-disabled:${item.id ?? "?"}`);
      return false;
    }
    if (typeof item.label !== "string" || item.label.length === 0) return false;
    if (item.kind === "external") {
      diagnostics.push(`nav-external-blocked:${item.id}`);
      return false;
    }
    if (!isSameOriginPath(item.path)) {
      diagnostics.push(`nav-path-invalid:${item.id}`);
      return false;
    }
    if (!isSameOriginPath(item.match_prefix)) {
      diagnostics.push(`nav-match-prefix-invalid:${item.id}`);
      return false;
    }
    return true;
  };

  const project = (item: DomainNavItemSpec, activeBonus: boolean): ResolvedDomainNavItem => ({
    id: item.id,
    label: item.label,
    href: item.path,
    kind: item.kind,
    order: typeof item.order === "number" ? item.order : 0,
    matchPrefix: item.match_prefix,
    active: activeBonus,
  });

  const primaryUsable = source.primary.filter(usable);
  const utilityUsable = source.utility.filter(usable);

  // Longest-prefix winner across BOTH primary and utility (a utility entry
  // for "/settings/" must be able to become active if it is the longest
  // match). Ties are broken by (order asc, id asc) for determinism.
  const all = [...primaryUsable, ...utilityUsable];
  let bestId: string | null = null;
  let bestLen = 0;
  for (const item of all) {
    const len = longestPrefixMatchLength(normalised, item.match_prefix);
    if (len > bestLen) {
      bestLen = len;
      bestId = item.id;
    } else if (len > 0 && len === bestLen && bestId) {
      const a = all.find((i) => i.id === bestId)!;
      const b = item;
      const cmp =
        (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
      if (cmp > 0) bestId = item.id;
    }
  }

  const primary = primaryUsable
    .map((i) => project(i, i.id === bestId))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const utility = utilityUsable
    .map((i) => project(i, i.id === bestId))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  const we = source.workspaceEntry;
  const workspaceEntry: ResolvedDomainNavItem | null =
    we && isSameOriginPath(we.path) && typeof we.label === "string" && we.label.length > 0
      ? {
          id: we.id,
          label: we.label,
          href: we.path,
          kind: "workspace",
          order: 0,
          matchPrefix: we.path,
          active: longestPrefixMatchLength(normalised, we.path) > 0,
        }
      : null;

  if (source.activeStrategy && source.activeStrategy !== "longest-prefix") {
    diagnostics.push(`nav-strategy-unknown:${source.activeStrategy}`);
  }

  return { primary, utility, workspaceEntry, diagnostics };
}
