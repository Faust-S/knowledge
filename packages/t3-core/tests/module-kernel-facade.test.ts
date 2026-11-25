import { describe, it, expect } from "vitest";
import { createKernelFacade } from "@/workspace-host/context";
import type { KernelSession } from "@/kernel-client/types";
import { OperationNotGrantedError } from "@/kernel-client/adapter";
import { createTemporaryOriginalPersonalAuthority } from "./support/t3-original-personal-authority.mjs";

function makeSession(
  grantedOperations: string[],
  overrides: Partial<KernelSession["t1"]> = {},
): KernelSession {
  const stub = () => Promise.resolve(null as never);
  return {
    granted_operations: grantedOperations,
    granted_levels: ["T1", "T2"],
    t1: {
      listWorkspaces: stub,
      getWorkspace: stub,
      createWorkspace: stub,
      listObjects: stub,
      getObject: stub,
      listEventsSince: stub,
      putObject: stub,
      deleteObject: stub,
      putRelation: stub,
      deleteRelation: stub,
      listAssets: stub,
      getAsset: stub,
      putAsset: stub,
      deleteAsset: stub,
      softDeleteWorkspace: stub,
      restoreWorkspace: stub,
      purgePreview: stub,
      purgeCommit: stub,
      purgeCancel: stub,
      ...overrides,
    },
    t2: {
      exportPreview: stub,
      exportPackage: stub,
      confirmExport: stub,
      importPreview: stub,
      importCommit: stub,
      importCancel: stub,
    },
  } as unknown as KernelSession;
}

describe("KernelFacade — capability-checked adapter binding", () => {
  it("hasOperation reflects granted set", () => {
    const facade = createKernelFacade({
      session: makeSession(["t1.listWorkspaces"]),
    });
    expect(facade.hasOperation("t1.listWorkspaces")).toBe(true);
    expect(facade.hasOperation("t1.putObject")).toBe(false);
  });

  it("grantedOperations / grantedLevels are frozen snapshots", () => {
    const facade = createKernelFacade({
      session: makeSession(["t1.listWorkspaces"]),
    });
    expect(Object.isFrozen(facade.grantedOperations)).toBe(true);
    expect(Object.isFrozen(facade.grantedLevels)).toBe(true);
    expect(() => {
      (facade.grantedOperations as unknown as string[]).push("hack");
    }).toThrow();
  });

  it("rejects every ungranted operation with OperationNotGrantedError", async () => {
    const facade = createKernelFacade({ session: makeSession([]) });
    await expect(facade.listWorkspaces()).rejects.toBeInstanceOf(
      OperationNotGrantedError,
    );
    await expect(facade.getWorkspace("id")).rejects.toBeInstanceOf(
      OperationNotGrantedError,
    );
    await expect(
      facade.putObject({} as never),
    ).rejects.toBeInstanceOf(OperationNotGrantedError);
  });

  it("dispatches granted calls straight to the adapter/runtime", async () => {
    let seen: unknown = undefined;
    const facade = createKernelFacade({
      session: makeSession(["t1.getWorkspace"], {
        getWorkspace: async (id: string) => {
          seen = id;
          return { workspace_id: id } as never;
        },
      }),
    });
    const r = await facade.getWorkspace("ws-1");
    expect(seen).toBe("ws-1");
    expect(r).toEqual({ workspace_id: "ws-1" });
  });

  it("exposes sanctioned relation and asset operations only through operation-gated adapter paths", async () => {
    let relationSeen: unknown;
    let assetSeen: unknown;
    const facade = createKernelFacade({
      session: makeSession(
        ["t1.putRelation", "t1.putAsset"],
        {
          putRelation: async (input) => {
            relationSeen = input;
            return { relation: { relation_id: input.relation_id }, event: {}, deduplicated: false } as never;
          },
          putAsset: async (input) => {
            assetSeen = input;
            return { asset: { asset_id: input.asset_id }, event: {}, deduplicated: false } as never;
          },
        },
      ),
    });
    const relationInput = { relation_id: "r1" } as never;
    const assetInput = { asset_id: "a1" } as never;
    await facade.putRelation(relationInput);
    await facade.putAsset(assetInput);
    expect(relationSeen).toBe(relationInput);
    expect(assetSeen).toBe(assetInput);

    const denied = createKernelFacade({ session: makeSession([]) });
    await expect(denied.putRelation(relationInput)).rejects.toBeInstanceOf(OperationNotGrantedError);
    await expect(denied.putAsset(assetInput)).rejects.toBeInstanceOf(OperationNotGrantedError);
  });

  it("facade object itself is frozen and exposes no adapter/session keys", () => {
    const facade = createKernelFacade({ session: makeSession([]) }) as unknown as Record<
      string,
      unknown
    >;
    expect(Object.isFrozen(facade)).toBe(true);
    expect(facade.session).toBeUndefined();
    expect(facade.adapter).toBeUndefined();
    expect(facade.runtime).toBeUndefined();
  });
});

describe("K20 original signed source mutation binding",()=>{
  const ws="workspace:source:k20";
  const command={workspace_id:ws,object_id:"o:k20",schema_id:"iwxa.demo.note",
    schema_version:"1.0.0",base_revision:0,data:{title:"original"},extensions:{},
    event:{event_type:"business.created",payload:{title:"original"}}};
  const receipt={object:{workspace_id:ws,object_id:"o:k20",revision:1},event:{workspace_id:ws}};
  const sessionFor=(putObject:KernelSession["t1"]["putObject"])=>({
    ...makeSession(["t1.putObject"],{putObject}),contract_version:"1.3.0",runtime_version:"0.3.6",
  }) as KernelSession;
  it("routes only after genuine signed Access; returns the original receipt once, never raw T2 again",async()=>{
    const authority=createTemporaryOriginalPersonalAuthority({workspaceId:ws});
    let raw=0,routed=0;
    const facade=createKernelFacade({
      session:sessionFor(async()=>{raw++;return receipt as never;}),
      signedKernelAccess:authority.access,
      routeOriginalMutation:async(method,args)=>{
        expect(authority.proofCount).toBeGreaterThan(0);
        expect(method).toBe("putObject");expect(args).toEqual([command]);routed++;
        return {kind:"CAPTURED",originalReceipt:receipt};
      },
    });
    expect(await facade.putObject(command as never)).toEqual(receipt);
    expect(routed).toBe(1);expect(raw).toBe(0);
    authority.revoke();
    await expect(facade.putObject(command as never)).rejects.toBeDefined();
    expect(routed).toBe(1);expect(raw).toBe(0);
  });
  it("preserves original local route and does not fall back after unknown capture result",async()=>{
    const authority=createTemporaryOriginalPersonalAuthority({workspaceId:ws});
    let raw=0;
    const session=sessionFor(async()=>{raw++;return receipt as never;});
    const local=createKernelFacade({session,signedKernelAccess:authority.access,
      routeOriginalMutation:async()=>({kind:"LOCAL_T3"})});
    expect(await local.putObject(command as never)).toEqual(receipt);
    expect(raw).toBe(1);
    const unknown=createKernelFacade({session,signedKernelAccess:authority.access,
      routeOriginalMutation:async()=>{throw Error("OUTCOME_UNKNOWN");}});
    await expect(unknown.putObject(command as never)).rejects.toThrow("OUTCOME_UNKNOWN");
    expect(raw).toBe(1);
  });
  it("does not enable capture without original signed Access",()=>{
    const session=sessionFor(async()=>receipt as never);
    expect(()=>createKernelFacade({session,routeOriginalMutation:async()=>({kind:"LOCAL_T3"})}))
      .toThrow("T3_D1_ACCESS_OWNER_REQUIRED");
  });
});

describe("K111 optional original commit-order history",()=>{
  const op="t1.listEventCommitWindow",ws="ws:original";
  const page={entries:[],next_after_event_id:null,has_more:false,
    order:"LOCAL_TRANSACTION_COMMIT_ORDER" as const,legacy_history_causal_proven:false as const};
  it("does not invent the new method on DB8 or a grant-only declaration",()=>{
    const legacy={...makeSession(["t1.listEventsSince",op]),contract_version:"1.3.0"} as KernelSession;
    expect(createKernelFacade({session:legacy}).hasOperation(op)).toBe(false);
    expect(createKernelFacade({session:legacy}).listEventCommitWindow).toBeUndefined();
  });
  it("requires both grants, actual method and matching contract",async()=>{
    const calls:unknown[][]=[];
    const reader:NonNullable<KernelSession["t1"]["listEventCommitWindow"]>=async(...args)=>{
      calls.push(args);return page;
    };
    for(const [version,grants] of [
      ["1.2.0",["t1.listEventsSince",op]],["1.3.0",[op]],["1.3.0",["t1.listEventsSince"]]
    ] as const){
      const session={...makeSession([...grants],{listEventCommitWindow:reader}),contract_version:version} as KernelSession;
      expect(createKernelFacade({session}).listEventCommitWindow).toBeUndefined();
    }
    const session={...makeSession(["t1.listEventsSince",op],{listEventCommitWindow:reader}),contract_version:"1.3.0"} as KernelSession;
    const facade=createKernelFacade({session});
    expect(facade.hasOperation(op)).toBe(true);
    expect(await facade.listEventCommitWindow!(ws,null,16)).toBe(page);
    expect(calls).toEqual([[ws,null,16]]);
  });
});

describe("K124 separately negotiated original Object Event window",()=>{
  const op="t1.listEventObjectCommitWindow",ws="ws:original",object="object:original";
  const page={entries:[],next_after_event_id:null,has_more:false,
    order:"LOCAL_TRANSACTION_COMMIT_ORDER" as const,legacy_history_causal_proven:false as const};
  it("requires both exact grants and actual method, never emulates from the Workspace window",async()=>{
    const calls:unknown[][]=[];
    const reader:NonNullable<KernelSession["t1"]["listEventObjectCommitWindow"]>=async(...args)=>{calls.push(args);return page;};
    for(const [version,grants] of [
      ["1.2.0",["t1.listEventsSince",op]],["1.3.0",[op]],["1.3.0",["t1.listEventsSince","t1.listEventCommitWindow"]]
    ] as const){
      const session={...makeSession([...grants],{listEventObjectCommitWindow:reader}),contract_version:version} as KernelSession;
      expect(createKernelFacade({session}).listEventObjectCommitWindow).toBeUndefined();
    }
    const grantOnly={...makeSession(["t1.listEventsSince",op]),contract_version:"1.3.0"} as KernelSession;
    expect(createKernelFacade({session:grantOnly}).hasOperation(op)).toBe(false);
    const full={...makeSession(["t1.listEventsSince",op],{listEventObjectCommitWindow:reader}),contract_version:"1.3.0"} as KernelSession;
    const facade=createKernelFacade({session:full});
    expect(facade.hasOperation(op)).toBe(true);
    expect(facade.hasOperation("t1.listEventCommitWindow")).toBe(false);
    expect(await facade.listEventObjectCommitWindow!(ws,object,null,16)).toBe(page);
    expect(calls).toEqual([[ws,object,null,16]]);
  });
});
