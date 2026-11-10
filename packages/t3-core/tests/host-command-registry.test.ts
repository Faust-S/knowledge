import { describe, it, expect } from "vitest";
import {
  CommandRegistry,
  CommandInvocationError,
} from "@/workspace-host/registries";
import type { CommandContribution } from "@/workspace-contract";
import type { OperationId } from "@/kernel-client";

const cmd = (
  id: string,
  requiredOperations: readonly OperationId[],
  run: (ctx: unknown, args?: unknown) => unknown,
): CommandContribution => ({
  kind: "command",
  id,
  moduleId: "m",
  requiredOperations,
  labelKey: "x",
  loader: async () => ({ run }),
});

/** Simple resolver that always returns the same host context. */
const fixedResolver = (host: unknown) => () => host;

describe("CommandRegistry — capability & error isolation", () => {
  it("throws unknown-command for missing ids", async () => {
    const r = new CommandRegistry();
    await expect(
      r.invoke("nope", null, [], fixedResolver({})),
    ).rejects.toBeInstanceOf(CommandInvocationError);
  });

  it("blocks invocation when required operation is not granted", async () => {
    const r = new CommandRegistry();
    r.registerMany("m", [
      {
        contributionId: "c1",
        ownerModuleId: "m",
        requiredOperations: ["t1.putObject"],
        contribution: cmd("c1", ["t1.putObject"], () => {}),
      },
    ]);
    await expect(
      r.invoke("c1", null, [], fixedResolver({})),
    ).rejects.toMatchObject({ code: "operation-not-granted" });
  });

  it("dispatches with the OWNER context, not a caller-supplied one (PROMPT 29 §3)", async () => {
    const r = new CommandRegistry();
    let seenCtx: unknown = undefined;
    let seenArgs: unknown = undefined;
    let seenOwner: string | null = null;
    r.registerMany("owner-mod", [
      {
        contributionId: "c2",
        ownerModuleId: "owner-mod",
        requiredOperations: [],
        contribution: cmd("c2", [], (ctx, args) => {
          seenCtx = ctx;
          seenArgs = args;
        }),
      },
    ]);
    const resolver = (ownerId: string) => {
      seenOwner = ownerId;
      return { ownedBy: ownerId };
    };
    await r.invoke("c2", { hello: 1 }, [], resolver);
    expect(seenOwner).toBe("owner-mod");
    expect(seenCtx).toEqual({ ownedBy: "owner-mod" });
    expect(seenArgs).toEqual({ hello: 1 });
  });

  it("wraps loader failure as loader-failed", async () => {
    const r = new CommandRegistry();
    r.registerMany("m", [
      {
        contributionId: "c3",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: {
          kind: "command",
          id: "c3",
          moduleId: "m",
          requiredOperations: [],
          labelKey: "x",
          loader: async () => {
            throw new Error("boom");
          },
        },
      },
    ]);
    await expect(
      r.invoke("c3", null, [], fixedResolver({})),
    ).rejects.toMatchObject({ code: "loader-failed" });
  });

  it("wraps handler throw as handler-threw", async () => {
    const r = new CommandRegistry();
    r.registerMany("m", [
      {
        contributionId: "c4",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: cmd("c4", [], () => {
          throw new Error("nope");
        }),
      },
    ]);
    await expect(
      r.invoke("c4", null, [], fixedResolver({})),
    ).rejects.toMatchObject({ code: "handler-threw" });
  });

  it("preserves and returns the handler's typed result (PROMPT 29 §2)", async () => {
    const r = new CommandRegistry();
    const receipt = { workspace_id: "ws-1", deleted_at: "2026-07-26T00:00:00Z" };
    r.registerMany("m", [
      {
        contributionId: "c5",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: cmd("c5", [], async () => receipt),
      },
    ]);
    const out = await r.invoke("c5", null, [], fixedResolver({}));
    expect(out).toBe(receipt);
  });

  it("blocks re-entrant cycles with command-cycle (PROMPT 29 §4)", async () => {
    const r = new CommandRegistry();
    r.registerMany("m", [
      {
        contributionId: "loop",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: cmd("loop", [], () => "ok"),
      },
    ]);
    await expect(
      r.invoke("loop", null, [], fixedResolver({}), ["loop"]),
    ).rejects.toMatchObject({ code: "command-cycle" });
  });

  it("blocks runaway chains with command-depth-exceeded", async () => {
    const r = new CommandRegistry();
    r.registerMany("m", [
      {
        contributionId: "deep",
        ownerModuleId: "m",
        requiredOperations: [],
        contribution: cmd("deep", [], () => "ok"),
      },
    ]);
    const parent = Array.from({ length: 16 }, (_, i) => `parent-${i}`);
    await expect(
      r.invoke("deep", null, [], fixedResolver({}), parent),
    ).rejects.toMatchObject({ code: "command-depth-exceeded" });
  });

  it("has() honours capability gate — returns false when op is missing", () => {
    const r = new CommandRegistry();
    r.registerMany("m", [
      {
        contributionId: "gated",
        ownerModuleId: "m",
        requiredOperations: ["t1.softDeleteWorkspace"],
        contribution: cmd("gated", ["t1.softDeleteWorkspace"], () => {}),
      },
    ]);
    expect(r.isInvocable("gated", [])).toBe(false);
    expect(r.isInvocable("gated", ["t1.softDeleteWorkspace"])).toBe(true);
    expect(r.isInvocable("missing-id", ["t1.softDeleteWorkspace"])).toBe(false);
  });
});

