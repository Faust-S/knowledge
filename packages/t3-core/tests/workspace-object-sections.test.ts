/**
 * T2-03A — buildWorkspaceObjectSections projection.
 */
import { describe, expect, it } from "vitest";
import { buildWorkspaceObjectSections } from "../src/modules/base/features/workspace/object-sections";
import type { ObjectRecord } from "../src/kernel-client";
import type { WorkspaceProfileDefinition } from "../src/profiles/definition";

const def: WorkspaceProfileDefinition = {
  id: "generic",
  label: "G", description: "", logoText: "G", accent: "#000",
  sections: [
    { id: "all", title: "Все", schemaIds: [], emptyTitle: "e", emptyDescription: "e" },
    { id: "docs", title: "Docs", schemaIds: ["note", "deck"], emptyTitle: "e", emptyDescription: "e" },
    { id: "proj", title: "Proj", schemaIds: ["project"], emptyTitle: "e", emptyDescription: "e" },
  ],
  unknownObjectsSection: { title: "Прочие", description: "d" },
};

function obj(id: string, schema: string): ObjectRecord {
  return {
    workspace_id: "w", object_id: id, schema_id: schema, schema_version: "1",
    created_by_service: "s", updated_by_service: "s",
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
    revision: 1, data: {}, deleted: false, deleted_at: undefined,
  };
}

describe("buildWorkspaceObjectSections", () => {
  it("catch-all contains all objects; normal sections split by schema_id", () => {
    const objects = [obj("n1", "note"), obj("p1", "project"), obj("d1", "deck")];
    const res = buildWorkspaceObjectSections(def, objects);
    const all = res.find((s) => s.id === "all")!;
    const docs = res.find((s) => s.id === "docs")!;
    const proj = res.find((s) => s.id === "proj")!;
    expect(all.isCatchAll).toBe(true);
    expect(all.objects.length).toBe(3);
    expect(docs.objects.map((o) => o.object_id).sort()).toEqual(["d1", "n1"]);
    expect(proj.objects.map((o) => o.object_id)).toEqual(["p1"]);
  });

  it("appends unknown section only when there are unclaimed schemas", () => {
    const withUnknown = buildWorkspaceObjectSections(def, [obj("x", "mystery")]);
    expect(withUnknown.some((s) => s.isUnknown)).toBe(true);
    const withoutUnknown = buildWorkspaceObjectSections(def, [obj("n", "note")]);
    expect(withoutUnknown.some((s) => s.isUnknown)).toBe(false);
  });

  it("does not duplicate objects across normal sections when schema is repeated", () => {
    const dupDef: WorkspaceProfileDefinition = {
      ...def,
      sections: [
        { id: "a", title: "A", schemaIds: ["shared"], emptyTitle: "", emptyDescription: "" },
        { id: "b", title: "B", schemaIds: ["shared"], emptyTitle: "", emptyDescription: "" },
      ],
    };
    const res = buildWorkspaceObjectSections(dupDef, [obj("s1", "shared")]);
    const a = res.find((s) => s.id === "a")!;
    const b = res.find((s) => s.id === "b")!;
    expect(a.objects.length).toBe(1);
    expect(b.objects.length).toBe(0);
  });

  it("does not mutate the input array", () => {
    const objects = [obj("n1", "note")];
    const snap = [...objects];
    buildWorkspaceObjectSections(def, objects);
    expect(objects).toEqual(snap);
  });

  it("catch-all does not claim schema_id for unknown detection", () => {
    const catchDef: WorkspaceProfileDefinition = {
      ...def,
      sections: [
        { id: "all", title: "A", schemaIds: [], emptyTitle: "", emptyDescription: "" },
      ],
    };
    const res = buildWorkspaceObjectSections(catchDef, [obj("x", "mystery")]);
    expect(res.some((s) => s.isUnknown)).toBe(true);
  });
});
