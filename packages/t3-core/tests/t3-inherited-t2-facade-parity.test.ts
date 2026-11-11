import { describe, it, expect } from "vitest";
import { createKernelFacade, createModuleContextProvider, CurrentWorkspaceStore } from "@/workspace-host/context";
import { HostRouter, RouteRegistry, activeHostRouteBindings } from "@/workspace-host/router";
import { HostContributionHub } from "@/workspace-host/registries";
import type { KernelSession } from "@/kernel-client/types";

// Normative T2 Runtime 1.3.0 surface. T3 must never shrink these capabilities
// in its ordinary ModuleContext to compensate for unfinished D1 enrollment.
const T1_METHODS = [
  "listWorkspaces", "getWorkspace", "createWorkspace",
  "listObjects", "getObject", "listEventsSince", "putObject", "deleteObject",
  "putRelation", "deleteRelation", "listAssets", "getAsset",
  "putAsset", "deleteAsset", "softDeleteWorkspace", "restoreWorkspace",
  "purgePreview", "purgeCommit", "purgeCancel",
] as const;
const T2_METHODS = [
  "exportPreview", "exportPackage", "confirmExport",
  "importPreview", "importCommit", "importCancel",
] as const;
const OP_IDS = [
  ...T1_METHODS.map(m => "t1." + m),
  ...T2_METHODS.map(m => "t2." + m),
];
const FACADE_METHODS = [
  ...T1_METHODS, ...T2_METHODS,
  "authorizationForWorkspace", "hasCapability", "hasOperation",
] as const;

function makeSession() {
  const invoked: Array<{method:string; args:unknown[]; value:unknown}> = [];
  function method(method:string) {
    return (...args:unknown[]) => {
      const value = Object.freeze({method,args});
      invoked.push({method,args,value});
      return Promise.resolve(value);
    };
  }
  const t1 = Object.fromEntries(T1_METHODS.map(name => [name,method(name)]));
  const t2 = Object.fromEntries(T2_METHODS.map(name => [name,method(name)]));
  const session = {
    contract_version:"1.3.0",runtime_version:"0.3.6",
    service:{service_id:"t3.t2.baseline"},mode:"full",
    granted_operations:[...OP_IDS],granted_levels:["T1","T2"],
    t1,t2,
    authorization:{
      forWorkspace:method("authorizationForWorkspace"),
      hasCapability:method("hasCapability"),
    },
  } as unknown as KernelSession;
  return {session,invoked};
}

describe("T3 baseline — exact inherited T2 KernelFacade without D1 replacement",()=>{
  it("does not erase or synthesize operations, methods or capability metadata",()=>{
    const f=makeSession(),kernel=createKernelFacade({session:f.session});
    expect(kernel.grantedOperations).toEqual(OP_IDS);
    expect(OP_IDS.every(op=>kernel.hasOperation(op as never))).toBe(true);
    const methods = Object.entries(kernel).filter(([,v])=>typeof v==="function")
      .map(([key])=>key).sort();
    expect(methods).toEqual([...FACADE_METHODS].sort());
    expect(kernel.grantedLevels).toEqual(["T1","T2"]);
    expect(Object.isFrozen(kernel)).toBe(true);
    expect("session" in kernel).toBe(false);
    expect("adapter" in kernel).toBe(false);
  });
  it("retains original T2 return identity and arguments for all T1 and T2 methods",async()=>{
    const f=makeSession(),kernel=createKernelFacade({session:f.session});
    const input=Object.freeze({workspace_id:"ws:personal",probe:true});
    for(const method of [...T1_METHODS,...T2_METHODS]){
      const callable=(kernel as unknown as Record<string,(...args:unknown[])=>Promise<unknown>>)[method];
      expect(typeof callable).toBe("function");
      const result=await callable(input,"source:object");
      const last=f.invoked.at(-1)!;
      expect(last.method).toBe(method);
      expect(last.args[0]).toBe(input);
      expect(result).toBe(last.value);
    }
    await kernel.authorizationForWorkspace("ws:personal");
    expect(f.invoked.at(-1)?.method).toBe("authorizationForWorkspace");
    await kernel.hasCapability("ws:personal","cap:read");
    expect(f.invoked.at(-1)?.method).toBe("hasCapability");
  });
  it("module context offers all original capabilities including import, purge and global listing",()=>{
    const f=makeSession(),registry=new RouteRegistry();
    registry.registerMany(activeHostRouteBindings());
    const router=new HostRouter({registry,driver:{
      current:()=>({pathname:"/workspace/",hash:""}),
      navigate:()=>{},subscribe:()=>()=>{},
    }});
    const hub=new HostContributionHub({routeRegistry:registry,
      hostRouteBindings:activeHostRouteBindings(),grantedOperations:OP_IDS as never});
    const provider=createModuleContextProvider({
      session:f.session,router,hub,currentWorkspaceStore:new CurrentWorkspaceStore(),
      termResolver:(_key:string,fallback?:string)=>fallback??"",
      panelsState:{request:()=>{}},dashboardState:{refresh:()=>{}},
      diagnosticsSink:{report:()=>{}},
    });
    const context=provider.createContext("baseline-module");
    expect(context.kernel.grantedOperations).toEqual(OP_IDS);
    for(const operation of OP_IDS) expect(context.kernel.hasOperation(operation as never)).toBe(true);
    for(const method of ["listWorkspaces","purgeCommit","importPreview",
      "importCommit","importCancel","authorizationForWorkspace"])
      expect(typeof (context.kernel as unknown as Record<string,unknown>)[method]).toBe("function");
    expect(Object.isFrozen(context.kernel)).toBe(true);
    expect("subjectAccess" in context).toBe(false);
  });
});
