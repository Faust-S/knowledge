/**
 * Host UI state boundary for first-run onboarding. A 'ready' decision from
 * another Kernel session or domain/profile may never unlock this Host.
 */
export type FirstRunPhase = 'checking' | 'empty' | 'ready' | 'error';
export interface FirstRunSnapshot {
  session: object | null;
  contextKey: string;
  phase: FirstRunPhase;
  message: string | null;
}
export interface PendingWorkspaceIntent {
  session: object;
  contextKey: string;
  workspaceId: string;
}
export function firstRunView(
  snapshot: FirstRunSnapshot,
  liveSession: object | null,
  liveContextKey: string,
): { phase: FirstRunPhase; message: string | null } {
  if (!liveSession || snapshot.session !== liveSession || snapshot.contextKey !== liveContextKey) {
    return { phase: 'checking', message: null };
  }
  return { phase: snapshot.phase, message: snapshot.message };
}
export function pendingIdForContext(
  intent: PendingWorkspaceIntent | null,
  liveSession: object,
  liveContextKey: string,
): string | null {
  return intent && intent.session === liveSession && intent.contextKey === liveContextKey
    ? intent.workspaceId : null;
}
