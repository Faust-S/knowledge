import { describe, expect, it } from "vitest";
import { INITIAL_PLAN, validateRestorationReceipt } from "@/modules/exchange/features/state/import-machine";
import type { ImportPreview, ImportReceipt } from "@/kernel-client/contracts/runtime-1.3.0";

const preview = (exists_locally = true) => ({
  scope_mode: "writable_objects",
  workspaces: [{ workspace_id: "src", exists_locally }],
  included: { workspaces: 1, objects: 3, events: 7, relations: 2, assets: 1, schemas: 1 },
  objects: ["a", "b", "c"].map(object_id => ({ workspace_id: "src", object_id })),
}) as unknown as ImportPreview;
const plan = { ...INITIAL_PLAN, mode: "merge" as const, target_workspace: "src",
  include_workspaces: ["src"] };
const base = {
  mode: "merge", conflict_policy: "fail", workspace_id_map: { src: "src" }, skipped_conflicts: [],
  applied: { workspaces: 0, objects_inserted: 0, objects_updated: 0, objects_skipped: 3,
    events: 0, relations: 2, assets: 1, schemas_inserted: 0, schemas_reused: 1, schemas_rejected: 0 },
} as unknown as ImportReceipt;
const receipt = (applied: Partial<ImportReceipt["applied"]> = {},
  rest: Partial<ImportReceipt> = {}): ImportReceipt => ({
  ...base, ...rest, applied: { ...base.applied, ...applied },
});
describe("original Exchange receipt accounting for already existing records", () => {
  it("accepts a committed identical replay and a mixed new/existing merge", () => {
    expect(validateRestorationReceipt(preview(), plan, base)).toEqual([]);
    expect(validateRestorationReceipt(preview(), plan, receipt({
      objects_inserted: 1, objects_skipped: 2, events: 3,
    }))).toEqual([]);
    expect(validateRestorationReceipt(preview(), plan, receipt({
      objects_inserted: 3, objects_skipped: 0, events: 7,
    }))).toEqual([]);
  });
  it("never counts a real skipped conflict as a retained identical object", () => {
    expect(validateRestorationReceipt(preview(), { ...plan, conflict: "skip" },
      receipt({}, { skipped_conflicts: ["src/a"] }))).not.toEqual([]);
    expect(validateRestorationReceipt(preview(), plan,
      receipt({}, { skipped_conflicts: undefined }))).not.toEqual([]);
  });
  it("still rejects missing records, corrupt counters and requested missing dependencies", () => {
    for (const patch of [
      { objects_skipped: 2 }, { objects_skipped: 4 }, { events: undefined },
      { events: 8 }, { relations: 1 }, { assets: 0 }, { schemas_rejected: 1 },
    ]) expect(validateRestorationReceipt(preview(), plan, receipt(patch))).not.toEqual([]);
  });
  it("requires all fresh restoration writes even when the source exists", () => {
    const fresh = { ...plan, mode: "new-workspace" as const, workspace_id_map: { src: "dst" } };
    const actual = receipt({ workspaces: 1, objects_inserted: 3, objects_skipped: 0, events: 7 },
      { workspace_id_map: { src: "dst" } });
    expect(validateRestorationReceipt(preview(), fresh, actual)).toEqual([]);
    expect(validateRestorationReceipt(preview(), fresh, receipt({ workspaces: 1 },
      { workspace_id_map: { src: "dst" } }))).not.toEqual([]);
    const full = { ...plan, mode: "full" as const };
    expect(validateRestorationReceipt(preview(false), full, actual)).toEqual([]);
    expect(validateRestorationReceipt(preview(false), full, receipt({
      workspaces: 1, objects_inserted: 3, objects_skipped: 0, events: 2,
    }))).not.toEqual([]);
    expect(validateRestorationReceipt(preview(), full, base)).toEqual([]);
  });
  it("accounts for the actual selective object selection rather than the full archive", () => {
    const selected = { ...plan, mode: "selective" as const,
      include_objects: ["src/b"] as const };
    expect(validateRestorationReceipt(preview(), selected,
      receipt({ objects_skipped: 1 }))).toEqual([]);
    expect(validateRestorationReceipt(preview(), selected,
      receipt({ objects_skipped: 0 }))).not.toEqual([]);
  });
  it("preserves explicit history exclusion and cancellation behavior", () => {
    const full = { ...plan, mode: "full" as const, include_history: false };
    expect(validateRestorationReceipt(preview(false), full, receipt({
      workspaces: 1, objects_inserted: 3, objects_skipped: 0, events: 0,
    }))).toEqual([]);
    expect(validateRestorationReceipt(preview(), plan,
      receipt({}, { cancelled: true }))).not.toEqual([]);
  });
});
