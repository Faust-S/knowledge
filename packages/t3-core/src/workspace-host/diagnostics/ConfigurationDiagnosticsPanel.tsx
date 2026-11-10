import { isSupportedHostRuntimeVersion } from "../../config/host-config/runtime-binding";
import { useDomainShell } from "../../workspace-host/shell";
import type { HostConfigDiagnostic, HostConfigResult } from "../../config/host-config";
import type { WorkspaceProfileId } from "../../config/workspace-profiles";

export interface ConfigurationDiagnosticsPanelProps {
  host: HostConfigResult;
  profileId: WorkspaceProfileId;
  fallback: boolean;
}

/**
 * Panel «Конфигурация Workspace» — a compact, user-safe technical summary.
 * Renders load/parity status of each configuration file, resolved profile,
 * module counts and non-blocking runtime states (theme, favicon, fallback).
 * Technical codes are kept inside a nested closed `<details>`.
 */
export function ConfigurationDiagnosticsPanel({
  host,
  profileId,
  fallback,
}: ConfigurationDiagnosticsPanelProps) {
  const { theme, favicon, terminology } = useDomainShell();
  const domain = host.domain;
  const shell = host.shell;
  const workspace = host.workspace;
  const domainIds = [domain?.domain_id, shell?.domain_id, workspace?.domain_id].filter(
    (v): v is string => typeof v === "string",
  );
  const origins = [domain?.origin, shell?.origin].filter(
    (v): v is string => typeof v === "string",
  );
  const runtimeVersion = domain?.runtime?.runtime_version ?? null;
  const contractVersion = workspace?.host?.required_contract_version ?? null;
  const workspaceModules = Array.isArray(workspace?.modules)
    ? (workspace!.modules as Array<{ state?: unknown }>)
    : [];
  const moduleCounts = {
    active: workspaceModules.filter((m) => m.state === "active").length,
    planned: workspaceModules.filter((m) => m.state === "planned").length,
    disabled: workspaceModules.filter((m) => m.state === "disabled").length,
  };
  const showFixture = import.meta.env.DEV && host.fixture !== null;

  const idsAgree = domainIds.length === 3 && domainIds.every((v) => v === domainIds[0]);
  const originsAgree = origins.length === 2 && origins.every((v) => v === origins[0]);

  const runtimeOK = isSupportedHostRuntimeVersion(runtimeVersion) && runtimeVersion === workspace?.host?.required_runtime_version;
  const contractOK = contractVersion === "1.3.0";

  const themeLabel: string =
    theme.status === "ready"
      ? "Theme loaded"
      : theme.status === "blocked"
        ? "Theme blocked"
        : theme.status === "system-fallback"
          ? "Theme load failed"
          : theme.status === "loading"
            ? "Theme loading"
            : "Theme idle";
  const themeOK = theme.status === "ready" || theme.status === "loading";

  const faviconLabel: string =
    favicon.status === "ready"
      ? "Favicon loaded"
      : favicon.status === "blocked"
        ? "Favicon blocked"
        : "Favicon idle";
  const faviconOK = favicon.status === "ready";

  return (
    <details
      data-testid="configuration-diagnostics-panel"
      className="border border-slate-800 rounded p-3 text-xs text-slate-300 space-y-2"
    >
      <summary className="cursor-pointer text-slate-200 font-medium min-h-6">
        Конфигурация {terminology.workspaces}
      </summary>
      <div className="mt-2 space-y-1">
        <Row label="domain.json" ok={!!domain} note={domain?.config_schema_version ?? null} />
        <Row label="domain-shell.json" ok={!!shell} note={shell?.shell_schema_version ?? null} />
        <Row label="workspace.config.json" ok={!!workspace} note={workspace?.workspace_config_schema_version ?? null} />
        <Row
          label="domain_id"
          ok={idsAgree}
          note={idsAgree ? domainIds[0] : "рассогласование"}
        />
        <Row
          label="origin"
          ok={originsAgree}
          note={originsAgree ? origins[0] : "рассогласование"}
        />
        <Row label="runtime_version" ok={runtimeOK} note={runtimeVersion ?? "нет"} />
        <Row label="contract_version" ok={contractOK} note={contractVersion ?? "нет"} />
        <Row
          label="profile"
          ok={!fallback}
          note={fallback ? `${profileId} → generic (fallback)` : profileId}
        />
        {fallback ? (
          <Row label="policy" ok={false} note="Shell policy fallback used" />
        ) : null}
        <Row
          label="modules"
          ok={moduleCounts.active > 0}
          note={`active ${moduleCounts.active} · planned ${moduleCounts.planned} · disabled ${moduleCounts.disabled}`}
        />
        <Row label="theme" ok={themeOK} note={themeLabel} />
        <Row label="favicon" ok={faviconOK} note={faviconLabel} />
        {showFixture ? <Row label="fixture" ok={true} note={host.fixture} /> : null}
      </div>
      {host.diagnostics.length > 0 ? (
        <details className="mt-2" data-testid="configuration-diagnostics-technical">
          <summary className="cursor-pointer text-slate-400">
            Технические коды ({host.diagnostics.length})
          </summary>
          <ul className="mt-1 space-y-1 list-disc list-inside">
            {host.diagnostics.map((d: HostConfigDiagnostic, i) => (
              <li key={i}>
                <span className="font-mono text-slate-400">{d.code}</span>
                {": "}
                {d.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </details>
  );
}

function Row({ label, ok, note }: { label: string; ok: boolean; note: string | null }) {
  return (
    <div className="flex items-baseline gap-2">
      <span
        aria-hidden="true"
        className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-amber-400"}`}
      />
      <span className="font-mono text-slate-400">{label}</span>
      <span className="text-slate-300">{note ?? (ok ? "ok" : "—")}</span>
    </div>
  );
}
