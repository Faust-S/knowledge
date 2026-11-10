import type { KernelState } from "../kernel-client";
import type { WorkspaceProfileDefinition } from "../profiles/definition";
import { KernelStatus } from "../components/KernelStatus";
import {
  useDomainShell,
  Breadcrumbs,
  DomainBrandMark,
  DomainNavigation,
  type BreadcrumbsHostRoute,
} from "../workspace-host/shell";

export interface HeaderProps {
  state: KernelState;
  onRetry: () => void;
  profileDefinition: WorkspaceProfileDefinition;
  profileFallback: boolean;
  route: BreadcrumbsHostRoute;
}

/**
 * Header — consumes DomainShell provider for brand + descriptor and
 * domain navigation (workspace entry included). Profile identity is a
 * separate small badge next to the profile label, never a replacement
 * for `brand.logo_path`.
 */
export function Header({ state, onRetry, profileDefinition, profileFallback, route }: HeaderProps) {
  const { brand, layout } = useDomainShell();
  const session =
    state.status === "ready" || state.status === "limited" || state.status === "read-only"
      ? state.session
      : null;
  const compact = layout.headerVariant === "compact";

  return (
    <header
      className={`border-b border-slate-800 px-3 sm:px-4 py-3 flex flex-col gap-2 ${
        compact ? "" : "sm:gap-3"
      }`}
      data-density={layout.density}
      data-header-variant={layout.headerVariant}
    >
      <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
        <a
          href={brand.home_path}
          data-testid="domain-brand-home"
          className="inline-flex items-center gap-2 min-h-11 text-slate-100"
          aria-label={`${brand.name} — на главную`}
        >
          <DomainBrandMark />
        </a>
        <div className="min-w-0">
          <h1 data-testid="domain-brand-name" className="font-semibold text-slate-100 text-base sm:text-lg truncate">
            {brand.name}
          </h1>
          <p data-testid="domain-brand-descriptor" className="text-xs text-slate-400 truncate">
            <span className="sr-only">{brand.short_name}. </span>
            {brand.descriptor}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <DomainNavigation />
          <KernelStatus state={state} onRetry={onRetry} />
        </div>
      </div>

      <p
        data-testid="profile-label"
        className="text-xs text-slate-500 truncate flex items-center gap-2"
      >
        <span
          aria-hidden="true"
          data-testid="profile-badge"
          className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded text-[10px] font-semibold text-slate-900"
          style={{ backgroundColor: "var(--workspace-accent)" }}
        >
          {profileDefinition.logoText}
        </span>
        <span className="text-slate-300">{profileDefinition.label}</span>
        <span>· {profileDefinition.description}</span>
      </p>

      <Breadcrumbs route={route} />

      {profileFallback && (
        <p role="status" data-testid="profile-fallback-notice" className="text-xs text-amber-300">
          Профиль «{profileDefinition.id}» не удалось активировать. Используется универсальный fallback.
        </p>
      )}

      {session ? (
        <details className="text-xs text-slate-400">
          <summary className="cursor-pointer min-h-[24px]">Технические сведения о ядре</summary>
          <p className="mt-1">
            Runtime: <span className="font-mono">{session.runtime_version}</span>{" "}
            · Contract: <span className="font-mono">{session.contract_version}</span>
          </p>
        </details>
      ) : null}
    </header>
  );
}
