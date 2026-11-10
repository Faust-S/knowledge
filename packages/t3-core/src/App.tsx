import { useEffect, useState } from "react";
import type { KernelBootstrap } from "./kernel-client";
import { AppShell } from "./shell";
import { useHostConfig, HostConfigError } from "./config/host-config";
import type { WorkspaceProfileId } from "./config/workspace-profiles";
import { activateProfile } from "./config/profile-loader";
import { ErrorPage } from "./errors/ErrorPage";
import { hostConfigErrorToWorkspaceCode } from "./errors/host-config-error";
import type { WorkspaceProfileDefinition } from "./profiles/definition";

interface Activation {
  devBootstrap?: KernelBootstrap;
  definition: WorkspaceProfileDefinition;
  fallback: boolean;
  profileId: WorkspaceProfileId;
}

async function buildActivation(profileId: WorkspaceProfileId): Promise<Activation> {
  const active = await activateProfile(profileId);
  let devBootstrap: KernelBootstrap | undefined;
  if (import.meta.env.DEV) {
    const mode = (import.meta.env.VITE_IWXA_KERNEL_MODE ?? "mock") as "mock" | "real";
    if (mode !== "real") {
      const mod = await import("./kernel-client/dev-mock");
      devBootstrap = mod.createDevMockBootstrap({ mode: "full" });
    }
  }
  return {
    devBootstrap,
    definition: active.definition,
    fallback: active.fallback,
    profileId,
  };
}

/**
 * App bootstrap — the ONLY place that turns the tri-document
 * HostConfigResult into a mounted `AppShell`. The legacy DomainConfig
 * projection is not consumed anywhere in the presentation layer.
 */
export default function App() {
  const host = useHostConfig();
  const [activation, setActivation] = useState<Activation | null>(null);
  const [activationError, setActivationError] = useState<Error | null>(null);

  const workspaceProfileId =
    host.status === "ready" && host.workspace
      ? (host.workspace.profile as WorkspaceProfileId)
      : null;

  useEffect(() => {
    if (!workspaceProfileId) return;
    let cancelled = false;
    setActivation(null);
    setActivationError(null);
    buildActivation(workspaceProfileId)
      .then((a) => { if (!cancelled) setActivation(a); })
      .catch((e: unknown) => {
        if (!cancelled) setActivationError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => { cancelled = true; };
  }, [workspaceProfileId]);

  if (host.status === "loading" || host.status === "idle") {
    return <Fallback>Loading domain configuration…</Fallback>;
  }
  if (host.status === "error" && host.error) {
    return (
      <ErrorPage
        code={hostConfigErrorToWorkspaceCode(host.error.code)}
        error={new HostConfigError(host.error)}
      />
    );
  }
  if (activationError) return <ErrorPage code="config_invalid" error={activationError} />;
  if (!host.domain || !host.shell || !host.workspace || !workspaceProfileId || !activation) {
    return <Fallback>Activating profile…</Fallback>;
  }

  return (
    <AppShell
      host={host}
      hostDomain={host.domain}
      hostShell={host.shell}
      hostWorkspace={host.workspace}
      profileId={workspaceProfileId}
      profileDefinition={activation.definition}
      profileFallback={activation.fallback}
      devBootstrap={activation.devBootstrap}
    />
  );
}

function Fallback({ children }: { children: React.ReactNode }) {
  if (typeof document !== "undefined" && document.body.hasAttribute("data-t2-site-owned")) {
    return <div role="status" aria-live="polite" data-t2-ui="product-loading" className="p-4 text-sm">Подготовка рабочей области…</div>;
  }
  return (
    <div className="min-h-dvh flex items-center justify-center p-8 text-sm text-slate-400">
      {children}
    </div>
  );
}
