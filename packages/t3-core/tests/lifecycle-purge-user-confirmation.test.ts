import { describe, it, expect } from "vitest";
import { purgeCommitHandler } from "@/modules/lifecycle/commands";
import type { WorkspaceModuleContext } from "@/workspace-contract";
import { makeKernel } from "./lifecycle/_helpers";

describe("purgeCommit passes exact user input, not the kernel challenge", () => {
  it("confirmation is the user input string verbatim", async () => {
    const kernel = makeKernel();
    await purgeCommitHandler.run(
      { kernel } as unknown as WorkspaceModuleContext,
      { workspaceId: "ws-1", purgeToken: "tok-1", confirmation: "USER TYPED THIS" },
    );
    expect(kernel.purgeCommit).toHaveBeenCalledWith({
      purge_token: "tok-1",
      confirmation: "USER TYPED THIS",
    });
  });
});
