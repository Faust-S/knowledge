import { describe, expect, it, vi } from "vitest";
import { buildBaseCommandContributions, WORKSPACE_FOCUS_SELECT_COMMAND_ID } from "../src/modules/base/commands";

function fixture() {
  let selected: { workspace_id: string; profile: string } | null = null;
  const record = { workspace_id: "ws-1", profile: "personal", deleted_at: undefined };
  const claim = vi.fn((ws: typeof record) => { selected = ws; });
  const kernel = {
    hasOperation: (id: string) => id === "t1.getWorkspace",
    getWorkspace: vi.fn(async (id: string) => id === "ws-1" ? record : null),
  };
  const ctx = {
    kernel, profile: { id: "personal" },
    currentWorkspace: { get: () => selected, claim },
  };
  return { ctx, claim };
}
describe("Host-owned Workspace focus command", () => {
  it("is declared and selects only a real matching Workspace", async () => {
    const contribution = buildBaseCommandContributions().find(c => c.id === WORKSPACE_FOCUS_SELECT_COMMAND_ID);
    expect(contribution).toBeDefined();
    const handler = await contribution!.loader();
    const {ctx,claim}=fixture();
    await expect(handler.run(ctx, {workspace_id:"ws-1"})).resolves.toEqual({workspace_id:"ws-1",profile:"personal"});
    expect(claim).toHaveBeenCalledTimes(1);
  });
  it("rejects missing, malformed and foreign Workspace without claiming", async () => {
    const contribution = buildBaseCommandContributions().find(c => c.id === WORKSPACE_FOCUS_SELECT_COMMAND_ID)!;
    const handler = await contribution.loader();
    const {ctx,claim}=fixture();
    for (const workspace_id of ["missing", "../x", "", "ws-1\n"]) {
      await expect(handler.run(ctx,{workspace_id})).rejects.toThrow();
    }
    expect(claim).not.toHaveBeenCalled();
  });
});
