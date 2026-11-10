import { describe, expect, it } from "vitest";
import type { EventRecord, ObjectRecord, WorkspaceRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { WorkspaceProfileDefinition } from "../src/profiles/definition";
import {
  buildRichWorkspaceReadModel,
  buildRichWorkspaceSnapshotFingerprint,
  queryRichWorkspaceObjects,
  validatePreparedCreationPreview,
  type PreparedCreationDescriptor,
} from "../src/modules/base/features/workspace/rich-workspace-read-model";

const profile: WorkspaceProfileDefinition = {
  id: "generic",
  label: "Generic",
  description: "fixture",
  logoText: "G",
  accent: "#000000",
  sections: [
    { id: "notes", title: "Notes", schemaIds: ["note"], emptyTitle: "none", emptyDescription: "none" },
    { id: "tasks", title: "Tasks", schemaIds: ["task"], emptyTitle: "none", emptyDescription: "none" },
  ],
  unknownObjectsSection: { title: "Other", description: "Other" },
};

const workspace: WorkspaceRecord = {
  workspace_id: "w",
  profile: "generic",
  capabilities: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-03T00:00:00Z",
};

function object(id: string, schema: string, data: unknown = {}): ObjectRecord {
  return {
    object_id: id,
    workspace_id: "w",
    schema_id: schema,
    schema_version: "1",
    created_by_service: "svc",
    updated_by_service: "svc",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    revision: 1,
    data,
    extensions: {},
  };
}

function event(id: string, at: string, type = "UPDATED"): EventRecord {
  return {
    event_id: id,
    event_type: type,
    workspace_id: "w",
    service_id: "svc",
    object_id: "a",
    occurred_at: at,
    payload: {},
  };
}

describe("G4-S1 rich Workspace read model", () => {
  it("keeps one Workspace identity while projecting N logical areas", () => {
    const model = buildRichWorkspaceReadModel({
      workspace,
      objects: [object("a", "note"), object("b", "task")],
      events: [],
      profileDefinition: profile,
    });
    expect(model.workspaceId).toBe("w");
    expect(model.logicalAreas.map((x) => [x.id, x.objectIds])).toEqual([
      ["notes", ["a"]],
      ["tasks", ["b"]],
    ]);
    expect(model.savedViewPreviews.every((x) => x.persisted === false)).toBe(true);
  });

  it("omnibar searches declared metadata only and never payload", () => {
    const objects = [
      object("visible-id", "note", { secret: "needle-secret" }),
      object("other", "task", { title: "visible-id" }),
    ];
    const model = buildRichWorkspaceReadModel({ workspace, objects, events: [], profileDefinition: profile });
    expect(queryRichWorkspaceObjects({ workspaceId: "w", objects, logicalAreas: model.logicalAreas, query: "needle-secret" })).toEqual([]);
    expect(queryRichWorkspaceObjects({ workspaceId: "w", objects, logicalAreas: model.logicalAreas, query: "note" }).map((o) => o.object_id)).toEqual(["visible-id"]);
    expect(queryRichWorkspaceObjects({ workspaceId: "w", objects, logicalAreas: model.logicalAreas, query: "visible-id" }).map((o) => o.object_id)).toEqual(["visible-id"]);
  });

  it("rejects cross-workspace records and cannot fabricate navigation targets", () => {
    const foreign = { ...object("foreign", "note"), workspace_id: "other" };
    const model = buildRichWorkspaceReadModel({ workspace, objects: [foreign], events: [], profileDefinition: profile });
    expect(model.metadata.objectCount).toBe(0);
    expect(model.rejectedObjectCount).toBe(1);
    expect(queryRichWorkspaceObjects({ workspaceId: "w", objects: [foreign], logicalAreas: model.logicalAreas, query: "foreign" })).toEqual([]);
  });

  it("preserves all timeline events and uses only non-authoritative deterministic display order", () => {
    const events = [
      event("z", "2026-01-02T10:00:00Z", "CORRECTION"),
      { ...event("a", "2026-01-02T10:00:00Z", "RETRACTION"), causation_id: "z" },
      event("old", "2026-01-01T10:00:00Z", "UPDATED"),
    ];
    const model = buildRichWorkspaceReadModel({ workspace, objects: [object("a", "note")], events, profileDefinition: profile });
    expect(model.timeline.map((e) => e.eventId)).toEqual(["a", "z", "old"]);
    expect(model.timeline).toHaveLength(3);
    expect(model.timeline[0].causationId).toBe("z");
    expect(model.timeline.every((e) => e.effectiveTimeStatus === "UNAVAILABLE_IN_RUNTIME_1_2")).toBe(true);
    expect(model.semanticBoundary.displayOrderAuthority).toBe("NON_AUTHORITATIVE_UI_ONLY");
    expect(model.semanticBoundary.semanticOrder).toBe("CAUSAL_PARTIAL_ORDER_NOT_LINEARIZED_BY_UI");
  });

  it("fails prepared creation closed when owner operation/schema are absent or stale", () => {
    const objects = [object("a", "note")];
    const fingerprint = buildRichWorkspaceSnapshotFingerprint({ workspace, objects, events: [], profileDefinition: profile });
    expect(validatePreparedCreationPreview({ currentSnapshotFingerprint: fingerprint, knownLogicalAreaIds: ["notes"] })).toEqual({
      status: "UNAVAILABLE",
      execute: false,
      reason: "OWNER_OPERATION_AND_INPUT_SCHEMA_NOT_DECLARED",
    });
    const descriptor = {
      ownerComponent: "owner.notes",
      ownerOperation: "owner.notes.create",
      inputSchema: "schema:note-create:v1",
      logicalAreaId: "notes",
      snapshotFingerprint: fingerprint,
    };
    expect(validatePreparedCreationPreview({ descriptor, currentSnapshotFingerprint: fingerprint, knownLogicalAreaIds: ["notes"] }).status).toBe("READY_PREVIEW_ONLY");
    expect(validatePreparedCreationPreview({ descriptor, currentSnapshotFingerprint: `${fingerprint}:changed`, knownLogicalAreaIds: ["notes"] }).status).toBe("STALE");
  });

  it("fingerprint is deterministic and changes when authority snapshot changes", () => {
    const objects = [object("b", "task"), object("a", "note")];
    const events = [event("e2", "2026-01-02T00:00:00Z"), event("e1", "2026-01-01T00:00:00Z")];
    const first = buildRichWorkspaceSnapshotFingerprint({ workspace, objects, events, profileDefinition: profile });
    const second = buildRichWorkspaceSnapshotFingerprint({ workspace, objects: [...objects].reverse(), events: [...events].reverse(), profileDefinition: profile });
    expect(second).toBe(first);
    expect(buildRichWorkspaceSnapshotFingerprint({ workspace: { ...workspace, updated_at: "2026-01-04T00:00:00Z" }, objects, events, profileDefinition: profile })).not.toBe(first);
  });
});


describe("G4-S1 unavailable-target and malformed-preview boundaries", () => {
  it.each(["missing-area", ""])("does not broaden a query for unknown logical area %j", (logicalAreaId) => {
    const objects = [object("visible", "note"), object("task", "task")];
    const model = buildRichWorkspaceReadModel({ workspace, objects, events: [], profileDefinition: profile });
    expect(queryRichWorkspaceObjects({ workspaceId: "w", objects, logicalAreas: model.logicalAreas, query: "", logicalAreaId })).toEqual([]);
    expect(queryRichWorkspaceObjects({ workspaceId: "w", objects, logicalAreas: model.logicalAreas, query: "", logicalAreaId: null })).toHaveLength(2);
  });

  it.each([
    {}, [], "invalid", 123,
    { ownerComponent: {}, ownerOperation: "create", inputSchema: "note", logicalAreaId: "notes", snapshotFingerprint: "snapshot" },
    { ownerComponent: "owner", ownerOperation: "create", inputSchema: "note", logicalAreaId: "notes" },
    { ownerComponent: "owner", ownerOperation: "create", inputSchema: "note", logicalAreaId: "notes", snapshotFingerprint: 123 },
  ])("malformed descriptor %j is unavailable, never executable or an exception", (descriptor) => {
    expect(validatePreparedCreationPreview({
      descriptor: descriptor as unknown as PreparedCreationDescriptor,
      currentSnapshotFingerprint: "snapshot",
      knownLogicalAreaIds: ["notes"],
    })).toEqual({ status: "UNAVAILABLE", execute: false, reason: "INVALID_OR_UNSCOPED_DECLARATIVE_DESCRIPTOR" });
  });
});
