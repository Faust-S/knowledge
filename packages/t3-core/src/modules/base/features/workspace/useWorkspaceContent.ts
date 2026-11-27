/**
 * React hook — the only data controller for a single Workspace surface.
 *
 * Load order (Baseline 1.2):
 *   1. `t1.getWorkspace(workspace_id)` → `WorkspaceRecord | null`.
 *   2. Validate `workspace_id` on the returned record (identity guard).
 *   3. Read `workspace.profile` and activate the profile module.
 *   4. Only AFTER a matching profile is ready, call `t1.listObjects`
 *      and `t1.listEventsSince` on independent axes.
 *
 * Invariants:
 *   - `generation` bumps at the START of every context effect, BEFORE
 *     any early return; no stale response can leak into new state.
 *   - Session / workspaceId / capability change clears every payload.
 *   - `null` from `getWorkspace` maps to `workspaceState = "not-found"`
 *     and blocks any object/event fetch.
 *   - Integrity mismatches on `listObjects` records are surfaced as
 *     warnings and never rendered.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EventRecord,
  ObjectRecord,
  WorkspaceRecord,
} from "../../../../kernel-client";
import type { KernelFacade } from "../../../../workspace-contract";
import { isSafeOpaqueId } from "../../../../shell/routing";
import { useWorkspaceProfile } from "./useWorkspaceProfile";
import type {
  EventIntegrityWarning,
  LoadState,
  ObjectIntegrityWarning,
  WorkspaceContentController,
  WorkspaceRecordState,
} from "./content-types";
import { sortWorkspaceObjects } from "./workspace-object-sort";

export interface UseWorkspaceContentOptions {
  kernel: KernelFacade | null;
  workspaceId: string;
  /** The standard Workspace surface requests the full journal only on demand.
   * Other existing callers retain the previous automatic read behavior.
   */
  deferEvents?: boolean;
}

const EMPTY_OBJECTS: readonly ObjectRecord[] = Object.freeze([]);
const EMPTY_EVENTS: readonly EventRecord[] = Object.freeze([]);
const EMPTY_WARNINGS: readonly ObjectIntegrityWarning[] = Object.freeze([]);
const EMPTY_EVENT_WARNINGS: readonly EventIntegrityWarning[] = Object.freeze([]);

function safeEventToken(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && !/[\u0000-\u001f]/u.test(value);
}

export function useWorkspaceContent(
  options: UseWorkspaceContentOptions,
): WorkspaceContentController {
  const { kernel, workspaceId, deferEvents = false } = options;

  const [requestScope, setRequestScope] = useState<{ kernel: KernelFacade | null; workspaceId: string } | null>(null);
  const scopeMatches = requestScope?.kernel === kernel && requestScope.workspaceId === workspaceId;
  const [workspaceState, setWorkspaceState] =
    useState<WorkspaceRecordState>("idle");
  const [workspace, setWorkspace] = useState<WorkspaceRecord | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [objectsState, setObjectsState] = useState<LoadState>("idle");
  const [objects, setObjects] = useState<readonly ObjectRecord[]>(EMPTY_OBJECTS);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [objectIntegrityWarnings, setObjectIntegrityWarnings] =
    useState<readonly ObjectIntegrityWarning[]>(EMPTY_WARNINGS);

  const [eventsState, setEventsState] = useState<LoadState>("idle");
  const [events, setEvents] = useState<readonly EventRecord[]>(EMPTY_EVENTS);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [eventIntegrityWarnings, setEventIntegrityWarnings] =
    useState<readonly EventIntegrityWarning[]>(EMPTY_EVENT_WARNINGS);

  const generation = useRef(0);
  const objectRequestSequence = useRef(0);
  const eventRequestSequence = useRef(0);

  // ---- Workspace record load ---------------------------------------------
  useEffect(() => {
    const gen = ++generation.current;

    setRequestScope({ kernel, workspaceId });
    setWorkspace(null);
    setWorkspaceError(null);
    setObjects(EMPTY_OBJECTS);
    setObjectsError(null);
    setObjectIntegrityWarnings(EMPTY_WARNINGS);
    setObjectsState("idle");
    setEvents(EMPTY_EVENTS);
    setEventsError(null);
    setEventIntegrityWarnings(EMPTY_EVENT_WARNINGS);
    setEventsState("idle");

    if (!kernel) {
      setWorkspaceState("idle");
      return;
    }
    if (!kernel.hasOperation("t1.getWorkspace")) {
      setWorkspaceState("unavailable");
      return;
    }
    setWorkspaceState("loading");
    (async () => {
      try {
        const w = await kernel.getWorkspace(workspaceId);
        if (gen !== generation.current) return;
        if (w == null) {
          setWorkspace(null);
          setWorkspaceState("not-found");
          return;
        }
        if (w.workspace_id !== workspaceId) {
          setWorkspace(null);
          setWorkspaceError(
            "Kernel returned a WorkspaceRecord for a different workspace_id",
          );
          setWorkspaceState("error");
          return;
        }
        setWorkspace(w);
        setWorkspaceState("ready");
      } catch (e) {
        if (gen !== generation.current) return;
        setWorkspaceError(e instanceof Error ? e.message : String(e));
        setWorkspaceState("error");
      }
    })();
    return () => {
      // An unmounted surface must not publish any outstanding readback.
      if (generation.current === gen) generation.current += 1;
    };
  }, [kernel, workspaceId]);

  const rawProfile = scopeMatches ? workspace?.profile ?? null : null;
  const profile = useWorkspaceProfile(rawProfile);

  const profileMatchesWorkspace =
    rawProfile !== null && profile.requestedProfile === rawProfile;

  const profileReadyForData =
    scopeMatches && workspaceState === "ready" && workspace?.workspace_id === workspaceId &&
    profileMatchesWorkspace &&
    (profile.status === "ready" || profile.status === "fallback");

  const doLoadObjects = useCallback(async () => {
    const requestSequence = ++objectRequestSequence.current;
    if (!kernel) return;
    if (!kernel.hasOperation("t1.listObjects")) {
      setObjectsState("unavailable");
      setObjects(EMPTY_OBJECTS);
      setObjectsError(null);
      setObjectIntegrityWarnings(EMPTY_WARNINGS);
      return;
    }
    if (!profileReadyForData) return;
    const gen = generation.current;
    setObjectsState("loading");
    setObjectsError(null);
    try {
      const raw = await kernel.listObjects({
        workspace_id: workspaceId,
        include_deleted: false,
      });
      if (gen !== generation.current || requestSequence !== objectRequestSequence.current) return;
      const alive = raw.filter((o) => !o.deleted);
      const warnings: ObjectIntegrityWarning[] = [];
      const clean: ObjectRecord[] = [];
      const acceptedObjectIds = new Set<string>();
      const duplicateObjectIds = new Set<string>();
      for (const o of alive) {
        if (o.workspace_id !== workspaceId) {
          warnings.push({ objectId: o.object_id, reason: "workspace-mismatch" });
          continue;
        }
        if (!isSafeOpaqueId(o.object_id)) {
          warnings.push({ objectId: o.object_id, reason: "unsafe-object-id" });
          continue;
        }
        if (acceptedObjectIds.has(o.object_id)) {
          duplicateObjectIds.add(o.object_id);
          warnings.push({ objectId: o.object_id, reason: "duplicate-object-id" });
          continue;
        }
        acceptedObjectIds.add(o.object_id);
        clean.push(o);
      }
      if (duplicateObjectIds.size > 0) {
        // Preserve the diagnostic order and refuse every conflicting identity.
        // Do not splice an array repeatedly: duplicated data must not create
        // quadratic work during a large Workspace read.
        for (let index = clean.length - 1; index >= 0; index -= 1) {
          if (!duplicateObjectIds.has(clean[index].object_id)) continue;
          warnings.push({ objectId: clean[index].object_id, reason: "duplicate-object-id" });
        }
      }
      const admitted = duplicateObjectIds.size > 0
        ? clean.filter(object => !duplicateObjectIds.has(object.object_id)) : clean;
      setObjects(sortWorkspaceObjects(admitted));
      setObjectIntegrityWarnings(warnings.length ? warnings : EMPTY_WARNINGS);
      setObjectsState("ready");
    } catch (e) {
      if (gen !== generation.current || requestSequence !== objectRequestSequence.current) return;
      setObjectsError(e instanceof Error ? e.message : String(e));
      setObjectsState("error");
    }
  }, [kernel, workspaceId, profileReadyForData]);

  const doLoadEvents = useCallback(async () => {
    const requestSequence = ++eventRequestSequence.current;
    if (!kernel) return;
    if (!kernel.hasOperation("t1.listEventsSince")) {
      setEventsState("unavailable");
      setEvents(EMPTY_EVENTS);
      setEventsError(null);
      setEventIntegrityWarnings(EMPTY_EVENT_WARNINGS);
      return;
    }
    if (!profileReadyForData) return;
    const gen = generation.current;
    setEventsState("loading");
    setEventsError(null);
    try {
      const es = await kernel.listEventsSince(workspaceId);
      if (gen !== generation.current || requestSequence !== eventRequestSequence.current) return;
      const warnings: EventIntegrityWarning[] = [];
      const clean: EventRecord[] = [];
      const acceptedEventIds = new Set<string>();
      const duplicateEventIds = new Set<string>();
      for (const event of es) {
        const eventId = typeof event?.event_id === "string" ? event.event_id : String(event?.event_id ?? "");
        let reason: EventIntegrityWarning["reason"] | null = null;
        if (event?.workspace_id !== workspaceId) reason = "workspace-mismatch";
        else if (!safeEventToken(event.event_id)) reason = "unsafe-event-id";
        else if (!safeEventToken(event.event_type)) reason = "invalid-event-type";
        else if (!safeEventToken(event.service_id)) reason = "invalid-service-id";
        else if (event.object_id !== undefined && !isSafeOpaqueId(event.object_id)) reason = "unsafe-object-id";
        else if (event.revision !== undefined && (!Number.isInteger(event.revision) || event.revision < 0)) reason = "invalid-revision";
        else if (typeof event.occurred_at !== "string" || !Number.isFinite(Date.parse(event.occurred_at))) reason = "invalid-occurred-at";
        if (reason) {
          warnings.push({ eventId, reason });
          continue;
        }
        if (acceptedEventIds.has(event.event_id)) {
          duplicateEventIds.add(event.event_id);
          warnings.push({ eventId: event.event_id, reason: "duplicate-event-id" });
          continue;
        }
        acceptedEventIds.add(event.event_id);
        clean.push(event);
      }
      if (duplicateEventIds.size > 0) {
        for (let index = clean.length - 1; index >= 0; index -= 1) {
          if (!duplicateEventIds.has(clean[index].event_id)) continue;
          warnings.push({ eventId: clean[index].event_id, reason: "duplicate-event-id" });
        }
      }
      const admitted = duplicateEventIds.size > 0
        ? clean.filter(event => !duplicateEventIds.has(event.event_id)) : clean;
      setEvents(Object.freeze(admitted));
      setEventIntegrityWarnings(warnings.length ? Object.freeze(warnings) : EMPTY_EVENT_WARNINGS);
      setEventsState("ready");
    } catch (e) {
      if (gen !== generation.current || requestSequence !== eventRequestSequence.current) return;
      setEventsError(e instanceof Error ? e.message : String(e));
      setEvents(EMPTY_EVENTS);
      setEventIntegrityWarnings(EMPTY_EVENT_WARNINGS);
      setEventsState("error");
    }
  }, [kernel, workspaceId, profileReadyForData]);

  useEffect(() => { void doLoadObjects(); }, [doLoadObjects]);
  useEffect(() => {
    // In deferred mode still surface lack of permission, not an empty journal.
    // A manual refreshEvents is the only path to the full authorized history.
    if (!deferEvents || (kernel && !kernel.hasOperation("t1.listEventsSince"))) {
      void doLoadEvents();
    }
  }, [doLoadEvents, deferEvents, kernel]);

  return useMemo<WorkspaceContentController>(
    () => ({
      // Render-time scope fence: effects clear state after a render. Never
      // expose the old Workspace, even when a new session uses the same ID.
      workspaceState: scopeMatches ? workspaceState : "idle",
      workspace: scopeMatches ? workspace : null,
      workspaceError: scopeMatches ? workspaceError : null,
      profile,
      objectsState: scopeMatches ? objectsState : "idle",
      objects: scopeMatches ? objects : EMPTY_OBJECTS,
      objectsError: scopeMatches ? objectsError : null,
      objectIntegrityWarnings: scopeMatches ? objectIntegrityWarnings : EMPTY_WARNINGS,
      eventsState: scopeMatches ? eventsState : "idle",
      events: scopeMatches ? events : EMPTY_EVENTS,
      eventsError: scopeMatches ? eventsError : null,
      eventIntegrityWarnings: scopeMatches ? eventIntegrityWarnings : EMPTY_EVENT_WARNINGS,
      refreshObjects: doLoadObjects,
      refreshEvents: doLoadEvents,
    }),
    [
      scopeMatches, workspaceState, workspace, workspaceError,
      profile,
      objectsState, objects, objectsError, objectIntegrityWarnings,
      eventsState, events, eventsError, eventIntegrityWarnings,
      doLoadObjects, doLoadEvents,
    ],
  );
}
