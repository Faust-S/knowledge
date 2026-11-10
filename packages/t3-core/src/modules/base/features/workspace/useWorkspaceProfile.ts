/**
 * React hook that resolves the effective profile for a Workspace.
 *
 * Behaviour matrix:
 *   - null raw profile              → status: "idle"
 *   - unknown raw profile string    → status: "fallback" using generic
 *   - known + activation succeeds   → status: "ready"
 *   - known + activation fails      → status: "error"
 */
import { useEffect, useState } from "react";
import { activateProfile } from "../../../../config/profile-loader";
import {
  IDLE_WORKSPACE_PROFILE_STATE,
  isKnownWorkspaceProfileId,
  type WorkspaceProfileState,
} from "./workspace-profile";
import { getGenericProfileDefinition } from "../../../../profiles/definition-registry";

export function useWorkspaceProfile(
  rawProfile: string | null,
): WorkspaceProfileState {
  const [state, setState] = useState<WorkspaceProfileState>(
    IDLE_WORKSPACE_PROFILE_STATE,
  );

  useEffect(() => {
    if (rawProfile == null) {
      setState(IDLE_WORKSPACE_PROFILE_STATE);
      return;
    }
    let cancelled = false;
    setState({
      status: "loading",
      requestedProfile: rawProfile,
      activeProfileId: null,
      definition: null,
      error: null,
    });

    const known = isKnownWorkspaceProfileId(rawProfile);
    const target = known ? rawProfile : "generic";

    (async () => {
      try {
        const active = await activateProfile(target);
        if (cancelled) return;
        if (!known) {
          setState({
            status: "fallback",
            requestedProfile: rawProfile,
            activeProfileId: "generic",
            definition: active.definition,
            error: null,
          });
          return;
        }
        setState({
          status: active.fallback ? "fallback" : "ready",
          requestedProfile: rawProfile,
          activeProfileId: active.definition.id,
          definition: active.definition,
          error: null,
        });
      } catch (e) {
        if (cancelled) return;
        // Best-effort recovery: try generic so the shell still renders.
        try {
          const generic = getGenericProfileDefinition();
          setState({
            status: "fallback",
            requestedProfile: rawProfile,
            activeProfileId: "generic",
            definition: generic,
            error: e instanceof Error ? e.message : String(e),
          });
        } catch {
          setState({
            status: "error",
            requestedProfile: rawProfile,
            activeProfileId: null,
            definition: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawProfile]);

  return state;
}
