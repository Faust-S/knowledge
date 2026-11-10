import type { ReactNode } from "react";
import { useDomainShell } from "./useDomainShell";

export type BreadcrumbNodeKind =
  | "domain"
  | "workspaces"
  | "workspace"
  | "object"
  | "section";

export interface BreadcrumbNode {
  kind: BreadcrumbNodeKind;
  label: string;
  /** Optional href when the node represents a navigable section. */
  href?: string;
  /**
   * When true, `label` MUST be rendered as a technical identifier: the host
   * MUST NOT invent a friendly name from object payload.
   */
  identifier?: boolean;
}

export interface BreadcrumbsHostRoute {
  view: "overview" | "workspaces" | "workspace" | "object" | "activity" | "packages";
  workspaceId?: string | null;
  objectId?: string | null;
}

export function buildBreadcrumbs(
  ctx: { brand: { name: string; short_name: string; home_path: string }; t: (k: string, f?: string) => string },
  route: BreadcrumbsHostRoute,
): BreadcrumbNode[] {
  const chain: BreadcrumbNode[] = [
    {
      kind: "domain",
      label: ctx.brand.short_name || ctx.brand.name,
      href: ctx.brand.home_path,
    },
  ];
  const workspacesLabel = ctx.t("workspaces");
  chain.push({
    kind: "workspaces",
    label: workspacesLabel,
    href: "#/workspaces",
  });
  if (route.view === "workspace" && route.workspaceId) {
    chain.push({
      kind: "workspace",
      label: route.workspaceId,
      identifier: true,
      href: `#/workspace/${route.workspaceId}`,
    });
  } else if (route.view === "object" && route.workspaceId && route.objectId) {
    chain.push({
      kind: "workspace",
      label: route.workspaceId,
      identifier: true,
      href: `#/workspace/${route.workspaceId}`,
    });
    chain.push({
      kind: "object",
      label: route.objectId,
      identifier: true,
    });
  } else if (route.view === "activity") {
    chain.push({ kind: "section", label: ctx.t("history") });
  } else if (route.view === "packages") {
    chain.push({ kind: "section", label: `${ctx.t("import")}/${ctx.t("export")}` });
  }
  return chain;
}

export interface BreadcrumbsProps {
  route: BreadcrumbsHostRoute;
}

export function Breadcrumbs({ route }: BreadcrumbsProps): ReactNode {
  const { brand, t, shell } = useDomainShell();
  // Breadcrumb policy (PROMPT 11 §9): render only when the domain-shell
  // configuration explicitly opts in via `navigation.breadcrumbs === true`.
  const nav = shell.navigation as { breadcrumbs?: unknown } | undefined;
  if (nav?.breadcrumbs !== true) return null;
  const items = buildBreadcrumbs({ brand, t }, route);
  return (
    <nav
      aria-label="Хлебные крошки"
      data-testid="domain-breadcrumbs"
      className="text-xs text-slate-400 py-1 px-1 flex flex-wrap items-center gap-1"
    >
      <ol className="flex flex-wrap items-center gap-1 min-w-0">
        {items.map((node, i) => {
          const isLast = i === items.length - 1;
          const labelClass = node.identifier
            ? "font-mono text-slate-300"
            : "text-slate-200";
          const content = (
            <span className={labelClass} data-node-kind={node.kind}>
              {node.label}
            </span>
          );
          return (
            <li key={`${node.kind}:${i}`} className="flex items-center gap-1 min-w-0">
              {i > 0 ? <span aria-hidden="true">›</span> : null}
              {isLast || !node.href ? (
                <span aria-current={isLast ? "page" : undefined}>{content}</span>
              ) : (
                <a href={node.href} className="hover:text-slate-100 min-h-6 inline-flex items-center">
                  {content}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
