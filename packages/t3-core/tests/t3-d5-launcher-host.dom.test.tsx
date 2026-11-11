// @vitest-environment jsdom
// Public Host acceptance of a compile-time external model launcher. The real
// WebLLM implementation remains in the private owner; no model/source copied.
import {act,cleanup,fireEvent,render,waitFor} from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {createElement,Fragment} from "react";
import {hostRouteRefs} from "@/workspace-host/router";
import {HostPanelsState} from "@/workspace-host/context/create-panels-facade";
import {useWorkspaceModuleRuntime} from "@/workspace-host/rendering/ModuleRenderContext";

const mock=vi.hoisted(()=>({runtime:null as unknown}));
vi.mock("@/workspace-host/runtime/WorkspaceHostRuntimeProvider",()=>({
  useWorkspaceHostRuntimeHandle:()=>mock.runtime,
}));
import {HostDashboardSurface} from "@/workspace-host/rendering/HostDashboardSurface";
import {HostPanelSurface} from "@/workspace-host/rendering/HostPanelSurface";

afterEach(()=>{cleanup();mock.runtime=null;});

it("user opens external D5 panel from the existing T3 overview without another Host",async()=>{
  const owner="iwxa.t3.local-inference";
  const panelId=owner+".panel";
  const commandId=owner+".open";
  const state=new HostPanelsState();
  function ModelLauncher(){
    const {context}=useWorkspaceModuleRuntime();
    return createElement("button",{type:"button",
      disabled:!context.commands.has(commandId),
      onClick:()=>void context.commands.invoke(commandId)},
      "Открыть локальную модель");
  }
  function ModelPanel(){
    const {context}=useWorkspaceModuleRuntime();
    const id=context.currentWorkspace.get()?.workspace_id||"не выбран";
    return createElement("div",{"data-testid":"external-model-panel"},
      "Local WebLLM, Workspace: "+id);
  }
  const card={kind:"dashboard_card" as const,id:owner+".launcher",
    moduleId:owner,size:"small" as const,
    requiredOperations:["t1.getWorkspace"] as const,
    loader:async()=>({default:ModelLauncher})};
  const panel={kind:"panel" as const,id:panelId,moduleId:owner,
    slot:"inspector" as const,requiredOperations:["t1.getWorkspace"] as const,
    loader:async()=>({default:ModelPanel})};
  const matches={binding:{routeRef:hostRouteRefs.base.home},params:{}};
  const router={currentMatch:()=>matches,subscribe:()=>()=>{}};
  const commands={
    has:(id:string)=>id===commandId,
    invoke:async(id:string)=>{
      if(id!==commandId)throw Error("UNKNOWN_COMMAND");
      state.request(panelId,"open");
      return {opened:true};
    }
  };
  const profile={id:"generic",fallback:false};
  const context={profile,currentWorkspace:{get:()=>null},commands};
  const contextProvider={createContext:(id:string)=>{
    if(id!==owner)throw Error("CROSS_MODULE_CONTEXT");
    return context;
  }};
  mock.runtime={
    contextProvider,router,panelsState:state,
    dashboardState:{version:()=>0,subscribe:()=>()=>{}},
    hub:{
      dashboard:{visibleEntries:()=>[{contribution:card,ownerModuleId:owner,contributionId:card.id}]},
      panels:{get:(id:string)=>id===panelId?{
        contribution:panel,ownerModuleId:owner,contributionId:panel.id,
        requiredOperations:panel.requiredOperations,
        requiredCapabilitiesAll:[],requiredCapabilitiesAny:[],
      }:null},
    },
    grantedOperations:["t1.getWorkspace"],activeCapabilities:[],
  };
  const component=()=>createElement(Fragment,null,
    createElement(HostDashboardSurface),
    createElement(HostPanelSurface,{slot:"inspector"}));
  const screen=render(component());
  const open=await screen.findByRole("button",{name:"Открыть локальную модель"});
  expect(screen.queryByTestId("external-model-panel")).toBeNull();
  await act(async()=>fireEvent.click(open));
  await waitFor(()=>expect(screen.getByTestId("external-model-panel").textContent)
    .toContain("Workspace: не выбран"));
  expect(state.openIds()).toEqual([panelId]);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Закрыть панель"})));
  await waitFor(()=>expect(screen.queryByTestId("external-model-panel")).toBeNull());
  expect(state.openIds()).toEqual([]);
});
