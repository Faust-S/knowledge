/**
 * React hook — the single data controller for the Object detail surface.
 *
 * T2-03D invariants:
 *   - `generation` bumps at the START of the context effect, BEFORE any
 *     early return. No stale response can ever resurrect old state after
 *     a session/workspace/object switch.
 *   - Context change wipes summary + detail payload immediately.
 *   - Object payload gated on `profileMatchesWorkspace` — never trust a
 *     profile hook still holding the previous Workspace's state.
 *   - Every `getObject` result is validated against the requested
 *     `(workspace_id, object_id)` identity. Mismatch → object-error.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EventRecord,
  ObjectWithRelations,
  WorkspaceRecord,
} from "../../../../kernel-client";
import type { KernelFacade } from "../../../../workspace-contract";
import { useWorkspaceProfile } from "../workspace/useWorkspaceProfile";
import {
  checkDetailIntegrity,
  OBJECT_INTEGRITY_ERROR_MESSAGE,
} from "./object-integrity";
import type {
  EventsStatus,
  ObjectDetailController,
  ObjectViewStatus,
} from "./object-detail-types";

export interface UseObjectDetailOptions {
  kernel: KernelFacade | null;
  workspaceId: string;
  objectId: string;
}

const EMPTY_EVENTS: readonly EventRecord[] = Object.freeze([]);

export function useObjectDetail(
  opts: UseObjectDetailOptions,
): ObjectDetailController {
  const { kernel, workspaceId, objectId } = opts;

  const [wsState, setWsState] = useState<
    "idle" | "loading" | "ready" | "unavailable" | "not-found" | "error"
  >("idle");
  const [workspace, setWorkspace] =
    useState<WorkspaceRecord | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [objectState, setObjectState] = useState<
    "idle" | "unavailable" | "loading" | "ready" | "not-found" | "error"
  >("idle");
  const [detail, setDetail] = useState<ObjectWithRelations | null>(null);
  const [objectError, setObjectError] = useState<string | null>(null);

  const [eventsStatus, setEventsStatus] = useState<EventsStatus>("idle");
  const [events, setEvents] = useState<readonly EventRecord[]>(EMPTY_EVENTS);
  const [eventsError, setEventsError] = useState<string | null>(null);

  const generation = useRef(0);

  // ---- Workspace record ---------------------------------------------------
  useEffect(() => {
    const gen = ++generation.current;
    setWorkspace(null);
    setWorkspaceError(null);
    setDetail(null);
    setObjectError(null);
    setObjectState("idle");
    setEvents(EMPTY_EVENTS);
    setEventsError(null);
    setEventsStatus("idle");

    if (!kernel) {
      setWsState("idle");
      return;
    }
    if (!kernel.hasOperation("t1.getWorkspace")) {
      setWsState("unavailable");
      return;
    }
    setWsState("loading");
    (async () => {
      try {
        const s = await kernel.getWorkspace(workspaceId);
        if (gen !== generation.current) return;
        if (s == null) {
          setWorkspace(null);
          setWsState("not-found");
          return;
        }
        if (s.workspace_id !== workspaceId) {
          setWorkspaceError(
            "Kernel returned a WorkspaceRecord for a different workspace_id",
          );
          setWsState("error");
          return;
        }
        setWorkspace(s);
        setWsState("ready");
      } catch (e) {
        if (gen !== generation.current) return;
        setWorkspaceError(e instanceof Error ? e.message : String(e));
        setWsState("error");
      }
    })();
  }, [kernel, workspaceId, objectId]);

  const rawProfile = workspace?.profile ?? null;
  const profile = useWorkspaceProfile(rawProfile);

  const profileMatchesWorkspace =
    rawProfile !== null && profile.requestedProfile === rawProfile;

  const profileReadyForData =
    profileMatchesWorkspace &&
    (profile.status === "ready" || profile.status === "fallback");
  const isProfileError =
    profileMatchesWorkspace && profile.status === "error";

  // ---- Object fetch -------------------------------------------------------
  const doLoadObject = useCallback(async () => {
    if (!kernel) return;
    if (!kernel.hasOperation("t1.getObject")) {
      setObjectState("unavailable");
      setDetail(null);
      setObjectError(null);
      return;
    }
    if (isProfileError) return;
    if (!profileReadyForData) return;
    const gen = generation.current;
    setObjectState("loading");
    setObjectError(null);
    try {
      const d = await kernel.getObject(workspaceId, objectId);
      if (gen !== generation.current) return;
      if (d == null) {
        setDetail(null);
        setObjectState("not-found");
        return;
      }
      const integrity = checkDetailIntegrity(d, workspaceId, objectId);
      if (!integrity.ok) {
        setDetail(null);
        setObjectError(OBJECT_INTEGRITY_ERROR_MESSAGE);
        setObjectState("error");
        return;
      }
      setDetail(d);
      setObjectState("ready");
    } catch (e) {
      if (gen !== generation.current) return;
      setObjectError(e instanceof Error ? e.message : String(e));
      setObjectState("error");
    }
  }, [kernel, workspaceId, objectId, profileReadyForData, isProfileError]);

  // ---- Events fetch (strictly independent) -------------------------------
  const doLoadEvents = useCallback(async () => {
    if (!kernel) return;
    if (!kernel.hasOperation("t1.listEventsSince")) {
      setEventsStatus("unavailable");
      setEvents(EMPTY_EVENTS);
      setEventsError(null);
      return;
    }
    if (isProfileError) {
      setEventsStatus("unavailable");
      setEvents(EMPTY_EVENTS);
      setEventsError(null);
      return;
    }
    if (!profileReadyForData) return;
    const gen = generation.current;
    setEventsStatus("loading");
    setEventsError(null);
    try {
      const es = await kernel.listEventsSince(workspaceId);
      if (gen !== generation.current) return;
      setEvents(es);
      setEventsStatus("ready");
    } catch (e) {
      if (gen !== generation.current) return;
      setEventsError(e instanceof Error ? e.message : String(e));
      setEventsStatus("error");
    }
  }, [kernel, workspaceId, profileReadyForData, isProfileError]);

  useEffect(() => { void doLoadObject(); }, [doLoadObject]);
  useEffect(() => { void doLoadEvents(); }, [doLoadEvents]);

  // ---- Aggregate status --------------------------------------------------
  const status: ObjectViewStatus = useMemo(() => {
    if (!kernel) return "idle";
    if (wsState === "unavailable") return "workspace-unavailable";
    if (wsState === "not-found") return "workspace-not-found";
    if (wsState === "error") return "workspace-error";
    if (wsState !== "ready") return "loading-workspace";
    // Workspace loaded — but profile hook may still be catching up.
    if (!profileMatchesWorkspace) return "loading-workspace";
    if (profile.status === "loading" || profile.status === "idle") {
      return "loading-workspace";
    }
    if (profile.status === "error") return "profile-error";
    if (objectState === "unavailable") return "object-unavailable";
    if (objectState === "loading" || objectState === "idle") {
      return "loading-object";
    }
    if (objectState === "not-found") return "not-found";
    if (objectState === "error") return "object-error";
    return "ready";
  }, [kernel, wsState, profile.status, profileMatchesWorkspace, objectState]);

  return useMemo<ObjectDetailController>(
    () => ({
      status,
      workspace,
      workspaceError,
      profile,
      detail,
      objectError,
      eventsStatus,
      events,
      eventsError,
      refreshObject: doLoadObject,
      refreshEvents: doLoadEvents,
    }),
    [
      status, workspace, workspaceError,
      profile, detail, objectError,
      eventsStatus, events, eventsError,
      doLoadObject, doLoadEvents,
    ],
  );
}
