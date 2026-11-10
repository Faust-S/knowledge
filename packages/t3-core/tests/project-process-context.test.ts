import { describe, expect, it } from "vitest";
import type { ObjectRecord, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { WorkspaceRelationIndexEntry } from "../src/modules/base/features/workspace/relation-index-model";
import { buildProjectProcessResultContext } from "../src/modules/base/features/workspace/project-process-context";

function object(id: string, schemaId: string, revision = 1): ObjectRecord {
  return {
    workspace_id: "w",
    object_id: id,
    schema_id: schemaId,
    schema_version: "1",
    created_by_service: "svc",
    updated_by_service: "svc",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: `2026-01-0${revision}T00:00:00Z`,
    revision,
    data: {},
    extensions: {},
  };
}

function entry(id: string, from: ObjectRecord, to: ObjectRecord, kind: string): WorkspaceRelationIndexEntry {
  const relation: RelationRecord = {
    relation_id: id,
    workspace_id: "w",
    from_object_id: from.object_id,
    to_object_id: to.object_id,
    kind,
    created_at: "2026-01-01T00:00:00Z",
    created_by_service: "svc",
  };
  return { relation, fromSchemaId: from.schema_id, toSchemaId: to.schema_id };
}

describe("Project / Process / Result context", () => {
  it("groups only canonical neighbors and exposes ObjectRecord metadata", () => {
    const project = object("project-1", "project", 2);
    const task = object("task-1", "task", 3);
    const process = object("process-1", "process", 4);
    const note = object("note-1", "note", 5);
    const entries = [
      entry("r-project-task", project, task, "contains"),
      entry("r-task-process", task, process, "executes-as"),
    ];

    expect(buildProjectProcessResultContext(entries, [project, task, process, note], "task-1")).toEqual({
      objectId: "task-1",
      schemaId: "task",
      revision: 3,
      updatedAt: "2026-01-03T00:00:00Z",
      relationCount: 2,
      neighborCount: 2,
      groups: [
        {
          id: "projects",
          items: [{
            relationId: "r-project-task",
            relationKind: "contains",
            direction: "incoming",
            neighborObjectId: "project-1",
            neighborSchemaId: "project",
            neighborRevision: 2,
            neighborUpdatedAt: "2026-01-02T00:00:00Z",
          }],
        },
        {
          id: "processes",
          items: [{
            relationId: "r-task-process",
            relationKind: "executes-as",
            direction: "outgoing",
            neighborObjectId: "process-1",
            neighborSchemaId: "process",
            neighborRevision: 4,
            neighborUpdatedAt: "2026-01-04T00:00:00Z",
          }],
        },
      ],
    });
  });

  it("keeps isolated admitted objects visible and rejects missing focus", () => {
    const isolated = object("process-isolated", "process");
    const note = object("note-1", "note");
    expect(buildProjectProcessResultContext([], [isolated, note], "process-isolated")).toEqual({
      objectId: "process-isolated",
      schemaId: "process",
      revision: 1,
      updatedAt: "2026-01-01T00:00:00Z",
      relationCount: 0,
      neighborCount: 0,
      groups: [],
    });
    expect(buildProjectProcessResultContext([], [isolated, note], "missing")).toBeNull();
    expect(buildProjectProcessResultContext([], [isolated, note], null)).toBeNull();
  });
});
