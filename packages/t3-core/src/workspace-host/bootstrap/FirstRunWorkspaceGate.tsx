/**
 * Host-owned local first-run gate. The domain session remains the only session
 * available to subject modules. A separate, explicitly registered provisioner
 * is connected only on a user click and is never handed to a domain module.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { connectKernel } from '../../kernel-client/connect';
import { adapter } from '../../kernel-client/adapter';
import type { KernelBootstrap, KernelSession } from '../../kernel-client/types';
import type { DomainConfigDoc } from '../../config/host-config';
import { firstRunView, pendingIdForContext, type FirstRunSnapshot, type PendingWorkspaceIntent } from './first-run-epoch';
import { generateWorkspaceId } from '../../modules/base/features/workspaces/workspace-id';
import {
  findExistingFirstRunWorkspace,
  provisionFirstRunWorkspace,
  selectFirstRunProvisioner,
  type ProvisionWorkspaceApi,
} from './first-run-workspace';

function sessionApi(session: KernelSession): ProvisionWorkspaceApi {
  const operations = new Set<string>((session.granted_operations ?? []) as readonly string[]);
  return {
    hasOperation: (operation) => operations.has(operation),
    listWorkspaces: () => adapter.listWorkspaces(session, { include_deleted: false }),
    getWorkspace: (id) => adapter.getWorkspace(session, id),
    createWorkspace: (input) => adapter.createWorkspace(session, input),
  };
}

export interface FirstRunWorkspaceGateProps {
  session: KernelSession | null;
  domain: DomainConfigDoc;
  workspaceServiceId: string;
  profileId: string;
  profileFallback: boolean;
  devBootstrap?: KernelBootstrap;
  /** A signed D1 Host owns its subject provisioning outside this legacy
   * first-run connector; do not start an unrelated unsigned provisioner. */
  signedOwnerRequired?: boolean;
  children: ReactNode;
}


export function FirstRunWorkspaceGate({
  session, domain, workspaceServiceId, profileId, profileFallback,
  devBootstrap, signedOwnerRequired = false, children,
}: FirstRunWorkspaceGateProps) {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const selection = selectFirstRunProvisioner(domain, workspaceServiceId, currentOrigin);
  const provisionerId = selection.status === 'enabled' ? selection.serviceId : null;
  const contextKey = JSON.stringify([
    domain.domain_id, domain.origin, workspaceServiceId, provisionerId,
    profileId, currentOrigin,
  ]);
  const [snapshot, setSnapshot] = useState<FirstRunSnapshot>({
    session: null, contextKey: '', phase: 'checking', message: null,
  });
  const { phase, message } = firstRunView(snapshot, session, contextKey);
  const [busy, setBusy] = useState(false);
  const runningRef = useRef(false);
  const [refreshId, setRefreshId] = useState(0);
  const pendingIntentRef = useRef<PendingWorkspaceIntent | null>(null);
  const generation = useRef(0);
  const primary = useMemo(() => session && !signedOwnerRequired
    ? sessionApi(session) : null, [session, signedOwnerRequired]);

  useEffect(() => {
    const ticket = ++generation.current;
    if (signedOwnerRequired || !provisionerId || !primary || profileFallback || devBootstrap) return;
    setSnapshot({ session, contextKey, phase: 'checking', message: null });
    void findExistingFirstRunWorkspace(primary, profileId)
      .then((exists) => {
        if (ticket !== generation.current) return;
        setSnapshot({ session, contextKey, phase: exists ? 'ready' : 'empty', message: null });
      })
      .catch((error: unknown) => {
        if (ticket !== generation.current) return;
        setSnapshot({
          session, contextKey, phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => { generation.current++; };
  }, [primary, session, contextKey, provisionerId, profileFallback, devBootstrap, profileId, refreshId, signedOwnerRequired]);

  const create = useCallback(async () => {
    if (signedOwnerRequired || !primary || !session || !provisionerId || runningRef.current ||
        phase !== 'empty' || profileFallback || devBootstrap) return;
    const ticket = generation.current;
    runningRef.current = true;
    setBusy(true);
    setSnapshot({ session, contextKey, phase: 'empty', message: null });
    try {
      // Bind a pending ID to the exact service/profile/session. On uncertain
      // acknowledgement, reuse only within that same authority context.
      let workspaceId = pendingIdForContext(pendingIntentRef.current, session, contextKey);
      if (!workspaceId) {
        workspaceId = generateWorkspaceId();
        pendingIntentRef.current = { session, contextKey, workspaceId };
      }
      const result = await connectKernel({ serviceId: provisionerId,
        requiredLevels: ['T1'], ...(devBootstrap ? { bootstrap: devBootstrap } : {}) });
      if (result.status !== 'ready' ||
          result.session.service?.service_id !== provisionerId ||
          result.session.mode !== 'full') {
        throw new Error('T2_FIRST_RUN_PROVISIONER_SESSION_DENIED');
      }
      const provisioner = sessionApi(result.session);
      await provisionFirstRunWorkspace({
        primary, provisioner, workspaceId, profile: profileId,
      });
      if (ticket !== generation.current) return;
      pendingIntentRef.current = null;
      setSnapshot({ session, contextKey, phase: 'ready', message: null });
    } catch (error) {
      if (ticket !== generation.current) return;
      setSnapshot({
        session, contextKey, phase: 'empty',
        message: error instanceof Error ? error.message : String(error),
      });
      // No success claim, automatic retry, or second workspace ID.
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  }, [primary, session, provisionerId, phase, contextKey, profileFallback, devBootstrap, profileId, signedOwnerRequired]);

  // The real signed owner selects and authorizes its Workspace. A first-run
  // T2 provisioner must not independently enumerate or create subject data.
  if (signedOwnerRequired) return <>{children}</>;
  if (selection.status === 'disabled') return <>{children}</>;
  if (selection.status === 'blocked') return (
    <div role="alert" data-testid="t2-first-run-blocked" className="p-6 text-amber-300">
      T2 Capability Control Plane / first-run: {selection.reason}. No provisioning attempted.
    </div>
  );
  if (!session) return (
    <div role="status" data-testid="t2-first-run-kernel-pending" className="p-6 text-slate-300">
      Kernel session is not ready. First-run actions are unavailable.
    </div>
  );
  if (devBootstrap) return (
    <div role="alert" data-testid="t2-first-run-mock-denied" className="p-6 text-amber-300">
      T2 first-run requires the real Kernel. Development mock bootstrap is not qualified.
    </div>
  );
  if (profileFallback) return (
    <div role="alert" className="p-6 text-amber-300">
      T2 first-run blocked: workspace profile is in fallback mode.
    </div>
  );
  if (phase === 'ready') return <>{children}</>;
  if (phase === 'checking') return <p role="status" className="p-6">T2: checking existing workspaces...</p>;
  return (
    <div className="mx-auto max-w-xl p-6 space-y-4" data-testid="t2-first-run-gate">
      <h1 className="text-lg font-semibold">
        {'\u041f\u0435\u0440\u0432\u044b\u0439 \u0437\u0430\u043f\u0443\u0441\u043a Workspace'}
      </h1>
      <p className="text-sm text-slate-300">
        {phase === 'empty'
          ? '\u0420\u0430\u0431\u043e\u0447\u0438\u0445 \u043e\u0431\u043b\u0430\u0441\u0442\u0435\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442. \u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435 \u0442\u0440\u0435\u0431\u0443\u0435\u0442 \u0432\u0430\u0448\u0435\u0433\u043e \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f.'
          : 'Workspace discovery denied. Correct Kernel authorization before creating anything.'}
      </p>
      {message && <p role="alert" className="text-sm text-red-300">{message}</p>}
      {phase === 'empty' ? (
        <button type="button" onClick={() => void create()} disabled={busy}
          data-testid="t2-first-run-create" className="rounded bg-emerald-800 px-4 py-3 text-sm disabled:opacity-50">
          {busy ? '\u0421\u043e\u0437\u0434\u0430\u043d\u0438\u0435...' : '\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0440\u0430\u0431\u043e\u0447\u0443\u044e \u043e\u0431\u043b\u0430\u0441\u0442\u044c'}
        </button>
      ) : (
        <button type="button" onClick={() => setRefreshId(n => n + 1)}
          className="rounded bg-slate-800 px-4 py-3 text-sm">
          {'\u041f\u043e\u0432\u0442\u043e\u0440\u0438\u0442\u044c \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0443'}
        </button>
      )}
    </div>
  );
}
