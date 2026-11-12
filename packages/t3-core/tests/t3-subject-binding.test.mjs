import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSubjectKernelBinding } from "../src/t3/subject-access-binding.mjs";

const now=Date.parse("2026-11-10T12:00:00.000Z");
const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const subjects=[
  {kind:"PERSONAL",context_id:"personal",realm_id:"realm:personal",organization_id:null,workspace_id:"ws:personal",grant_id:"grant:personal"},
  {kind:"CORP",context_id:"corp:one",realm_id:"realm:one",organization_id:"org:one",workspace_id:"ws:one",grant_id:"grant:one"},
  {kind:"CORP",context_id:"corp:two",realm_id:"realm:two",organization_id:"org:two",workspace_id:"ws:two",grant_id:"grant:two"},
].map(c=>({...c,actor_id:"person:one",principal_id:c.kind==="CORP"?c.organization_id:"person:one",role_id:"role:member",
  audience:"host:t3",resource:c.workspace_id,purpose:"purpose:work",scope_revision:1}));
function fixture(contexts=subjects) {
  let selected=0,outcome="PERMITTED",binding=true,expired=false,
      changeDuringAuthorize=false;
  const objects=new Map(),events=[],calls=[];
  const grants=new Set(["t1.createWorkspace","t1.getWorkspace","t1.putObject","t1.getObject","t1.listEventsSince"]);
  const kernel=Object.freeze({
    sessionInfo:Object.freeze({contract_version:"1.3.0",runtime_version:"0.3.6",
      service_id:"iwxa.workspace.integration",mode:"full"}),
    hasOperation:operation=>grants.has(operation),
    async createWorkspace({workspace_id}) {calls.push(["createWorkspace",workspace_id]);return {workspace_id};},
    async getWorkspace(workspace_id) {calls.push(["getWorkspace",workspace_id]);return {workspace_id};},
    async putObject(input) {
      calls.push(["putObject",input.workspace_id]);
      const key=input.workspace_id+"/"+input.object_id,previous=objects.get(key);
      if ((previous?.revision??0)!==input.base_revision) {
        const error=new Error("CONFLICT");error.code="CONFLICT";throw error;
      }
      const object={workspace_id:input.workspace_id,object_id:input.object_id,
        revision:input.base_revision+1,data:input.data};
      objects.set(key,object);
      const event={workspace_id:input.workspace_id,event_id:"event:"+events.length};
      events.push(event);return {object,event};
    },
    async getObject(workspace_id,object_id) {
      calls.push(["getObject",workspace_id]);
      const object=objects.get(workspace_id+"/"+object_id);
      return object?{object,relations:{incoming:[],outgoing:[]}}:null;
    },
    async listEventsSince(workspace_id) {
      calls.push(["listEventsSince",workspace_id]);
      return events.filter(x=>x.workspace_id===workspace_id);
    },
  });
  const access=Object.freeze({
    currentContext:()=>contexts[selected],
    actionFor:op=>({"t1.putObject":"object.write","t1.getObject":"object.read",
      "t1.createWorkspace":"workspace.create","t1.getWorkspace":"workspace.read",
      "t1.listEventsSince":"history.read"})[op],
    operationDigest:({operation,input,context})=>sha({operation,input,context}),
    async authorize(request) {
      const c=contexts[selected]; // signed decision belongs to the original caller context
      if(changeDuringAuthorize) selected=1;
      const status=outcome;
      return {
        schema:c.kind==="CORP"?"IWXA_T3_ORGANIZATION_OPERATION_DECISION/1":
          "IWXA_T3_AUTHORIZATION_DECISION/1",outcome:status,
        allowed:status==="PERMITTED",evidenceOnly:true,
        requestDigest:sha(request),policyDigest:sha("policy"),
        evaluatedAt:new Date(now).toISOString(),statusObservedAt:new Date(now).toISOString(),
        statusSequence:1,validUntil:new Date(now+(expired?-1000:60000)).toISOString(),
        authorityPath:[{grantId:request.grantId}],
        ...(c.kind==="CORP"?{
          organizationId:c.organization_id,workspaceId:c.workspace_id,
          grantId:c.grant_id,operationDigest:sha({request,scope:c.workspace_id}),
          evidenceDigest:sha({request}),productionActivation:false,
          doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
        }:{}),
      };
    },
    verifyDecisionBinding:(request,decision)=>binding&&decision.requestDigest===sha(request),
  });
  return {
    bound:createSubjectKernelBinding({kernel,access,clock:()=>now}),
    kernel,access,calls,objects,grants,
    select:i=>{selected=i},
    setOutcome:x=>{outcome=x},
    setExpired:x=>{expired=x},
    setBinding:x=>{binding=x},
    setRace:x=>{changeDuringAuthorize=x},
  };
}
test("one PERSONAL and two CORP contexts dispatch only through the inherited T2 Kernel",async()=>{
  const f=fixture();
  for(const [i,c] of subjects.entries()) {
    f.select(i);
    assert.equal((await f.bound.createWorkspace({workspace_id:c.workspace_id})).workspace_id,c.workspace_id);
    const receipt=await f.bound.putObject({workspace_id:c.workspace_id,object_id:"item:one",
      base_revision:0,data:{subject:c.context_id}});
    assert.equal(receipt.object.revision,1);
    assert.equal((await f.bound.getObject(c.workspace_id,"item:one")).object.workspace_id,c.workspace_id);
    assert.equal((await f.bound.listEventsSince(c.workspace_id)).length,1);
  }
  assert.equal(f.objects.size,3);
  assert.equal(f.calls.filter(x=>x[0]==="putObject").length,3);
});
test("cross-organization reads and writes are refused before any Kernel call",async()=>{
  const f=fixture();
  f.select(1);
  await assert.rejects(f.bound.getObject("ws:two","item:one"),{code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  await assert.rejects(f.bound.putObject({workspace_id:"ws:personal",object_id:"item:one",
    base_revision:0,data:{}}),{code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  assert.equal(f.calls.length,0);
});
test("known revoked/expired, unknown status, or invalid owner binding cannot become a write",async()=>{
  const f=fixture();
  for(const outcome of ["DENIED","REQUIRES_FRESH_STATUS","UNRESOLVED","STALE_REVALIDATION_REQUIRED"]) {
    f.setOutcome(outcome);
    await assert.rejects(f.bound.putObject({workspace_id:"ws:personal",
      object_id:"item:one",base_revision:0,data:{}}),{code:"T3_ACCESS_NOT_PERMITTED"});
  }
  f.setOutcome("PERMITTED");
  f.setExpired(true);
  await assert.rejects(f.bound.putObject({workspace_id:"ws:personal",object_id:"item:one",
    base_revision:0,data:{}}),{code:"T3_ACCESS_STATUS_NOT_CURRENT"});
  f.setExpired(false);f.setBinding(false);
  await assert.rejects(f.bound.putObject({workspace_id:"ws:personal",object_id:"item:one",
    base_revision:0,data:{}}),{code:"T3_ACCESS_DECISION_BINDING_INVALID"});
  assert.equal(f.calls.length,0);
});
test("lost Kernel grant and changed selected scope are refused; no retry or cache",async()=>{
  const f=fixture();
  f.grants.delete("t1.putObject");
  await assert.rejects(f.bound.putObject({workspace_id:"ws:personal",object_id:"item:one",
    base_revision:0,data:{}}),{code:"T3_KERNEL_OPERATION_NOT_GRANTED"});
  f.grants.add("t1.putObject");
  f.setRace(true);
  await assert.rejects(f.bound.putObject({workspace_id:"ws:personal",object_id:"item:one",
    base_revision:0,data:{}}),{code:"T3_SUBJECT_CONTEXT_CHANGED"});
  assert.equal(f.calls.length,0);
});
test("source revision is passed unchanged and stale write still fails in the original Kernel",async()=>{
  const f=fixture();
  await f.bound.putObject({workspace_id:"ws:personal",object_id:"item:one",
    base_revision:0,data:{a:1}});
  await assert.rejects(f.bound.putObject({workspace_id:"ws:personal",
    object_id:"item:one",base_revision:0,data:{a:2}}),{code:"CONFLICT"});
  const source=(await f.bound.getObject("ws:personal","item:one")).object;
  assert.equal(source.revision,1);
  assert.deepEqual(source.data,{a:1});
});

test("the caller cannot mutate a digest-authorized T2 write while Access checks the operation",async()=>{
  const f=fixture();
  const input={workspace_id:"ws:personal",object_id:"item:immutable",base_revision:0,
    data:{title:"original"}};
  const pending=f.bound.putObject(input);
  input.workspace_id="ws:two";
  input.data.title="tampered";
  const receipt=await pending;
  assert.equal(receipt.object.workspace_id,"ws:personal");
  assert.equal(receipt.object.data.title,"original");
  assert.deepEqual(f.calls.filter(x=>x[0]==="putObject"),[["putObject","ws:personal"]]);
  assert.equal(f.objects.has("ws:two/item:immutable"),false);
});

test("corporate authority cannot confuse the human actor with the organization principal",async()=>{
  const contexts=subjects.map((item,i)=>i===1?{...item,principal_id:"person:one"}:item);
  const f=fixture(contexts);
  f.select(1);
  await assert.rejects(f.bound.getWorkspace("ws:one"),{code:"T3_CORPORATE_PRINCIPAL_MISMATCH"});
  assert.equal(f.calls.length,0);
});

test("a selected Workspace cannot borrow an Access grant for a different resource",async()=>{
  const contexts=subjects.map((item,i)=>i===2?{...item,resource:"ws:one"}:item);
  const f=fixture(contexts);
  f.select(2);
  await assert.rejects(f.bound.getWorkspace("ws:two"),{code:"T3_SUBJECT_RESOURCE_WORKSPACE_MISMATCH"});
  assert.equal(f.calls.length,0);
});

test("asynchronous native owner context keeps the original user command immutable",async()=>{
  const f=fixture();
  let release;
  const pendingNativeContext=new Promise(resolve=>{release=resolve;});
  const owner={...f.access,
    currentContext:async()=>{await pendingNativeContext;return f.access.currentContext();},
  };
  const bound=createSubjectKernelBinding({kernel:f.kernel,access:owner,clock:()=>now});
  const command={workspace_id:"ws:personal",object_id:"item:native",base_revision:0,
    data:{title:"before owner IPC"}};
  const pending=bound.putObject(command);
  // The native hop is pending, but the caller must no longer control bytes
  // already committed to the authoritative T2 Kernel operation.
  command.workspace_id="ws:two";
  command.data.title="mutated while owner was pending";
  release();
  const receipt=await pending;
  assert.equal(receipt.object.workspace_id,"ws:personal");
  assert.equal(receipt.object.data.title,"before owner IPC");
  assert.deepEqual(f.calls.filter(x=>x[0]==="putObject"),
    [["putObject","ws:personal"]]);
});

test("asynchronous signed context switch before JIT does not reach the T2 Kernel",async()=>{
  const f=fixture();
  let release;
  const pendingNativeContext=new Promise(resolve=>{release=resolve;});
  const owner={...f.access,
    currentContext:async()=>{await pendingNativeContext;return f.access.currentContext();},
  };
  const bound=createSubjectKernelBinding({kernel:f.kernel,access:owner,clock:()=>now});
  const pending=bound.getWorkspace("ws:personal");
  f.select(1); // Control selected a corporate Workspace before native reply.
  release();
  await assert.rejects(pending,{code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  assert.equal(f.calls.length,0);
});
