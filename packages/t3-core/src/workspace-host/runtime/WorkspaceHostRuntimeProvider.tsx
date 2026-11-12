/**
 * WorkspaceHostRuntimeProvider (PROMPT 19 §5-§7).
 *
 * Owns the async lifecycle of the WorkspaceHostRuntime handle:
 *   - starts a new runtime whenever the session identity changes;
 *   - guards against stale async completions using a monotonically
 *     incrementing generation counter;
 *   - disposes the previous runtime before publishing the next one;
 *   - exposes runtime state through React context.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { KernelSession } from "@/kernel-client/types";
import type { ProfileFacade } from "@/workspace-contract";
import { createWorkspaceHostRuntime } from "./create-workspace-host-runtime";
import type {
  WorkspaceHostRuntimeHandle,
  WorkspaceHostRuntimeState,
} from "./types";
import type { ModuleLoaderTable } from "../modules";
import type {
  CreateWorkspaceHostRuntimeInput,
  SignedAccessInvalidationSubscription,
} from "./types";

interface WorkspaceHostRuntimeProviderProps {
  session: KernelSession | null;
  workspaceConfig: { modules: readonly Record<string, unknown>[] };
  termResolver: (key: string, fallback?: string) => string;
  profile: ProfileFacade;
  /** Optional live snapshot supplied by the Host for defense-in-depth UI/module guards. */
  activeCapabilities?: readonly string[];
  /** Trusted embedding Host supplies the original signed Access owner.
   * Neither a module nor URL/package may configure these callbacks. */
  signedKernelAccess?: CreateWorkspaceHostRuntimeInput["signedKernelAccess"];
  signedActivityAccess?: CreateWorkspaceHostRuntimeInput["signedActivityAccess"];
  /** Reuse the original Control owner's subscribeInvalidation. Context
   * changes, signed STATUS and revocation must immediately detach old UI. */
  subscribeSignedAccessInvalidation?: SignedAccessInvalidationSubscription;
  /** Compile-time imported domain loaders owned by this Host build. */
  compileTimeModuleLoaders?: ModuleLoaderTable;
  /** Prefer domain home only for site-owned shells. */
  preferDomainLanding?: boolean;
  children: ReactNode;
}

const EMPTY_CAPABILITIES = Object.freeze([] as string[]);

const RuntimeContext = createContext<WorkspaceHostRuntimeState>({
  status: "idle",
});

export function useWorkspaceHostRuntime(): WorkspaceHostRuntimeState {
  return useContext(RuntimeContext);
}

export function useWorkspaceHostRuntimeHandle(): WorkspaceHostRuntimeHandle | null {
  const s = useContext(RuntimeContext);
  return s.status === "ready" ? s.runtime : null;
}

export function WorkspaceHostRuntimeProvider(
  props: WorkspaceHostRuntimeProviderProps,
) {
  const {
    session, workspaceConfig, termResolver, profile,
    activeCapabilities = EMPTY_CAPABILITIES,
    signedKernelAccess, signedActivityAccess, subscribeSignedAccessInvalidation,
    compileTimeModuleLoaders,
    preferDomainLanding = false,
    children,
  } = props;
  const [state, setState] = useState<WorkspaceHostRuntimeState>({
    status: "idle",
  });
  const [accessEpoch, setAccessEpoch] = useState(0);
  // An unexpected original Control stream loss is not an ordinary grant
  // change. It cannot silently re-mount a "ready" signed Host.
  const ownerUnavailableRef = useRef(false);
  const generationRef = useRef(0);
  const activeHandleRef = useRef<WorkspaceHostRuntimeHandle | null>(null);
  // Serializes every runtime teardown/start. Without this barrier, two rapid
  // session/config transitions can overlap: an older module deactivate()
  // may then dispose singleton services after the newer runtime activated.
  const transitionRef = useRef<Promise<void>>(Promise.resolve());

  // The existing Access owner is responsible for signed context/status
  // invalidations. Detach the previous subject's UI immediately, invalidate
  // retained Kernel facades with the original Host dispose(), then rebuild
  // through the same serialized runtime transition. No second Access state.
  useEffect(() => {
    if (!subscribeSignedAccessInvalidation) return;
    return subscribeSignedAccessInvalidation((reason) => {
      const disconnected = reason === "unavailable";
      if (disconnected) ownerUnavailableRef.current = true;
      ++generationRef.current;
      const previous = activeHandleRef.current;
      activeHandleRef.current = null;
      setState(disconnected
        ? {
            status: "error",
            error: Object.assign(new Error("T3_D1_CONTROL_INVALIDATION_UNAVAILABLE"),
              { code: "T3_D1_CONTROL_INVALIDATION_UNAVAILABLE" }),
            diagnostics: { composition: [], modules: [] },
          }
        : session ? { status: "starting" } : { status: "idle" });
      let stopped: Promise<void>;
      try {
        // dispose() invalidates bound D1 operations SYNCHRONOUSLY, before
        // awaiting module and router teardown.
        stopped = previous?.dispose() ?? Promise.resolve();
      } catch {
        stopped = Promise.resolve();
      }
      transitionRef.current = Promise.all([
        transitionRef.current.catch(() => {}),
        stopped.catch(() => {}),
      ]).then(() => {});
      // Genuine context/status changes may rebind through the same original
      // owner. A severed Control transport requires a NEW trusted page entry.
      if (!disconnected) setAccessEpoch(epoch => epoch + 1);
    });
  }, [subscribeSignedAccessInvalidation, session]);

  // A stable identity key so we don't restart on unrelated re-renders.
  const sessionKey = session
    ? `${session.contract_version}|${(session.granted_operations ?? []).join(",")}|${(session.granted_levels ?? []).join(",")}|cap:${activeCapabilities.join(",")}`
    : null;

  useEffect(() => {
    if (!session || !sessionKey) {
      // Session loss is an authority boundary, not only a UI state change.
      // Invalidate any in-flight generation and detach the active handle
      // immediately so old modules/router/listeners cannot remain reachable.
      ++generationRef.current;
      const prev = activeHandleRef.current;
      activeHandleRef.current = null;
      // A queued async stop() must not keep the old signed grant usable.
      prev?.invalidate();
      setState({ status: "idle" });
      const teardown = transitionRef.current
        .catch(() => {})
        .then(async () => {
          if (!prev) return;
          try {
            await prev.dispose();
          } catch {
            // Teardown remains best-effort, but the transition barrier still resolves.
          }
        });
      transitionRef.current = teardown.catch(() => {});
      return;
    }
    if (ownerUnavailableRef.current) {
      setState({
        status: "error",
        error: new Error("T3_D1_CONTROL_INVALIDATION_UNAVAILABLE"),
        diagnostics: { composition: [], modules: [] },
      });
      return;
    }
    const myGen = ++generationRef.current;
    let cancelled = false;
    // Invalidate immediately when the Session/config/owner identity changes.
    // The existing transition queue still serializes actual module teardown.
    activeHandleRef.current?.invalidate();
    setState({ status: "starting" });

    const transition = transitionRef.current
      .catch(() => {})
      .then(async () => {
        if (cancelled || myGen !== generationRef.current) return;

        // Tear down the previous handle first. This executes inside the global
        // transition queue, so no newer runtime can activate until teardown is done.
        const prev = activeHandleRef.current;
        activeHandleRef.current = null;
        if (prev) {
          try { await prev.dispose(); } catch { /* ignore */ }
        }
        if (cancelled || myGen !== generationRef.current) return;

        try {
          const runtime = await createWorkspaceHostRuntime({
            session,
            workspaceConfig,
            termResolver,
            profile,
            activeCapabilities,
            signedKernelAccess,
            signedActivityAccess,
            compileTimeModuleLoaders,
            preferDomainLanding,
          });
          if (cancelled || myGen !== generationRef.current) {
            // Superseded — dispose before the queued transition resolves.
            try { await runtime.dispose(); } catch { /* ignore */ }
            return;
          }
          activeHandleRef.current = runtime;
          setState({ status: "ready", runtime });
        } catch (err) {
          if (cancelled || myGen !== generationRef.current) return;
          setState({
            status: "error",
            error: err instanceof Error ? err : new Error(String(err)),
            diagnostics: { composition: [], modules: [] },
          });
        }
      });
    transitionRef.current = transition.catch(() => {});

    return () => {
      cancelled = true;
      // Do NOT dispose here synchronously — the effect body handles
      // handoff via activeHandleRef; the returned cleanup only marks
      // this generation stale.
    };
    // Restart only on session identity or workspaceConfig identity change.
  }, [sessionKey, session, workspaceConfig, termResolver, profile, activeCapabilities, signedKernelAccess, signedActivityAccess, accessEpoch, compileTimeModuleLoaders, preferDomainLanding]);

  // Unmount teardown.
  useEffect(() => {
    return () => {
      ++generationRef.current;
      const prev = activeHandleRef.current;
      activeHandleRef.current = null;
      prev?.invalidate();
      const teardown = transitionRef.current
        .catch(() => {})
        .then(async () => {
          if (!prev) return;
          try { await prev.dispose(); } catch { /* ignore */ }
        });
      transitionRef.current = teardown.catch(() => {});
    };
  }, []);

  const contextValue = useMemo(() => state, [state]);

  return (
    <RuntimeContext.Provider value={contextValue}>
      {children}
    </RuntimeContext.Provider>
  );
}
