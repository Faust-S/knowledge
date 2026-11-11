import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createSubjectKernelBinding} from "../src/t3/subject-access-binding.mjs";

const now=Date.parse("2026-11-11T09:00:00.000Z");
const digest=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const ws="ws:personal";
function fixture(){
  const calls=[], allowed=new Set(["t1.createWorkspace","t1.getWorkspace","t1.getObject",
    "t1.listObjects","t1.putObject","t1.deleteObject","t1.putRelation","t1.deleteRelation",
    "t1.listAssets","t1.getAsset","t1.putAsset","t1.deleteAsset","t1.commitObjectGraph",
    "t1.listEventsSince"]);
  const context={kind:"PERSONAL",context_id:"context:person",actor_id:"person:1",
    principal_id:"person:1",role_id:"role:writer",grant_id:"grant:person",
    realm_id:"realm:person",audience:"host:t3",resource:ws,workspace_id:ws,
    purpose:"purpose:work",organization_id:null,scope_revision:1};
  const event={event_id:"evt:1",workspace_id:ws};
  const relation={workspace_id:ws,relation_id:"relation:1",
    from_object_id:"item:1",to_object_id:"item:2"};
  const record={workspace_id:ws,object_id:"item:1",revision:1};
  const asset={workspace_id:ws,asset_id:"asset:1",revision:1};
  const kernel={
    sessionInfo:{contract_version:"1.3.0"},
    hasOperation:op=>allowed.has(op),
    async listObjects(query){calls.push(["listObjects",query]);return [record];},
    async getObject(id,objectId){calls.push(["getObject",id,objectId]);
      return {object:{...record,object_id:objectId},
        relations:{incoming:[],outgoing:[relation]}};},
    async putRelation(input){calls.push(["putRelation",input]);return {relation:{...relation,
      relation_id:input.relation_id,from_object_id:input.from_object_id,
      to_object_id:input.to_object_id},event};},
    async deleteRelation(input){calls.push(["deleteRelation",input]);
      return {relation_id:input.relation_id,event};},
    async deleteObject(input){calls.push(["deleteObject",input]);
      return {object:{...record,object_id:input.object_id},event};},
    async listAssets(query){calls.push(["listAssets",query]);return [asset];},
    async getAsset(id,assetId){calls.push(["getAsset",id,assetId]);
      return {asset:{...asset,asset_id:assetId},bytes:Uint8Array.from([1,2])};},
    async putAsset(input){calls.push(["putAsset",input]);
      return {asset:{...asset,asset_id:input.asset_id},event};},
    async deleteAsset(input){calls.push(["deleteAsset",input]);
      return {asset_id:input.asset_id,event};},
    async commitObjectGraph(input){calls.push(["commitObjectGraph",input]);
      return {workspace_id:ws,object:{...record,object_id:input.object.object_id},
        relations_put:[relation],relation_ids_deleted:[],event};},
    async listEventsSince(id,since){calls.push(["listEventsSince",id,since]);return [event];},
    async getWorkspace(id){calls.push(["getWorkspace",id]);return {workspace_id:id};},
    async createWorkspace(input){calls.push(["createWorkspace",input]);return {workspace_id:input.workspace_id};},
    async putObject(input){calls.push(["putObject",input]);
      return {object:{...record,object_id:input.object_id},event};},
  };
  const owner={
    currentContext:()=>context,
    actionFor:op=>"action:"+op.slice(3),
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    async authorize(request){return {
      schema:"IWXA_T3_AUTHORIZATION_DECISION/1",allowed:true,outcome:"PERMITTED",
      evidenceOnly:true,requestDigest:digest(request),policyDigest:digest("policy"),
      statusSequence:1,validUntil:new Date(now+60000).toISOString(),
      evaluatedAt:new Date(now).toISOString(),statusObservedAt:new Date(now).toISOString(),
      authorityPath:[{grantId:request.grantId}],
    };},
    verifyDecisionBinding:(req,d)=>d.requestDigest===digest(req),
  };
  const bound=createSubjectKernelBinding({kernel,access:owner,clock:()=>now});
  return {bound,kernel,allowed,calls,context};
}
test("all scoped T1 object, relation and asset calls use inherited facade unchanged",async()=>{
  const f=fixture();
  assert.equal((await f.bound.listObjects({workspace_id:ws}))[0].object_id,"item:1");
  assert.equal((await f.bound.getObject(ws,"item:1")).relations.outgoing[0].relation_id,"relation:1");
  assert.equal((await f.bound.putRelation({workspace_id:ws,relation_id:"relation:1",
    from_object_id:"item:1",to_object_id:"item:2"})).relation.workspace_id,ws);
  assert.equal((await f.bound.deleteRelation({workspace_id:ws,relation_id:"relation:1"})).relation_id,"relation:1");
  assert.equal((await f.bound.deleteObject({workspace_id:ws,object_id:"item:1"})).object.workspace_id,ws);
  assert.equal((await f.bound.listAssets({workspace_id:ws}))[0].asset_id,"asset:1");
  assert.deepEqual([...(await f.bound.getAsset(ws,"asset:1")).bytes],[1,2]);
  assert.equal((await f.bound.putAsset({workspace_id:ws,asset_id:"asset:1"})).asset.workspace_id,ws);
  assert.equal((await f.bound.deleteAsset({workspace_id:ws,asset_id:"asset:1"})).asset_id,"asset:1");
  assert.equal((await f.bound.commitObjectGraph({workspace_id:ws,object:{object_id:"item:1"}})).event.workspace_id,ws);
  await f.bound.listEventsSince(ws,"evt:cursor");
  assert.deepEqual(f.calls.at(-1),["listEventsSince",ws,"evt:cursor"]);
  assert.equal("listWorkspaces" in f.bound,false); // unscoped enumeration cannot escape subject
});
test("all new methods refuse other selected Workspace before touching Kernel",async()=>{
  const f=fixture();
  for(const run of [
    ()=>f.bound.listObjects({workspace_id:"ws:other"}),
    ()=>f.bound.putRelation({workspace_id:"ws:other",relation_id:"r"}),
    ()=>f.bound.deleteObject({workspace_id:"ws:other",object_id:"x"}),
    ()=>f.bound.listAssets({workspace_id:"ws:other"}),
    ()=>f.bound.getAsset("ws:other","asset:1"),
    ()=>f.bound.commitObjectGraph({workspace_id:"ws:other",object:{object_id:"x"}}),
  ]) await assert.rejects(run(),{code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  assert.equal(f.calls.length,0);
});
test("foreign object and relation rows returned by Kernel are refused",async()=>{
  const f=fixture();
  f.kernel.listObjects=async()=>[{workspace_id:"ws:other",object_id:"foreign"}];
  await assert.rejects(f.bound.listObjects({workspace_id:ws}),
    {code:"T3_KERNEL_LIST_SCOPE_MISMATCH"});
  f.kernel.getObject=async()=>({object:{workspace_id:ws,object_id:"item:1"},
    relations:{incoming:[],outgoing:[{workspace_id:"ws:other",relation_id:"evil"}]}});
  await assert.rejects(f.bound.getObject(ws,"item:1"),
    {code:"T3_KERNEL_RELATION_SCOPE_MISMATCH"});
  f.kernel.putRelation=async()=>({relation:{workspace_id:"ws:other",relation_id:"relation:1"},event:{workspace_id:ws}});
  await assert.rejects(f.bound.putRelation({workspace_id:ws,relation_id:"relation:1",
    from_object_id:"item:1",to_object_id:"item:2"}),
    {code:"T3_KERNEL_RELATION_SCOPE_MISMATCH"});
});
test("foreign event, asset and graph receipts fail closed",async()=>{
  const f=fixture();
  f.kernel.putObject=async()=>({object:{workspace_id:ws,object_id:"item:1"},
    event:{workspace_id:"ws:other"}});
  await assert.rejects(f.bound.putObject({workspace_id:ws,object_id:"item:1"}),
    {code:"T3_KERNEL_EVENT_SCOPE_MISMATCH"});
  f.kernel.getAsset=async()=>({asset:{workspace_id:"ws:other",asset_id:"asset:1"},bytes:new Uint8Array()});
  await assert.rejects(f.bound.getAsset(ws,"asset:1"),
    {code:"T3_KERNEL_ASSET_SCOPE_MISMATCH"});
  f.kernel.commitObjectGraph=async()=>({workspace_id:ws,object:{workspace_id:ws,object_id:"item:1"},
    relations_put:[{workspace_id:"ws:other",relation_id:"r"}],event:{workspace_id:ws}});
  await assert.rejects(f.bound.commitObjectGraph({workspace_id:ws,object:{object_id:"item:1"}}),
    {code:"T3_KERNEL_RELATION_SCOPE_MISMATCH"});
});
test("caller mutation cannot alter authorized relation command",async()=>{
  const f=fixture();
  const input={workspace_id:ws,relation_id:"relation:1",
    from_object_id:"item:1",to_object_id:"item:2"};
  const started=f.bound.putRelation(input);
  input.workspace_id="ws:other";input.from_object_id="foreign";
  const r=await started;
  assert.equal(r.relation.from_object_id,"item:1");
  assert.equal(f.calls.at(-1)[1].from_object_id,"item:1");
});
test("missing capabilities and unavailable facade methods cannot bypass Access",async()=>{
  const f=fixture();
  f.allowed.delete("t1.commitObjectGraph");
  await assert.rejects(f.bound.commitObjectGraph({workspace_id:ws,object:{object_id:"item:1"}}),
    {code:"T3_KERNEL_OPERATION_NOT_GRANTED"});
  f.allowed.add("t1.commitObjectGraph");f.kernel.commitObjectGraph=undefined;
  await assert.rejects(f.bound.commitObjectGraph({workspace_id:ws,object:{object_id:"item:1"}}),
    {code:"T3_KERNEL_OPERATION_UNAVAILABLE"});
  assert.equal(f.calls.length,0);
});
