import { describe, expect, it } from "vitest";
import type { ObjectRecord, ObjectWithRelations, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import { buildProjectProcessResultFocusOptions, buildProjectProcessResultOverview, buildWorkspaceRelationIndex, focusProjectProcessResultEntries, projectWorkspaceRelationIndex } from "../src/modules/base/features/workspace/relation-index-model";

function object(id: string, schema: string): ObjectRecord { return { workspace_id: "w", object_id: id, schema_id: schema, schema_version: "1", created_by_service: "svc", updated_by_service: "svc", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", revision: 1, data: {}, extensions: {} }; }
function relation(id: string, from: string, to: string, kind: string): RelationRecord { return { relation_id: id, workspace_id: "w", from_object_id: from, to_object_id: to, kind, created_at: "2026-01-01T00:00:00Z", created_by_service: "svc" }; }
function detail(source: ObjectRecord, outgoing: RelationRecord[] = [], incoming: RelationRecord[] = []): ObjectWithRelations { return { object: source, relations: { outgoing, incoming } }; }

describe("Project / Process / Result focus graph", () => {
  it("focuses only incident canonical relations and keeps isolated admitted objects visible", () => {
    const project = object("project-1", "project"); const task = object("task-1", "task"); const process = object("process-1", "process"); const result = object("result-1", "analytical-result"); const isolated = object("process-isolated", "process"); const note = object("note-1", "note");
    const projectTask = relation("r-project-task", "project-1", "task-1", "contains"); const taskProcess = relation("r-task-process", "task-1", "process-1", "executes-as"); const processResult = relation("r-process-result", "process-1", "result-1", "produces");
    const model = buildWorkspaceRelationIndex({ workspaceId: "w", objects: [project, task, process, result, isolated, note], sources: [
      { sourceObjectId: "project-1", state: "ready", detail: detail(project, [projectTask]) }, { sourceObjectId: "task-1", state: "ready", detail: detail(task, [taskProcess], [projectTask]) }, { sourceObjectId: "process-1", state: "ready", detail: detail(process, [processResult], [taskProcess]) }, { sourceObjectId: "result-1", state: "ready", detail: detail(result, [], [processResult]) }, { sourceObjectId: "process-isolated", state: "ready", detail: detail(isolated) }, { sourceObjectId: "note-1", state: "ready", detail: detail(note) },
    ] });
    const entries = projectWorkspaceRelationIndex(model.entries, "project-process-result", null);
    expect(entries.map((entry) => entry.relation.relation_id)).toEqual(["r-project-task", "r-task-process", "r-process-result"]);
    expect(buildProjectProcessResultOverview(entries, [project, task, process, result, isolated, note])).toEqual({ edgeCount: 3, objectCount: 5, connectedObjectCount: 4, isolatedObjectCount: 1, schemaCounts: [{ schemaId: "analytical-result", objectCount: 1 }, { schemaId: "process", objectCount: 2 }, { schemaId: "project", objectCount: 1 }, { schemaId: "task", objectCount: 1 }] });
    const focusOptions = buildProjectProcessResultFocusOptions(entries, [project, task, process, result, isolated, note]);
    expect(focusOptions).toContainEqual({ objectId: "task-1", schemaId: "task", incomingEdgeCount: 1, outgoingEdgeCount: 1, neighborCount: 2 });
    expect(focusOptions).toContainEqual({ objectId: "process-isolated", schemaId: "process", incomingEdgeCount: 0, outgoingEdgeCount: 0, neighborCount: 0 });
    expect(focusProjectProcessResultEntries(entries, "task-1").map((entry) => entry.relation.relation_id)).toEqual(["r-project-task", "r-task-process"]);
    expect(focusProjectProcessResultEntries(entries, "process-isolated")).toEqual([]);
  });
});
