import { describe, it, expect } from "vitest";
import { createKernelFacade } from "@/workspace-host/context";
import type { KernelSession } from "@/kernel-client/types";
import { OperationNotGrantedError } from "@/kernel-client/adapter";

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


describe("Installed company package connection remains private",()=>{
  const id="iwxa.personal-agent.workspace";
  const exchangeId="iwxa.personal-agent.exchange.workspace";
  const ops=["t2.exportPreview","t2.exportPackage","t2.confirmExport","t2.importPreview","t2.importCommit","t2.importCancel"];
  const identify=(s:KernelSession,service_id:string)=>Object.assign(s,{
    service:{service_id,base_path:"/workspace/",service_version:"0.6.0"},
    contract_version:"1.3.0",runtime_version:"0.3.6"});
  it("fails closed without the private full-scope connection and exposes no private lifecycle grants",()=>{
    const product=identify(makeSession(["t1.getWorkspace",...ops]),id);
    const access=()=>null;
    const blocked=createKernelFacade({session:product,signedKernelAccess:access});
    expect(blocked.hasOperation("t2.exportPackage")).toBe(false);
    const privateExchange=identify(makeSession([...ops,"t1.purgeCommit","t1.deleteObject"]),exchangeId);
    const facade=createKernelFacade({session:product,signedKernelAccess:access,trustedCompanyExchangeSession:privateExchange});
    expect(facade.hasOperation("t2.exportPackage")).toBe(true);
    expect(facade.hasOperation("t1.purgeCommit")).toBe(false);
    expect(facade.hasOperation("t1.deleteObject")).toBe(false);
    expect(facade.sessionInfo.service_id).toBe(id);
    expect(()=>createKernelFacade({session:product,trustedCompanyExchangeSession:privateExchange})).toThrow("T3_COMPANY_EXCHANGE_PRIVATE_SESSION_INVALID");
    expect(()=>createKernelFacade({session:product,signedKernelAccess:access,trustedCompanyExchangeSession:identify(makeSession(ops),"foreign.workspace")})).toThrow("T3_COMPANY_EXCHANGE_PRIVATE_SESSION_INVALID");
  });
});
