/**
 * T2-03B — pure catalog model: search, sort, pagination.
 */
import { describe, expect, it } from "vitest";
import {
  filterObjectsByQuery,
  sortObjects,
  paginate,
  pickInitialSectionId,
  OBJECT_CATALOG_PAGE_SIZE,
} from "../src/modules/base/features/workspace/workspace-catalog-model";
import type { ObjectRecord } from "../src/kernel-client";
import type { WorkspaceObjectSectionResult } from "../src/modules/base/features/workspace/object-sections";

function obj(
  id: string,
  schema: string,
  updated = "2026-01-01T00:00:00Z",
  created = "2026-01-01T00:00:00Z",
  data: unknown = { secret: `payload-${id}` },
): ObjectRecord {
  return {
    workspace_id: "w", object_id: id, schema_id: schema, schema_version: "1",
    created_by_service: "s", updated_by_service: "s",
    created_at: created, updated_at: updated, revision: 1, data,
    deleted: false, deleted_at: undefined,
  };
}

describe("filterObjectsByQuery", () => {
  it("matches on object_id and schema_id, case-insensitively", () => {
    const list = [obj("Alpha", "note"), obj("beta", "Deck"), obj("gamma", "task")];
    expect(filterObjectsByQuery(list, "alp").map((o) => o.object_id)).toEqual(["Alpha"]);
    expect(filterObjectsByQuery(list, "DECK").map((o) => o.object_id)).toEqual(["beta"]);
    expect(filterObjectsByQuery(list, "  ").map((o) => o.object_id)).toEqual(["Alpha", "beta", "gamma"]);
  });

  it("never inspects the data payload", () => {
    const list = [
      obj("id-1", "note", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z", { title: "needle-in-data" }),
    ];
    expect(filterObjectsByQuery(list, "needle")).toEqual([]);
  });
});

describe("sortObjects", () => {
  const list = [
    obj("b", "note", "2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z"),
    obj("a", "task", "2026-01-01T00:00:00Z", "2026-03-01T00:00:00Z"),
    obj("c", "note", "2026-02-01T00:00:00Z", "2026-02-01T00:00:00Z"),
  ];

  it("updated: newest first, tie-break by object_id", () => {
    expect(sortObjects(list, "updated").map((o) => o.object_id)).toEqual(["b", "c", "a"]);
  });
  it("created: newest first", () => {
    expect(sortObjects(list, "created").map((o) => o.object_id)).toEqual(["a", "c", "b"]);
  });
  it("id: alphabetical", () => {
    expect(sortObjects(list, "id").map((o) => o.object_id)).toEqual(["a", "b", "c"]);
  });
  it("type: schema_id then object_id", () => {
    expect(sortObjects(list, "type").map((o) => o.object_id)).toEqual(["b", "c", "a"]);
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 25 }, (_, i) => `x-${i}`);

  it("uses PAGE_SIZE of 12 by default", () => {
    expect(OBJECT_CATALOG_PAGE_SIZE).toBe(12);
    const p = paginate(items, 0);
    expect(p.pageItems.length).toBe(12);
    expect(p.totalPages).toBe(3);
    expect(p.startIndex).toBe(1);
    expect(p.endIndex).toBe(12);
  });

  it("normalises out-of-range page after refresh", () => {
    const p = paginate(items.slice(0, 3), 5);
    expect(p.normalizedPage).toBe(0);
    expect(p.pageItems.length).toBe(3);
    expect(p.total).toBe(3);
  });

  it("empty list yields totalPages=1 and 0..0 counters", () => {
    const p = paginate<string>([], 3);
    expect(p.totalPages).toBe(1);
    expect(p.startIndex).toBe(0);
    expect(p.endIndex).toBe(0);
  });
});

describe("pickInitialSectionId", () => {
  const mk = (id: string, isUnknown = false): WorkspaceObjectSectionResult => ({
    id, title: id, emptyTitle: "", emptyDescription: "",
    objects: [], isUnknown, isCatchAll: false,
  });
  it("prefers the first definition section", () => {
    expect(pickInitialSectionId([mk("all"), mk("__unknown__", true)])).toBe("all");
  });
  it("falls back to unknown when there is no definition section", () => {
    expect(pickInitialSectionId([mk("__unknown__", true)])).toBe("__unknown__");
  });
  it("returns null on empty input", () => {
    expect(pickInitialSectionId([])).toBeNull();
  });
});
