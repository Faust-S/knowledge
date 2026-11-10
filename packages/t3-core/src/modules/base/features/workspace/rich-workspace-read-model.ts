import type {
  EventRecord,
  ObjectRecord,
  WorkspaceRecord,
} from "../../../../kernel-client/contracts/runtime-1.3.0";
import type { WorkspaceProfileDefinition } from "../../../../profiles/definition";
import { isSafeOpaqueId } from "../../../../shell/routing";
import { compareWorkspaceDatesDesc } from "../workspaces/workspace-format";
import { isWorkspaceViewStateObjectRecord } from "./workspace-view-state-boundary.mjs";

/**
 * G4-S1 is a read projection only. None of the shapes in this file are
 * persisted and none are new Runtime/Workspace contract DTOs.
 */
export interface RichWorkspaceLogicalArea {
  id: string;
  title: string;
  description?: string;
  schemaIds: readonly string[];
  objectIds: readonly string[];
  objectCount: number;
  isCatchAll: boolean;
}

export interface RichWorkspaceTimelineEntry {
  eventId: string;
  eventType: string;
  workspaceId: string;
  serviceId: string;
  objectId?: string;
  revision?: number;
  occurredAt: string;
  causationId?: string;
  correlationId?: string;
  /** Runtime 1.2 exposes occurred_at only; do not fabricate bitemporal refs. */
  effectiveTimeStatus: "UNAVAILABLE_IN_RUNTIME_1_2";
  knowledgeTimeStatus: "UNAVAILABLE_IN_RUNTIME_1_2";
}

export interface RichWorkspaceSavedViewPreview {
  id: string;
  title: string;
  logicalAreaId: string;
  objectIds: readonly string[];
  persisted: false;
  source: "PROFILE_SECTION_DERIVED";
}

export interface PreparedCreationDescriptor {
  ownerComponent: string;
  ownerOperation: string;
  inputSchema: string;
  logicalAreaId: string;
  snapshotFingerprint: string;
}

export type PreparedCreationPreview =
  | { status: "UNAVAILABLE"; execute: false; reason: string }
  | {
      status: "READY_PREVIEW_ONLY" | "STALE";
      execute: false;
      ownerComponent: string;
      ownerOperation: string;
      inputSchema: string;
      logicalAreaId: string;
      snapshotFingerprint: string;
      reason?: string;
    };

export interface RichWorkspaceReadModel {
  workspaceId: string;
  profileId: string;
  snapshotFingerprint: string;
  metadata: {
    createdAt: string;
    updatedAt: string;
    readOnly: boolean;
    objectCount: number;
    eventCount: number;
  };
  logicalAreas: readonly RichWorkspaceLogicalArea[];
  savedViewPreviews: readonly RichWorkspaceSavedViewPreview[];
  timeline: readonly RichWorkspaceTimelineEntry[];
  rejectedObjectCount: number;
  rejectedEventCount: number;
  preparedCreation: PreparedCreationPreview;
  semanticBoundary: {
    displayOrder: "occurred_at_DESC,event_id_ASC";
    displayOrderAuthority: "NON_AUTHORITATIVE_UI_ONLY";
    semanticOrder: "CAUSAL_PARTIAL_ORDER_NOT_LINEARIZED_BY_UI";
    effectiveKnowledgeTime: "NOT_FABRICATED";
  };
}

function stableCompare(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function safeToken(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f]/u.test(value);
}

function isScopedBusinessObject(object: ObjectRecord, workspaceId: string): boolean {
  return object.workspace_id === workspaceId
    && isSafeOpaqueId(object.object_id)
    && !isWorkspaceViewStateObjectRecord(object);
}

export function buildRichWorkspaceSnapshotFingerprint(input: {
  workspace: WorkspaceRecord;
  objects: readonly ObjectRecord[];
  events: readonly EventRecord[];
  profileDefinition: WorkspaceProfileDefinition;
}): string {
  const { workspace, objects, events, profileDefinition } = input;
  const objectRefs = objects
    .filter((o) => isScopedBusinessObject(o, workspace.workspace_id))
    .map((o) => `${o.object_id}@${o.revision}`)
    .sort(stableCompare);
  const eventRefs = events
    .filter((e) => e.workspace_id === workspace.workspace_id)
    .map((e) => `${e.event_id}@${e.revision ?? "-"}@${e.occurred_at}`)
    .sort(stableCompare);
  const areaRefs = profileDefinition.sections
    .map((s) => `${s.id}:${[...s.schemaIds].sort(stableCompare).join(",")}`)
    .sort(stableCompare);
  return JSON.stringify([
    workspace.workspace_id,
    workspace.profile,
    workspace.updated_at,
    objectRefs,
    eventRefs,
    areaRefs,
  ]);
}

function buildLogicalAreas(
  workspaceId: string,
  objects: readonly ObjectRecord[],
  profileDefinition: WorkspaceProfileDefinition,
): RichWorkspaceLogicalArea[] {
  const clean = objects.filter((o) => isScopedBusinessObject(o, workspaceId));
  return profileDefinition.sections.map((section) => {
    const catchAll = section.schemaIds.length === 0;
    const members = clean
      .filter((o) => catchAll || section.schemaIds.includes(o.schema_id))
      .map((o) => o.object_id)
      .sort(stableCompare);
    return {
      id: section.id,
      title: section.title,
      description: section.description,
      schemaIds: [...section.schemaIds],
      objectIds: members,
      objectCount: members.length,
      isCatchAll: catchAll,
    };
  });
}

function buildTimeline(
  workspaceId: string,
  events: readonly EventRecord[],
): { entries: RichWorkspaceTimelineEntry[]; rejected: number } {
  const entries: RichWorkspaceTimelineEntry[] = [];
  let rejected = 0;
  for (const event of events) {
    if (
      event.workspace_id !== workspaceId ||
      !safeToken(event.event_id) ||
      !safeToken(event.event_type) ||
      (event.object_id !== undefined && !isSafeOpaqueId(event.object_id))
    ) {
      rejected += 1;
      continue;
    }
    entries.push({
      eventId: event.event_id,
      eventType: event.event_type,
      workspaceId: event.workspace_id,
      serviceId: event.service_id,
      objectId: event.object_id,
      revision: event.revision,
      occurredAt: event.occurred_at,
      causationId: event.causation_id,
      correlationId: event.correlation_id,
      effectiveTimeStatus: "UNAVAILABLE_IN_RUNTIME_1_2",
      knowledgeTimeStatus: "UNAVAILABLE_IN_RUNTIME_1_2",
    });
  }
  entries.sort((a, b) => {
    const byTime = compareWorkspaceDatesDesc(a.occurredAt, b.occurredAt);
    return byTime !== 0 ? byTime : stableCompare(a.eventId, b.eventId);
  });
  return { entries, rejected };
}

export function validatePreparedCreationPreview(input: {
  descriptor?: PreparedCreationDescriptor | null;
  currentSnapshotFingerprint: string;
  knownLogicalAreaIds: readonly string[];
}): PreparedCreationPreview {
  const { descriptor, currentSnapshotFingerprint, knownLogicalAreaIds } = input;
  if (!descriptor) {
    return {
      status: "UNAVAILABLE",
      execute: false,
      reason: "OWNER_OPERATION_AND_INPUT_SCHEMA_NOT_DECLARED",
    };
  }
  if (
    typeof descriptor !== "object" ||
    Array.isArray(descriptor) ||
    !safeToken(descriptor.ownerComponent) ||
    !safeToken(descriptor.ownerOperation) ||
    !safeToken(descriptor.inputSchema) ||
    !safeToken(descriptor.logicalAreaId) ||
    typeof descriptor.snapshotFingerprint !== "string" ||
    descriptor.snapshotFingerprint.length === 0 ||
    !knownLogicalAreaIds.includes(descriptor.logicalAreaId)
  ) {
    return {
      status: "UNAVAILABLE",
      execute: false,
      reason: "INVALID_OR_UNSCOPED_DECLARATIVE_DESCRIPTOR",
    };
  }
  const base = {
    execute: false as const,
    ownerComponent: descriptor.ownerComponent,
    ownerOperation: descriptor.ownerOperation,
    inputSchema: descriptor.inputSchema,
    logicalAreaId: descriptor.logicalAreaId,
    snapshotFingerprint: descriptor.snapshotFingerprint,
  };
  if (descriptor.snapshotFingerprint !== currentSnapshotFingerprint) {
    return {
      ...base,
      status: "STALE",
      reason: "AUTHORITY_SNAPSHOT_CHANGED_REVALIDATION_REQUIRED",
    };
  }
  return { ...base, status: "READY_PREVIEW_ONLY" };
}

export function buildRichWorkspaceReadModel(input: {
  workspace: WorkspaceRecord;
  objects: readonly ObjectRecord[];
  events: readonly EventRecord[];
  profileDefinition: WorkspaceProfileDefinition;
  preparedCreationDescriptor?: PreparedCreationDescriptor | null;
}): RichWorkspaceReadModel {
  const { workspace, objects, events, profileDefinition } = input;
  const scopedSafeObjects = objects.filter(
    (o) => o.workspace_id === workspace.workspace_id && isSafeOpaqueId(o.object_id),
  );
  const cleanObjects = scopedSafeObjects.filter((o) => !isWorkspaceViewStateObjectRecord(o));
  const logicalAreas = buildLogicalAreas(
    workspace.workspace_id,
    cleanObjects,
    profileDefinition,
  );
  const timeline = buildTimeline(workspace.workspace_id, events);
  const snapshotFingerprint = buildRichWorkspaceSnapshotFingerprint({
    workspace,
    objects: cleanObjects,
    events: timeline.entries.map((e) => ({
      event_id: e.eventId,
      event_type: e.eventType,
      workspace_id: e.workspaceId,
      service_id: e.serviceId,
      object_id: e.objectId,
      revision: e.revision,
      occurred_at: e.occurredAt,
      causation_id: e.causationId,
      correlation_id: e.correlationId,
      payload: null,
    })),
    profileDefinition,
  });
  return {
    workspaceId: workspace.workspace_id,
    profileId: workspace.profile,
    snapshotFingerprint,
    metadata: {
      createdAt: workspace.created_at,
      updatedAt: workspace.updated_at,
      readOnly: workspace.read_only === true,
      objectCount: cleanObjects.length,
      eventCount: timeline.entries.length,
    },
    logicalAreas,
    savedViewPreviews: logicalAreas.map((area) => ({
      id: `profile-section:${area.id}`,
      title: area.title,
      logicalAreaId: area.id,
      objectIds: area.objectIds,
      persisted: false as const,
      source: "PROFILE_SECTION_DERIVED" as const,
    })),
    timeline: timeline.entries,
    rejectedObjectCount: objects.length - scopedSafeObjects.length,
    rejectedEventCount: timeline.rejected,
    preparedCreation: validatePreparedCreationPreview({
      descriptor: input.preparedCreationDescriptor,
      currentSnapshotFingerprint: snapshotFingerprint,
      knownLogicalAreaIds: logicalAreas.map((a) => a.id),
    }),
    semanticBoundary: {
      displayOrder: "occurred_at_DESC,event_id_ASC",
      displayOrderAuthority: "NON_AUTHORITATIVE_UI_ONLY",
      semanticOrder: "CAUSAL_PARTIAL_ORDER_NOT_LINEARIZED_BY_UI",
      effectiveKnowledgeTime: "NOT_FABRICATED",
    },
  };
}

export function queryRichWorkspaceObjects(input: {
  workspaceId: string;
  objects: readonly ObjectRecord[];
  logicalAreas: readonly RichWorkspaceLogicalArea[];
  query: string;
  logicalAreaId?: string | null;
}): ObjectRecord[] {
  const q = input.query.trim().toLocaleLowerCase("ru-RU");
  const hasAreaFilter = input.logicalAreaId !== undefined && input.logicalAreaId !== null;
  const area = hasAreaFilter
    ? input.logicalAreas.find((a) => a.id === input.logicalAreaId)
    : null;
  // An unknown requested target is not permission to broaden the query.
  if (hasAreaFilter && !area) return [];
  const allowed = area ? new Set(area.objectIds) : null;
  return input.objects
    .filter(
      (o) =>
        isScopedBusinessObject(o, input.workspaceId) &&
        (!allowed || allowed.has(o.object_id)),
    )
    .filter((o) => {
      if (!q) return true;
      return (
        o.object_id.toLocaleLowerCase("ru-RU").includes(q) ||
        o.schema_id.toLocaleLowerCase("ru-RU").includes(q)
      );
    })
    .sort((a, b) => stableCompare(a.object_id, b.object_id));
}

/** Persisted internal Workspace view-state projected for Rich Workspace UI. */
export function buildPersistedWorkspaceSavedViewId(input: {
  workspaceId: string;
  profileId: string;
  name: string;
}): string {
  const seed = `${input.workspaceId}\u0000${input.profileId}\u0000${input.name.trim().toLowerCase()}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `view-${hash.toString(16).padStart(8, "0")}`;
}

export interface PersistedWorkspaceSavedView {
  objectId: string;
  revision: number;
  viewId: string;
  name: string;
  profileId: string;
  logicalAreaId: string | null;
  query: string;
}

export function parsePersistedWorkspaceSavedView(
  object: ObjectRecord,
): PersistedWorkspaceSavedView | null {
  if (object.schema_id !== "iwxa.workspace.internal.saved-view") return null;
  const data = object.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (data.version !== 1) return null;
  if (typeof data.view_id !== "string" || !isSafeOpaqueId(data.view_id)) return null;
  if (typeof data.name !== "string" || data.name.trim().length < 1 || data.name.trim().length > 120) return null;
  if (typeof data.profile_id !== "string" || data.profile_id.length < 1 || data.profile_id.length > 64) return null;
  if (data.logical_area_id !== null &&
      (typeof data.logical_area_id !== "string" || !isSafeOpaqueId(data.logical_area_id))) return null;
  if (typeof data.query !== "string" || data.query.length > 1000) return null;
  return {
    objectId: object.object_id,
    revision: object.revision,
    viewId: data.view_id,
    name: data.name.trim(),
    profileId: data.profile_id,
    logicalAreaId: data.logical_area_id as string | null,
    query: data.query,
  };
}

export function projectPersistedWorkspaceSavedViews(input: {
  workspaceId: string;
  profileId: string;
  objects: readonly ObjectRecord[];
}): PersistedWorkspaceSavedView[] {
  return input.objects
    .filter((object) => object.workspace_id === input.workspaceId)
    .map(parsePersistedWorkspaceSavedView)
    .filter((view): view is PersistedWorkspaceSavedView => Boolean(view))
    .filter((view) => view.profileId === input.profileId)
    .sort((a, b) => stableCompare(a.name, b.name) || stableCompare(a.viewId, b.viewId));
}
