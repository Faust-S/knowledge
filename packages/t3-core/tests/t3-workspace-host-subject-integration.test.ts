import {describe,it,expect} from "vitest";
import {createKernelFacade,createModuleContextProvider,CurrentWorkspaceStore} from "@/workspace-host/context";
import {HostRouter,RouteRegistry,activeHostRouteBindings} from "@/workspace-host/router";
import {HostContributionHub} from "@/workspace-host/registries";
import type {KernelSession} from "@/kernel-client/types";
import type {SubjectAccessHostOwner} from "@/t3/subject-kernel-module-facade.mjs";

function input(){
  const calls: string[]=[];
  const session={
    contract_version:"1.3.0",runtime_version:"0.3.6",
    service:{service_id:"d1.host.test"},
    granted_operations:["t1.getWorkspace","t1.putObject","t1.listObjects",
      "t1.listWorkspaces","t2.exportPreview"],
    granted_levels:["T1","T2"],
    t1:{
      getWorkspace:async (ws:string)=>{calls.push("getWorkspace");return {workspace_id:ws}},
      putObject:async (value:{workspace_id:string;object_id:string})=>{
        calls.push("putObject");return {object:{workspace_id:value.workspace_id,
          object_id:value.object_id,revision:1},
          event:{workspace_id:value.workspace_id,event_id:"event:1"}}},
      listObjects:async (q:{workspace_id:string})=>{calls.push("listObjects");
        return [{workspace_id:q.workspace_id,object_id:"item:1"}]},
      listWorkspaces:async ()=>{calls.push("listWorkspaces");
        return [{workspace_id:"ws:other"}]},
    },
    t2:{
      exportPreview:async ()=>{calls.push("exportPreview");return {workspaces:[]}},
    },
  } as unknown as KernelSession;
  let selected="ws:person";
  const ctx=()=>({kind:"PERSONAL",context_id:"personal",actor_id:"person:one",
    principal_id:"person:one",role_id:"role:writer",grant_id:"grant:person",
    realm_id:"realm:person",audience:"host:t3",resource:selected,
    purpose:"purpose:work",workspace_id:selected,organization_id:null,scope_revision:1});
  const owner={
    currentContext:ctx,
    actionFor:()=>"object.read",
    operationDigest:()=>"a".repeat(64),
    async authorize(request:unknown){
      const r=request as {grantId:string};
      const t=Date.now();
      return {schema:"IWXA_T3_AUTHORIZATION_DECISION/1",
        outcome:"PERMITTED",allowed:true,evidenceOnly:true,
        requestDigest:"b".repeat(64),policyDigest:"c".repeat(64),
        statusSequence:1,evaluatedAt:new Date(t).toISOString(),
        statusObservedAt:new Date(t).toISOString(),
        validUntil:new Date(t+60000).toISOString(),
        authorityPath:[{grantId:r.grantId}]};
    },
    verifyDecisionBinding:()=>true,
  } as SubjectAccessHostOwner;
  return {session,owner,calls,select:(x:string)=>{selected=x}};
}
describe("T3 D1 at the inherited T2 Workspace ModuleContext Host seam",()=>{
  it("keeps original T2 facade untouched until the trusted Host enables D1",async()=>{
    const f=input();
    const inherited=createKernelFacade({session:f.session});
    expect(inherited.hasOperation("t1.listWorkspaces")).toBe(true);
    await inherited.listWorkspaces();
    expect(f.calls).toEqual(["listWorkspaces"]);
  });
  it("passes the same T2 object operation only through owner-authorized scoped facade",async()=>{
    const f=input();
    const protectedKernel=createKernelFacade({session:f.session,subjectAccess:f.owner});
    expect(protectedKernel.grantedOperations).toContain("t1.putObject");
    expect(protectedKernel.grantedOperations).not.toContain("t1.listWorkspaces");
    expect(protectedKernel.grantedOperations).not.toContain("t2.exportPreview");
    expect(protectedKernel.hasOperation("t1.listWorkspaces")).toBe(false);
    await expect(protectedKernel.putObject({workspace_id:"ws:person",object_id:"item:1"} as never))
      .resolves.toHaveProperty("object.workspace_id","ws:person");
    await expect(protectedKernel.listObjects({workspace_id:"ws:person"}))
      .resolves.toHaveLength(1);
    expect(f.calls).toEqual(["putObject","listObjects"]);
    await expect(protectedKernel.listWorkspaces()).rejects.toMatchObject({
      code:"T3_SUBJECT_OPERATION_REQUIRES_AUTHORIZED_HOST"});
    await expect(protectedKernel.exportPreview({workspaces:["ws:person"]})).rejects.toMatchObject({
      code:"T3_SUBJECT_OPERATION_REQUIRES_AUTHORIZED_HOST"});
    await expect(protectedKernel.authorizationForWorkspace("ws:person")).rejects.toMatchObject({
      code:"T3_SUBJECT_OPERATION_REQUIRES_AUTHORIZED_HOST"});
    expect(f.calls).toEqual(["putObject","listObjects"]);
  });
  it("denies foreign workspace before inherited T2 kernel invocation",async()=>{
    const f=input();const kernel=createKernelFacade({session:f.session,subjectAccess:f.owner});
    await expect(kernel.getWorkspace("ws:foreign")).rejects.toMatchObject({
      code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
    f.select("ws:another");
    await expect(kernel.listObjects({workspace_id:"ws:person"})).rejects.toMatchObject({
      code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
    expect(f.calls).toEqual([]);
  });
  it("injects the guarded Kernel into production module context without exposing owner",()=>{
    const f=input();const routes=new RouteRegistry();routes.registerMany(activeHostRouteBindings());
    const router=new HostRouter({registry:routes,driver:{
      current:()=>({pathname:"/workspace/",hash:""}),
      navigate:()=>{},subscribe:()=>()=>{},
    }});
    const hub=new HostContributionHub({routeRegistry:routes,
      hostRouteBindings:activeHostRouteBindings(),grantedOperations:[]});
    const provider=createModuleContextProvider({
      session:f.session,subjectAccess:f.owner,router,hub,
      currentWorkspaceStore:new CurrentWorkspaceStore(),
      termResolver:(_key:string,fallback?:string)=>fallback??"",
      panelsState:{request:()=>{}},dashboardState:{refresh:()=>{}},
      diagnosticsSink:{report:()=>{}},
    });
    const ctx=provider.createContext("test-module");
    expect(ctx.kernel.hasOperation("t1.putObject")).toBe(true);
    expect(ctx.kernel.hasOperation("t1.listWorkspaces")).toBe(false);
    expect(Object.isFrozen(ctx.kernel)).toBe(true);
    expect("subjectAccess" in ctx).toBe(false);
    expect("access" in ctx.kernel).toBe(false);
    expect("session" in ctx.kernel).toBe(false);
  });
});
