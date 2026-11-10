import { describe, expect, it } from "vitest";
import type {
  ObjectRecord,
  ObjectWithRelations,
  RelationRecord,
} from "../src/kernel-client/contracts/runtime-1.2.0";
import {
  buildWorkspaceRelationIndex,
  loadRelationIndexSources,
  projectWorkspaceRelationIndex,
  selectRelationIndexSources,
} from "../src/modules/base/features/workspace/relation-index-model";

function object(id: string, schema = "note", workspace = "w"): ObjectRecord {
  return {
    workspace_id: workspace,
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

function relation(
  id: string,
  from: string,
  to: string,
  kind = "linked-to",
  workspace = "w",
): RelationRecord {
  return {
    relation_id: id,
    workspace_id: workspace,
    from_object_id: from,
    to_object_id: to,
    kind,
    created_at: "2026-01-01T00:00:00Z",
    created_by_service: "svc",
  };
}

function detail(
  source: ObjectRecord,
  outgoing: RelationRecord[] = [],
  incoming: RelationRecord[] = [],
): ObjectWithRelations {
  return { object: source, relations: { outgoing, incoming } };
}

describe("workspace relation index model", () => {
  it("deduplicates the same relation observed from both endpoints", () => {
    const a = object("a", "note");
    const b = object("b", "task");
    const r = relation("r1", "a", "b");
    const model = buildWorkspaceRelationIndex({
      workspaceId: "w",
      objects: [a, b],
      sources: [
        { sourceObjectId: "a", state: "ready", detail: detail(a, [r]) },
        { sourceObjectId: "b", state: "ready", detail: detail(b, [], [r]) },
      ],
    });
    expect(model.entries.map((entry) => entry.relation.relation_id)).toEqual(["r1"]);
    expect(model.diagnostics.relationIdConflicts).toBe(0);
  });

  it("rejects unsafe, cross-workspace, unknown-endpoint and endpoint-mismatch records", () => {
    const a = object("a");
    const b = object("b");
    const model = buildWorkspaceRelationIndex({
      workspaceId: "w",
      objects: [a, b],
      sources: [{
        sourceObjectId: "a",
        state: "ready",
        detail: detail(a, [
          relation("cross", "a", "b", "k", "other"),
          relation("unknown", "a", "ghost"),
          relation("unsafe", "a", "bad id!"),
          relation("mismatch", "b", "a"),
        ]),
      }],
    });
    expect(model.entries).toEqual([]);
    expect(model.diagnostics.rejectedRelations).toBe(4);
  });

  it("isolates source error/missing/identity mismatch and admits no data from mismatched sources", () => {
    const a = object("a");
    const b = object("b");
    const c = object("c");
    const impostor = object("other");
    const good = relation("good", "a", "b");
    const leaked = relation("leaked", "c", "a");
    const model = buildWorkspaceRelationIndex({
      workspaceId: "w",
      objects: [a, b, c],
      sources: [
        { sourceObjectId: "a", state: "ready", detail: detail(a, [good]) },
        { sourceObjectId: "b", state: "missing" },
        { sourceObjectId: "c", state: "error" },
        { sourceObjectId: "c", state: "ready", detail: detail(impostor, [leaked]) },
      ],
    });
    expect(model.entries.map((entry) => entry.relation.relation_id)).toEqual(["good"]);
    expect(model.loadedSources).toBe(1);
    expect(model.diagnostics.sourceMissing).toBe(1);
    expect(model.diagnostics.sourceLoadFailures).toBe(1);
    expect(model.diagnostics.sourceIdentityMismatches).toBe(1);
  });

  it("rejects relation details from a stale or schema-drifted source snapshot", () => {
    const a = object("a", "note");
    const b = object("b", "task");
    const r = relation("stale-edge", "a", "b");
    const staleA = { ...a, revision: a.revision + 1 };
    const schemaDriftA = { ...a, schema_id: "task" };
    for (const mismatched of [staleA, schemaDriftA]) {
      const model = buildWorkspaceRelationIndex({
        workspaceId: "w",
        objects: [a, b],
        sources: [{ sourceObjectId: "a", state: "ready", detail: detail(mismatched, [r]) }],
      });
      expect(model.entries).toEqual([]);
      expect(model.loadedSources).toBe(0);
      expect(model.diagnostics.sourceIdentityMismatches).toBe(1);
    }
  });

  it("treats a valid and invalid payload sharing one relation_id as a fail-closed conflict", () => {
    const a = object("a");
    const b = object("b");
    const good = relation("same-id", "a", "b", "one");
    const invalid = relation("same-id", "a", "b", "one", "other-workspace");
    const model = buildWorkspaceRelationIndex({
      workspaceId: "w",
      objects: [a, b],
      sources: [{ sourceObjectId: "a", state: "ready", detail: detail(a, [good, invalid]) }],
    });
    expect(model.entries).toEqual([]);
    expect(model.diagnostics.rejectedRelations).toBe(1);
    expect(model.diagnostics.relationIdConflicts).toBe(1);
  });

  it("diagnoses conflicting relation_id even when every observed payload is rejected", () => {
    const a = object("a");
    const b = object("b");
    const first = relation("same-invalid-id", "a", "b", "one", "other-one");
    const second = relation("same-invalid-id", "a", "b", "two", "other-two");
    const model = buildWorkspaceRelationIndex({
      workspaceId: "w",
      objects: [a, b],
      sources: [{ sourceObjectId: "a", state: "ready", detail: detail(a, [first, second]) }],
    });
    expect(model.entries).toEqual([]);
    expect(model.diagnostics.rejectedRelations).toBe(2);
    expect(model.diagnostics.relationIdConflicts).toBe(1);
  });

  it("excludes every payload for a conflicting relation_id", () => {
    const a = object("a");
    const b = object("b");
    const one = relation("same-id", "a", "b", "one");
    const two = relation("same-id", "a", "b", "two");
    const model = buildWorkspaceRelationIndex({
      workspaceId: "w",
      objects: [a, b],
      sources: [{ sourceObjectId: "a", state: "ready", detail: detail(a, [one, two]) }],
    });
    expect(model.entries).toEqual([]);
    expect(model.diagnostics.relationIdConflicts).toBe(1);
  });

  it("is deterministic when source completion order changes", () => {
    const a = object("a", "note");
    const b = object("b", "task");
    const c = object("c", "note");
    const r1 = relation("r-z", "a", "b", "z-kind");
    const r2 = relation("r-a", "c", "a", "a-kind");
    const sources = [
      { sourceObjectId: "a", state: "ready" as const, detail: detail(a, [r1], [r2]) },
      { sourceObjectId: "b", state: "ready" as const, detail: detail(b, [], [r1]) },
      { sourceObjectId: "c", state: "ready" as const, detail: detail(c, [r2]) },
    ];
    const first = buildWorkspaceRelationIndex({ workspaceId: "w", objects: [a, b, c], sources });
    const second = buildWorkspaceRelationIndex({ workspaceId: "w", objects: [a, b, c], sources: [...sources].reverse() });
    expect(JSON.stringify(first.entries)).toBe(JSON.stringify(second.entries));
    expect(first.entries.map((entry) => entry.relation.relation_id)).toEqual(["r-a", "r-z"]);
  });

  it("projects all, cross-schema, same-schema and kind views without state", () => {
    const a = object("a", "note");
    const b = object("b", "task");
    const c = object("c", "note");
    const cross = relation("cross", "a", "b", "depends");
    const same = relation("same", "a", "c", "links");
    const model = buildWorkspaceRelationIndex({
      workspaceId: "w",
      objects: [a, b, c],
      sources: [{ sourceObjectId: "a", state: "ready", detail: detail(a, [cross, same]) }],
    });
    expect(projectWorkspaceRelationIndex(model.entries, "all", null)).toHaveLength(2);
    expect(projectWorkspaceRelationIndex(model.entries, "cross-schema", null).map((x) => x.relation.relation_id)).toEqual(["cross"]);
    expect(projectWorkspaceRelationIndex(model.entries, "same-schema", null).map((x) => x.relation.relation_id)).toEqual(["same"]);
    expect(projectWorkspaceRelationIndex(model.entries, "all", "depends").map((x) => x.relation.relation_id)).toEqual(["cross"]);
  });


  it("bounds relation detail loading to four concurrent reads and isolates failures", async () => {
    const objects = Array.from({ length: 12 }, (_, index) => object(`o-${index}`));
    let inFlight = 0;
    let peak = 0;
    const results = await loadRelationIndexSources({
      workspaceId: "w",
      sourceObjects: objects,
      getObject: async (_workspaceId, objectId) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 2));
        inFlight -= 1;
        if (objectId === "o-5") throw new Error("expected fixture failure");
        const source = objects.find((candidate) => candidate.object_id === objectId)!;
        return detail(source);
      },
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(results).toHaveLength(12);
    expect(results[5]).toEqual({ sourceObjectId: "o-5", state: "error" });
  });

  it("classifies getObject null as missing without failing sibling source loads", async () => {
    const objects = [object("a"), object("b")];
    const results = await loadRelationIndexSources({
      workspaceId: "w",
      sourceObjects: objects,
      getObject: async (_workspaceId, objectId) =>
        objectId === "a" ? null : detail(objects[1]),
    });
    expect(results).toEqual([
      { sourceObjectId: "a", state: "missing" },
      { sourceObjectId: "b", state: "ready", detail: detail(objects[1]) },
    ]);
  });

  it("selects at most 100 source objects in stable id order and marks truncation", () => {
    const objects = Array.from({ length: 105 }, (_, index) => object(`o-${String(104 - index).padStart(3, "0")}`));
    const selected = selectRelationIndexSources(objects);
    expect(selected.objects).toHaveLength(100);
    expect(selected.isTruncated).toBe(true);
    expect(selected.objects[0].object_id).toBe("o-000");
    expect(selected.objects[99].object_id).toBe("o-099");
  });
});
