import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import type { KernelSession } from "@/kernel-client/types";
import { createWorkspaceHostRuntime } from "@/workspace-host/runtime";

const ws = "ws:personal", at = "2026-11-11T12:00:00.000Z";
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const bindings = {
  objects: [{ schema_id:"d06.order",schema_version:"1.0.0",semantic_kind:"Process" }],
  events: [{ event_type:"order.accepted",semantic_kind:"Event" }],
};
function fixture() {
  let status = "ACTIVE", reads = 0, checks = 0, onList: (()=>void)|null = null;
  const workspace = { workspace_id:ws,created_at:at,updated_at:at,profile:"domain",capabilities:[] };
  const object = { workspace_id:ws,object_id:"order:1",revision:1,
    schema_id:"d06.order",schema_version:"1.0.0",data:{name:"private"},
    extensions:{},created_at:at,updated_at:at,
    created_by_service:"d06",updated_by_service:"d06" };
  const event = { workspace_id:ws,event_id:"event:1",event_type:"order.accepted",
    service_id:"d06",object_id:"order:1",revision:1,occurred_at:at,
    payload:{name:"private"} };
  const session = {
    contract_version:"1.3.0",runtime_version:"0.3.6",
    service:{service_id:"t3.host"},mode:"full",granted_levels:["T0","T1","T2"],
    granted_operations:["t1.getWorkspace","t1.listObjects","t1.getObject",
      "t1.listEventsSince","t1.putObject","t2.importPreview"],
    authorization:{forWorkspace:async()=>({}),hasCapability:async()=>true},
    t1:{
      async getWorkspace(id:string){reads++;return id===ws?workspace:null;},
      async listObjects(query:{workspace_id:string}){
        reads++;if(onList){const callback=onList;onList=null;callback();}
        return query.workspace_id===ws?[object]:[];
      },
      async getObject(id:string,oid:string){
        reads++;return id===ws&&oid==="order:1"?
          {object,relations:{outgoing:[],incoming:[]}}:null;
      },
      async listEventsSince(id:string){reads++;return id===ws?[event]:[];},
    },
  } as unknown as KernelSession;
  const selected = {kind:"PERSONAL",context_id:"context:person",actor_id:"person:1",
    principal_id:"person:1",role_id:"role:member",grant_id:"grant:1",
    realm_id:"realm:person",audience:"host:t3",resource:ws,workspace_id:ws,
    purpose:"activity.read",organization_id:null,scope_revision:1};
  const signedActivityAccess = {
    currentContext:()=>selected,
    actionFor:()=>"activity.read",
    operationDigest:(input:unknown)=>hash(input),
    authorize:(request:unknown)=>{
      checks++;
      const now=Date.now();
      return {schema:"IWXA_T3_AUTHORIZATION_DECISION/1",evidenceOnly:true,
        allowed:status==="ACTIVE",outcome:status==="ACTIVE"?"PERMITTED":"DENIED",
        requestDigest:hash(request),policyDigest:hash("policy"),statusSequence:1,
        authorityPath:[{grantId:"grant:1"}],evaluatedAt:new Date(now).toISOString(),
        statusObservedAt:new Date(now).toISOString(),
        validUntil:new Date(now+60000).toISOString()};
    },
    verifyDecisionBinding:(request:unknown,decision:unknown)=>
      (decision as {requestDigest:string}).requestDigest===hash(request),
  };
  return {session,signedActivityAccess,reads:()=>reads,checks:()=>checks,
    revoke:()=>{status="REVOKED";},onList:(action:()=>void)=>{onList=action;}};
}
async function open(f:ReturnType<typeof fixture>,signed=true) {
  return createWorkspaceHostRuntime({
    session:f.session,workspaceConfig:{modules:[]},bindLegacyHashDriver:false,
    termResolver:(_key,fallback)=>fallback??"",
    ...(signed?{signedActivityAccess:f.signedActivityAccess}:{}),
  });
}
describe("T3 D1 signed Activity in the actual Workspace Host runtime",()=>{
  it("uses original T2 KernelFacade, signed per-read JIT and the selected Workspace",async()=>{
    const f=fixture(),host=await open(f);
    try {
      await expect(host.readAuthorizedActivity({bindings})).rejects.toMatchObject({
        code:"T3_ACTIVITY_WORKSPACE_NOT_SELECTED"});
      host.currentWorkspaceStore.set({workspace_id:ws} as never);
      const result=await host.readAuthorizedActivity({bindings});
      expect(result.nodes).toHaveLength(1);
      expect(result.events).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("private");
      expect(f.reads()).toBe(7);
      expect(f.checks()).toBe(f.reads());
      const kernel=host.contextProvider.createContext("d06").kernel;
      expect(kernel.hasOperation("t2.importPreview")).toBe(true);
      for(const method of ["importPreview","listWorkspaces","purgeCommit"])
        expect(typeof (kernel as unknown as Record<string,unknown>)[method]).toBe("function");
      expect("signedActivityAccess" in host).toBe(false);
    }finally{await host.dispose();}
  });
  it("refuses revoked, foreign selected target, and missing trusted owner before Kernel",async()=>{
    const f=fixture(),host=await open(f),unsigned=await open(f,false);
    try{
      host.currentWorkspaceStore.set({workspace_id:ws} as never);
      unsigned.currentWorkspaceStore.set({workspace_id:ws} as never);
      f.revoke();
      await expect(host.readAuthorizedActivity({bindings})).rejects.toMatchObject({
        code:"T3_ACCESS_NOT_PERMITTED"});
      await expect(host.readAuthorizedActivity({bindings,workspace_id:"ws:other"}))
        .rejects.toMatchObject({code:"T3_ACTIVITY_SELECTED_WORKSPACE_MISMATCH"});
      await expect(unsigned.readAuthorizedActivity({bindings})).rejects.toMatchObject({
        code:"T3_D1_ACCESS_OWNER_REQUIRED"});
      await expect(host.readAuthorizedActivity({bindings,
        signedAccess:f.signedActivityAccess} as never)).rejects.toMatchObject({
        code:"T3_ACTIVITY_OWNER_OVERRIDE_FORBIDDEN"});
      expect(f.reads()).toBe(0);
    }finally{await host.dispose();await unsigned.dispose();}
  });
  it("invalidates A-B-A focus races and old handles after Host disposal",async()=>{
    const f=fixture(),host=await open(f);
    host.currentWorkspaceStore.set({workspace_id:ws} as never);
    f.onList(()=>{
      host.currentWorkspaceStore.set({workspace_id:"ws:other"} as never);
      host.currentWorkspaceStore.set({workspace_id:ws} as never);
    });
    await expect(host.readAuthorizedActivity({bindings})).rejects.toMatchObject({
      code:"T3_ACTIVITY_WORKSPACE_CHANGED_DURING_READ"});
    await host.dispose();
    await expect(host.readAuthorizedActivity({bindings})).rejects.toMatchObject({
      code:"T3_HOST_DISPOSED"});
  });
});
