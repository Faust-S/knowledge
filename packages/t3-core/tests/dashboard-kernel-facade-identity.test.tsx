// @vitest-environment jsdom
import {act,render,waitFor,cleanup} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {createElement,useEffect,useState} from "react";
import {hostRouteRefs} from "@/workspace-host/router";

const mock = vi.hoisted(()=>({runtime:null as unknown}));
vi.mock("@/workspace-host/runtime/WorkspaceHostRuntimeProvider",()=>({
 useWorkspaceHostRuntimeHandle:()=>mock.runtime,
}));
import {HostDashboardSurface} from "@/workspace-host/rendering/HostDashboardSurface";
import {useWorkspaceModuleRuntime} from "@/workspace-host/rendering/ModuleRenderContext";

afterEach(()=>{cleanup();mock.runtime=null;});
it("keeps one Kernel facade while the Host dashboard rerenders",async()=>{
 let contextCalls=0;
 const seen:unknown[]=[];
 let update:((v:unknown)=>void)|null=null;
 const contextProvider={
   createContext(){
     contextCalls++;
     return {profile:{id:"personal",fallback:false},kernel:{id:contextCalls}};
   }
 };
 function Child(){
   const {context}=useWorkspaceModuleRuntime();
   const [,setRevision]=useState(0);
   useEffect(()=>{seen.push(context.kernel);},[context.kernel]);
   useEffect(()=>{update=()=>setRevision(n=>n+1);},[]);
   return createElement("div",{"data-testid":"probe"},"owner card");
 }
 const contribution={
   kind:"dashboard_card",id:"probe",moduleId:"module.test",
   size:"large",requiredOperations:[],loader:async()=>({default:Child})
 };
 const entries=[{
   contribution,ownerModuleId:"module.test",contributionId:"probe"
 }];
 const match={binding:{routeRef:hostRouteRefs.base.home},params:{}};
 const router={currentMatch:()=>match,subscribe:()=>()=>{}};
 const dashboardState={version:()=>0,subscribe:()=>()=>{}};
 mock.runtime={contextProvider,router,dashboardState,
  hub:{dashboard:{visibleEntries:()=>entries}},grantedOperations:[],activeCapabilities:[]};
 const rendered=render(createElement(HostDashboardSurface));
 await waitFor(()=>expect(seen).toHaveLength(1));
 expect(contextCalls).toBe(1);
 // A child-only rerender should not cause a second read effect.
 act(()=>{update?.(null);});
 expect(contextCalls).toBe(1);
 rendered.rerender(createElement(HostDashboardSurface));
 await waitFor(()=>expect(contextCalls).toBe(1));
 expect(seen).toHaveLength(1);
 const newProvider={createContext(){
   contextCalls++;return{profile:{id:"personal",fallback:false},kernel:{id:contextCalls}};
 }};
 mock.runtime={...mock.runtime,contextProvider:newProvider};
 rendered.rerender(createElement(HostDashboardSurface));
 await waitFor(()=>expect(contextCalls).toBe(2));
 expect(seen).toHaveLength(2);
});

it("recovers a failed owner card only after its Kernel context changes",async()=>{
 const consoleError=vi.spyOn(console,"error").mockImplementation(()=>{});
 try {
   function Child(){
     const {context}=useWorkspaceModuleRuntime();
     const sessionId=(context.kernel as unknown as {id:number}).id;
     if(sessionId===1)throw new Error("previous Kernel context unavailable");
     return createElement("div",{"data-testid":"recovered-owner-card"},"new session");
   }
   const contribution={
     kind:"dashboard_card",id:"recovery-card",moduleId:"module.recovery",
     size:"large",requiredOperations:[],loader:async()=>({default:Child}),
   };
   const entries=[{contribution,ownerModuleId:"module.recovery",contributionId:"recovery-card"}];
   const match={binding:{routeRef:hostRouteRefs.base.home},params:{}};
   const router={currentMatch:()=>match,subscribe:()=>()=>{}};
   const dashboardState={version:()=>0,subscribe:()=>()=>{}};
   const provider=(id:number)=>({createContext:()=>({
     profile:{id:"personal",fallback:false},kernel:{id},
   })});
   mock.runtime={contextProvider:provider(1),router,dashboardState,
     hub:{dashboard:{visibleEntries:()=>entries}},
     grantedOperations:[],activeCapabilities:[]};
   const rendered=render(createElement(HostDashboardSurface));
   await waitFor(()=>expect(rendered.getByTestId("dashboard-card-error")).toBeTruthy());
   // Rerendering with the same provider must not hide the recorded error.
   rendered.rerender(createElement(HostDashboardSurface));
   expect(rendered.getByTestId("dashboard-card-error")).toBeTruthy();
   mock.runtime={...mock.runtime,contextProvider:provider(2)};
   rendered.rerender(createElement(HostDashboardSurface));
   await waitFor(()=>expect(rendered.getByTestId("recovered-owner-card")).toBeTruthy());
   expect(rendered.queryByTestId("dashboard-card-error")).toBeNull();
 }finally{consoleError.mockRestore();}
});
