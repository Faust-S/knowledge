// @vitest-environment jsdom
// D1 product route: a trusted Host-injected signed Access owner must reach the
// mounted user interface, not only createWorkspaceHostRuntime() unit fixtures.
// Owner decisions below are CONTRACT DOUBLES. Real Ed25519 / enrollment is
// qualified separately by the original private T3 owner; never copy it here.
import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { KernelSession } from "@/kernel-client/types";
import { WorkspaceHostRuntimeProvider, useWorkspaceHostRuntimeHandle } from "@/workspace-host/runtime";

afterEach(() => cleanup());

function fixture() {
  let selected = "north", active = true;
  const writes: string[] = [];
  const current = () => ({
    kind:"CORP", context_id:"context:"+selected,
    actor_id:"person:worker", principal_id:"org:"+selected,
    role_id:"role:member", grant_id:"grant:"+selected,
    realm_id:"realm:"+selected, audience:"host:t3",
    resource:"ws:"+selected, purpose:"purpose:work",
    workspace_id:"ws:"+selected, organization_id:"org:"+selected,
    scope_revision:1,
  });
  const owner = {
    currentContext:current,
    actionFor:(_operation:string)=>"object.write",
    operationDigest:()=> "a".repeat(64),
    authorize:(request:{grantId:string})=>{
      const c=current();
      return {
        schema:"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1",
        outcome:active?"PERMITTED":"DENIED",
        allowed:active, evidenceOnly:true,productionActivation:false,
        requestDigest:"b".repeat(64),policyDigest:"c".repeat(64),
        operationDigest:"d".repeat(64),evidenceDigest:"e".repeat(64),
        organizationId:c.organization_id,workspaceId:c.workspace_id,
        grantId:request.grantId,statusSequence:1,
        validUntil:new Date(Date.now()+60_000).toISOString(),
        doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
      };
    },
    verifyDecisionBinding:()=>true,
  };
  const session={
    contract_version:"1.3.0",runtime_version:"0.3.6",
    granted_levels:["T0","T1","T2"],granted_operations:["t1.putObject","t1.getWorkspace"],
    service:{service_id:"iwxa.workspace.integration"},mode:"full",
    authorization:{
      forWorkspace:async(id:string)=>({workspace_id:id,decision:"ACTIVE"}),
      hasCapability:async()=>true,
    },
    t1:{
      async putObject(input:{workspace_id:string;object_id:string}) {
        writes.push(input.workspace_id);
        return {object:{...input,revision:1},
          event:{workspace_id:input.workspace_id,event_id:"event:"+input.object_id}};
      },
      async getWorkspace(id:string){return {workspace_id:id};},
    },
  } as unknown as KernelSession;
  return {session,owner,writes,
    select:(name:string)=>{selected=name;},
    revoke:()=>{active=false;}};
}

function UserWorkspace({onSelect}:{onSelect:(name:string)=>void}) {
  const host=useWorkspaceHostRuntimeHandle();
  const [status,setStatus]=useState("idle");
  if(!host)return <p role="status">Host loading</p>;
  const write=async(id:string)=>{
    try{
      const kernel=host.contextProvider.createContext("iwxa.domain.demo").kernel;
      const r=await kernel.putObject({
        workspace_id:id,object_id:"order:"+id,schema_id:"d06.order",
        schema_version:"1.0.0",base_revision:0,data:{title:"Saved in "+id},
        event:{event_type:"d06.order.created"},
      });
      setStatus("saved:"+r.object.workspace_id);
    }catch(e){setStatus((e as {code?:string}).code??String(e));}
  };
  return <section aria-label="Работа с подписанным Workspace">
    <button onClick={()=>void write("ws:north")}>Сохранить в North</button>
    <button onClick={()=>void write("ws:south")}>Сохранить в South</button>
    <button onClick={()=>onSelect("south")}>Выбрать South</button>
    <output data-testid="d1-user-result">{status}</output>
  </section>;
}

it("signed Access passes from mounted Provider to user actions, switches subject, and denies revoked grants",async()=>{
  const f=fixture();
  render(<WorkspaceHostRuntimeProvider
    session={f.session}
    workspaceConfig={{modules:[]}}
    termResolver={(key,fallback)=>fallback??key}
    profile={{id:"generic",fallback:false,
      definition:{id:"generic",label:"Generic",description:"",accent:"#64748b"}}}
    signedKernelAccess={(op)=>op==="putObject"?f.owner:null}
  ><UserWorkspace onSelect={f.select}/></WorkspaceHostRuntimeProvider>);
  // Existing Provider API deliberately keeps its full session/grants; only
  // per-operation signed owner decisions can call the inherited T2 Kernel.
  const north=await screen.findByRole("button",{name:"Сохранить в North"});
  await act(async()=>fireEvent.click(north));
  await waitFor(()=>expect(screen.getByTestId("d1-user-result").textContent)
    .toBe("saved:ws:north"));
  expect(f.writes).toEqual(["ws:north"]);

  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Выбрать South"})));
  await act(async()=>fireEvent.click(north));
  await waitFor(()=>expect(screen.getByTestId("d1-user-result").textContent)
    .toBe("T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"));
  expect(f.writes).toEqual(["ws:north"]);
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Сохранить в South"})));
  await waitFor(()=>expect(screen.getByTestId("d1-user-result").textContent)
    .toBe("saved:ws:south"));
  expect(f.writes).toEqual(["ws:north","ws:south"]);

  f.revoke();
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Сохранить в South"})));
  await waitFor(()=>expect(screen.getByTestId("d1-user-result").textContent)
    .toBe("T3_ACCESS_NOT_PERMITTED"));
  expect(f.writes).toEqual(["ws:north","ws:south"]);
});

it("mounted Host with an absent selected signed owner fails closed instead of falling back to raw T2",async()=>{
  const f=fixture();
  render(<WorkspaceHostRuntimeProvider
    session={f.session}
    workspaceConfig={{modules:[]}}
    termResolver={(key,fallback)=>fallback??key}
    profile={{id:"generic",fallback:false,
      definition:{id:"generic",label:"Generic",description:"",accent:"#64748b"}}}
    signedKernelAccess={()=>null}
  ><UserWorkspace onSelect={f.select}/></WorkspaceHostRuntimeProvider>);
  await act(async()=>fireEvent.click(
    await screen.findByRole("button",{name:"Сохранить в North"})));
  await waitFor(()=>expect(screen.getByTestId("d1-user-result").textContent)
    .toBe("T3_D1_ACCESS_OWNER_REQUIRED"));
  expect(f.writes).toEqual([]);
});
