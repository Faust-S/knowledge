import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { KernelSession } from "@/kernel-client/types";
import { createWorkspaceHostRuntime } from "@/workspace-host/runtime";

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const digest = "d".repeat(64);
const now = Date.parse("2026-11-11T18:00:00.000Z");
function fixture() {
  let currentName = "alpha", revision = 1, active = true;
  const calls: Array<{method: string; workspace: string}> = [];
  const ws = () => "ws:" + currentName;
  const context = () => ({
    kind: "CORP",context_id: "corp:" + currentName,actor_id:"person:worker",
    principal_id:"org:" + currentName,role_id:"role:worker",
    grant_id:"grant:" + currentName,realm_id:"realm:" + currentName,
    audience:"host:t3",resource:ws(),purpose:"activity.read",
    workspace_id:ws(),organization_id:"org:" + currentName,
    scope_revision:revision,
  });
  const workspace = (id: string) => ({
    workspace_id:id,profile:"domain",capabilities:[],
    created_at:"2026-11-11T12:00:00.000Z",
    updated_at:"2026-11-11T12:00:00.000Z",
  });
  const session = {
    contract_version:"1.3.0",runtime_version:"0.3.6",
    service:{service_id:"t3.original"},mode:"full",granted_levels:["T1","T2"],
    granted_operations:[
      "t1.listWorkspaces","t1.getWorkspace","t1.putObject",
      "t2.importPreview","t2.importCommit","t2.importCancel",
    ],
    authorization:{
      async forWorkspace(id:string) {calls.push({method:"authorization",workspace:id});
        return {workspace_id:id,decision:"ACTIVE"};},
      async hasCapability(id:string) {calls.push({method:"hasCapability",workspace:id});
        return true;},
    },
    t1:{
      async listWorkspaces() {calls.push({method:"listWorkspaces",workspace:"all"});
        return [workspace("ws:alpha"),workspace("ws:beta")];},
      async getWorkspace(id:string) {calls.push({method:"getWorkspace",workspace:id});
        return workspace(id);},
      async putObject(input:{workspace_id:string;object_id:string}) {
        calls.push({method:"putObject",workspace:input.workspace_id});
        return {object:{...input,revision:1},event:{workspace_id:input.workspace_id,event_id:"event:1"}};
      },
    },
    t2:{
      async importPreview(bytes:Uint8Array) {
        calls.push({method:"importPreview",workspace:ws()});
        expect(bytes).toEqual(Uint8Array.from([1,2,3]));
        return {preview_token:"import:token",package_digest:digest,
          expires_at:new Date(now+60000).toISOString(),
          preview:{package_digest:digest,manifest:{workspaces:[ws()]},
            workspaces:[{workspace_id:ws()}],objects:[],conflicts:[]}};
      },
      async importCommit(input:{plan:{mode:string}}) {
        calls.push({method:"importCommit",workspace:ws()});
        return {package_digest:digest,mode:input.plan.mode,
          workspace_id_map:{[ws()]:ws()},skipped_conflicts:[]};
      },
      async importCancel() {
        calls.push({method:"importCancel",workspace:ws()});
        return true;
      },
    },
  } as unknown as KernelSession;
  // Contract-level signed owner. Separate private T3 E2E verifies Ed25519,
  // enrollment, registry and proof; this test verifies T3 Host dispatch.
  const access = {
    currentContext: context,
    actionFor: (operation:string) => operation,
    operationDigest: (v:unknown) => hash(v),
    authorize: (request:unknown) => {
      const c=context(),r=request as {grantId:string};
      return {schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
        allowed:active,outcome:active?"PERMITTED":"DENIED",evidenceOnly:true,
        productionActivation:false,requestDigest:hash(request),
        policyDigest:hash("policy"),operationDigest:hash("operation"),
        evidenceDigest:hash("evidence"),organizationId:c.organization_id,
        workspaceId:c.workspace_id,grantId:r.grantId,
        statusSequence:revision,validUntil:new Date(now+60000).toISOString(),
        doesNotTransferData:true,doesNotAcceptCorporateCopy:true};
    },
    verifyDecisionBinding: (req:unknown,decision:unknown) =>
      (decision as {requestDigest:string}).requestDigest===hash(req),
  };
  return {session,calls,access,select:(name:string)=>{
    currentName=name;revision++;},revoke:()=>{active=false;},
    workspace:ws};
}
async function open(f:ReturnType<typeof fixture>,enabled=true) {
  return createWorkspaceHostRuntime({
    session:f.session,workspaceConfig:{modules:[]},bindLegacyHashDriver:false,
    termResolver:(_key,fallback)=>fallback??"",
    ...(enabled?{signedKernelAccess:()=>f.access}:{}),
  });
}
describe("T3 D1 original ModuleContext Kernel with signed corporate subject",()=>{
  it("preserves the complete T2 API while executing approved writes in the original Kernel",async()=>{
    const f=fixture(),host=await open(f);
    try {
      const kernel=host.contextProvider.createContext("d06").kernel;
      const inherited=host.contextProvider.createContext("d08").kernel;
      expect(kernel).toBe(inherited);
      for (const name of ["listWorkspaces","importPreview","importCommit",
        "importCancel","purgePreview","purgeCommit","purgeCancel",
        "exportPackage","putObject","deleteObject","putAsset",
        "softDeleteWorkspace","authorizationForWorkspace","hasCapability"]) {
        expect(typeof (kernel as unknown as Record<string,unknown>)[name]).toBe("function");
      }
      expect(kernel.hasOperation("t1.putObject")).toBe(true);
      const x=await kernel.putObject({workspace_id:"ws:alpha",object_id:"item:1",
        schema_id:"demo",schema_version:"1.0.0",data:{x:1},event:{event_type:"created"}});
      expect(x.object.workspace_id).toBe("ws:alpha");
      expect(f.calls.filter(c=>c.method==="putObject")).toHaveLength(1);
      await expect(kernel.putObject({workspace_id:"ws:beta",object_id:"item:2",
        schema_id:"demo",schema_version:"1.0.0",data:{},event:{event_type:"created"}}))
        .rejects.toMatchObject({code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
      expect(f.calls.filter(c=>c.method==="putObject")).toHaveLength(1);
      expect((await kernel.listWorkspaces()).map(x=>x.workspace_id)).toEqual(["ws:alpha"]);
      expect(f.calls.some(c=>c.method==="listWorkspaces")).toBe(false);
      expect((await kernel.authorizationForWorkspace("ws:alpha")).workspace_id).toBe("ws:alpha");
      expect(await kernel.hasCapability("ws:alpha","read")).toBe(true);
      await expect(kernel.authorizationForWorkspace("ws:beta"))
        .rejects.toMatchObject({code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
    }finally{await host.dispose();}
  });
  it("changes corporate owner A-B-A without recreating the original Host or Kernel",async()=>{
    const f=fixture(),host=await open(f);
    const kernel=host.contextProvider.createContext("d06").kernel;
    try{
      for(const name of ["alpha","beta","alpha"]) {
        f.select(name);
        const receipt=await kernel.putObject({workspace_id:"ws:"+name,object_id:"item:1",
          schema_id:"demo",schema_version:"1.0.0",data:{name},
          event:{event_type:"created"}});
        expect(receipt.object.workspace_id).toBe("ws:"+name);
        expect((await kernel.listWorkspaces()).map(x=>x.workspace_id))
          .toEqual(["ws:"+name]);
      }
      expect(f.calls.filter(x=>x.method==="putObject").map(x=>x.workspace))
        .toEqual(["ws:alpha","ws:beta","ws:alpha"]);
      f.revoke();
      const before=f.calls.length;
      await expect(kernel.getWorkspace("ws:alpha"))
        .rejects.toMatchObject({code:"T3_ACCESS_NOT_PERMITTED"});
      expect(f.calls.length).toBe(before);
    }finally{await host.dispose();}
  });
  it("retains the original T2 .iwxa import preview/commit and rejects foreign target plans",async()=>{
    const f=fixture(),host=await open(f);
    try{
      const kernel=host.contextProvider.createContext("d06").kernel;
      const preview=await kernel.importPreview(Uint8Array.from([1,2,3]));
      expect(preview.preview.manifest.workspaces).toEqual(["ws:alpha"]);
      const receipt=await kernel.importCommit({preview_token:preview.preview_token,
        package_digest:preview.package_digest,plan:{mode:"merge",
          workspace_id_map:{"ws:alpha":"ws:alpha"}}});
      expect(receipt.workspace_id_map["ws:alpha"]).toBe("ws:alpha");
      expect(f.calls.map(x=>x.method)).toEqual(["importPreview","importCommit"]);
      const next=await kernel.importPreview(Uint8Array.from([1,2,3]));
      f.select("beta");
      await expect(kernel.importCommit({preview_token:next.preview_token,
        package_digest:next.package_digest,
        plan:{mode:"merge",workspace_id_map:{"ws:alpha":"ws:beta"}}}))
        .rejects.toMatchObject({code:"T3_SUBJECT_IMPORT_PREVIEW_REQUIRED"});
      expect(f.calls.filter(x=>x.method==="importCommit")).toHaveLength(1);
    }finally{await host.dispose();}
  });
  it("when signed owner is required but unavailable, no T2 data may escape",async()=>{
    const f=fixture();
    const host=await createWorkspaceHostRuntime({
      session:f.session,workspaceConfig:{modules:[]},bindLegacyHashDriver:false,
      termResolver:(_key,fallback)=>fallback??"",
      signedKernelAccess:()=>null,
    });
    try{
      const kernel=host.contextProvider.createContext("d06").kernel;
      await expect(kernel.getWorkspace("ws:alpha"))
        .rejects.toMatchObject({code:"T3_D1_ACCESS_OWNER_REQUIRED"});
      await expect(kernel.importPreview(Uint8Array.from([1,2,3])))
        .rejects.toMatchObject({code:"T3_D1_ACCESS_OWNER_REQUIRED"});
      expect(f.calls).toEqual([]);
      expect(typeof kernel.importCommit).toBe("function");
      expect(typeof kernel.purgeCommit).toBe("function");
    }finally{await host.dispose();}
  });
});
