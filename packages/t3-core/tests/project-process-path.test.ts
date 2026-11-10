import { describe, expect, it } from "vitest";
import type { ObjectRecord, RelationRecord } from "../src/kernel-client/contracts/runtime-1.2.0";
import type { WorkspaceRelationIndexEntry } from "../src/modules/base/features/workspace/relation-index-model";
import { findProjectProcessResultShortestPath } from "../src/modules/base/features/workspace/project-process-path";

function object(id: string, schema: string): ObjectRecord {
  return {
    workspace_id: "w",
    object_id: id,
    schema_id: schema,
    schema_version: "1",
    created_by_service: "svc",
    updated_by_service: "svc",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    revision: 1,
    data: {},
    extensions: {},
  };
}

function entry(id: string, from: string, to: string, kind: string): WorkspaceRelationIndexEntry {
  const relation: RelationRecord = {
    relation_id: id,
    workspace_id: "w",
    from_object_id: from,
    to_object_id: to,
    kind,
    created_at: "2026-01-01T00:00:00Z",
    created_by_service: "svc",
  };
  return { relation, fromSchemaId: "project", toSchemaId: "task" };
}

describe("Project / Process / Result canonical path", () => {
  const objects = [
    object("project-1", "project"),
    object("task-1", "task"),
    object("process-1", "process"),
    object("result-1", "analytical-result"),
    object("task-shortcut", "task"),
    object("note-1", "note"),
  ];
  const entries = [
    entry("r-project-task", "project-1", "task-1", "contains"),
    entry("r-task-process", "task-1", "process-1", "executes-as"),
    entry("r-process-result", "process-1", "result-1", "produces"),
    entry("r-project-shortcut", "project-1", "task-shortcut", "links"),
    entry("r-shortcut-result", "task-shortcut", "result-1", "links"),
    entry("r-project-note", "project-1", "note-1", "mentions"),
  ];

  it("returns a deterministic shortest path", () => {
    const path = findProjectProcessResultShortestPath(entries, objects, "project-1", "result-1");
    expect(path?.objectIds).toEqual(["project-1", "task-shortcut", "result-1"]);
    expect(path?.hops.map((hop) => hop.relationId)).toEqual(["r-project-shortcut", "r-shortcut-result"]);
  });

  it("allows reverse navigation while preserving actual RelationRecord direction", () => {
    const path = findProjectProcessResultShortestPath(entries, objects, "process-1", "project-1");
    expect(path?.objectIds).toEqual(["process-1", "task-1", "project-1"]);
    expect(path?.hops).toEqual([
      {
        relationId: "r-task-process",
        relationKind: "executes-as",
        relationDirection: "reverse",
        fromObjectId: "process-1",
        toObjectId: "task-1",
      },
      {
        relationId: "r-project-task",
        relationKind: "contains",
        relationDirection: "reverse",
        fromObjectId: "task-1",
        toObjectId: "project-1",
      },
    ]);
  });

  it("fails closed for hop bounds, disconnected targets and non-PPR objects", () => {
    expect(findProjectProcessResultShortestPath(entries, objects, "project-1", "result-1", 1)).toBeNull();
    expect(findProjectProcessResultShortestPath(entries, objects, "project-1", "missing")).toBeNull();
    expect(findProjectProcessResultShortestPath(entries, objects, "project-1", "note-1")).toBeNull();
  });

  it("uses the exact P4.6 integer-floor hop bound", () => {
    expect(findProjectProcessResultShortestPath(entries, objects, "project-1", "result-1", 1.9)).toBeNull();
    expect(findProjectProcessResultShortestPath(entries, objects, "project-1", "result-1", 2.9)?.hops).toHaveLength(2);
  });

  it("returns a zero-hop self path only for admitted objects", () => {
    expect(findProjectProcessResultShortestPath(entries, objects, "process-1", "process-1")).toEqual({
      objectIds: ["process-1"],
      hops: [],
    });
    expect(findProjectProcessResultShortestPath(entries, objects, "note-1", "note-1")).toBeNull();
  });
});
