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
    "t1.listEventsSince","t1.softDeleteWorkspace","t1.restoreWorkspace",
    "t2.exportPreview","t2.exportPackage","t2.confirmExport"]);
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
    async exportPreview(options){calls.push(["exportPreview",options]);
      return {workspaces:[...options.workspaces],counts:{workspaces:1}};},
    async exportPackage(options){calls.push(["exportPackage",options]);
      const package_digest="a".repeat(64);
      return {package_digest,manifest:{package_digest,workspaces:[...options.workspaces],
        workspace_states:[{workspace_id:ws,updated_at:new Date(now).toISOString()}]},
        bytes:Uint8Array.from([1,2]),size:2};},
    async confirmExport(input){calls.push(["confirmExport",input]);
      return {workspace_ids:[...input.workspace_ids],
        package_digest:input.package_digest,confirmations:1};},
    async getWorkspace(id){calls.push(["getWorkspace",id]);return {workspace_id:id};},
    async softDeleteWorkspace(id){calls.push(["softDeleteWorkspace",id]);
      return {workspace_id:id,deleted_at:new Date(now).toISOString()};},
    async restoreWorkspace(id){calls.push(["restoreWorkspace",id]);
      return {workspace_id:id,restored_at:new Date(now).toISOString()};},
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

test("a read from the previous subject is never delivered after Kernel awaits a context switch",async()=>{
  const f=fixture();
  let started,finish;
  const entered=new Promise(resolve=>{started=resolve});
  const resume=new Promise(resolve=>{finish=resolve});
  f.kernel.getObject=async(_,objectId)=>{
    started();
    await resume;
    return {object:{workspace_id:ws,object_id:objectId},
      relations:{incoming:[],outgoing:[]}};
  };
  const pending=f.bound.getObject(ws,"item:1");
  await entered;
  f.context.scope_revision+=1; // same workspace, new selected authority revision
  finish();
  await assert.rejects(pending,{code:"T3_SUBJECT_RESULT_STALE_AFTER_KERNEL"});
});
test("a late write receipt is withheld without automatic re-execution",async()=>{
  const f=fixture();
  let entered,complete,commits=0;
  const started=new Promise(resolve=>{entered=resolve});
  const gate=new Promise(resolve=>{complete=resolve});
  f.kernel.putObject=async input=>{
    commits+=1;
    entered();
    await gate;
    return {object:{workspace_id:ws,object_id:input.object_id,revision:1},
      event:{workspace_id:ws,event_id:"evt:committed"}};
  };
  const pending=f.bound.putObject({workspace_id:ws,object_id:"item:1",
    base_revision:0,data:{title:"original"}});
  await started;
  f.context.scope_revision+=1;
  complete();
  await assert.rejects(pending,{code:"T3_SUBJECT_RESULT_STALE_AFTER_KERNEL"});
  assert.equal(commits,1,"Kernel may have committed; no retry or rollback assumed");
});

test("D1 preserves inherited T2 workspace soft-delete and restore lifecycle with exact receipts",async()=>{
  const f=fixture();
  const deleted=await f.bound.softDeleteWorkspace(ws);
  assert.equal(deleted.workspace_id,ws);
  assert.equal(typeof deleted.deleted_at,"string");
  const restored=await f.bound.restoreWorkspace(ws);
  assert.equal(restored.workspace_id,ws);
  assert.equal(typeof restored.restored_at,"string");
  assert.deepEqual(f.calls.map(x=>x[0]),["softDeleteWorkspace","restoreWorkspace"]);
});
test("D1 denies cross-workspace lifecycle and mismatched original T2 receipts",async()=>{
  const f=fixture();
  for(const op of [()=>f.bound.softDeleteWorkspace("ws:foreign"),
    ()=>f.bound.restoreWorkspace("ws:foreign")])
    await assert.rejects(op(),{code:"T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE"});
  assert.equal(f.calls.length,0);
  f.kernel.softDeleteWorkspace=async()=>({workspace_id:"ws:foreign",deleted_at:"today"});
  await assert.rejects(f.bound.softDeleteWorkspace(ws),
    {code:"T3_KERNEL_SCOPE_RECEIPT_MISMATCH"});
  f.kernel.restoreWorkspace=async()=>null;
  await assert.rejects(f.bound.restoreWorkspace(ws),
    {code:"T3_KERNEL_SCOPE_RECEIPT_MISMATCH"});
});

test("D1 preserves original single-Workspace T2 export preview, archive and confirmation",async()=>{
  const f=fixture(),options={workspaces:[ws],include_history:true,include_assets:true};
  assert.deepEqual((await f.bound.exportPreview(options)).workspaces,[ws]);
  const artifact=await f.bound.exportPackage(options);
  assert.deepEqual([...artifact.bytes],[1,2]);
  assert.deepEqual(artifact.manifest.workspaces,[ws]);
  const receipt=await f.bound.confirmExport({
    package_digest:artifact.package_digest,workspace_ids:[ws]});
  assert.deepEqual(receipt.workspace_ids,[ws]);
  assert.equal(receipt.package_digest,artifact.package_digest);
  assert.deepEqual(f.calls.map(x=>x[0]),["exportPreview","exportPackage","confirmExport"]);
});
test("D1 cannot implicitly export or confirm another subject Workspace",async()=>{
  const f=fixture();
  for(const run of [
    ()=>f.bound.exportPreview({workspaces:[ws,"ws:foreign"]}),
    ()=>f.bound.exportPackage({workspaces:["ws:foreign"]}),
    ()=>f.bound.exportPackage({workspaces:[]}),
    ()=>f.bound.confirmExport({package_digest:"a".repeat(64)}),
    ()=>f.bound.confirmExport({package_digest:"a".repeat(64),
      workspace_ids:[ws,"ws:foreign"]}),
  ]) await assert.rejects(run(),{
    code:/T3_SUBJECT_EXCHANGE_SCOPE_INVALID|T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE/});
  assert.equal(f.calls.length,0);
});
test("D1 refuses foreign Exchange manifest or cross-Workspace confirmation receipts",async()=>{
  const f=fixture();
  f.kernel.exportPreview=async()=>({workspaces:[ws,"ws:foreign"]});
  await assert.rejects(f.bound.exportPreview({workspaces:[ws]}),
    {code:"T3_KERNEL_EXCHANGE_SCOPE_MISMATCH"});
  f.kernel.exportPackage=async()=>({package_digest:"a".repeat(64),
    manifest:{package_digest:"a".repeat(64),workspaces:[ws],
      workspace_states:[{workspace_id:"ws:foreign"}]}});
  await assert.rejects(f.bound.exportPackage({workspaces:[ws]}),
    {code:"T3_KERNEL_EXCHANGE_SCOPE_MISMATCH"});
  f.kernel.confirmExport=async()=>({workspace_ids:[ws],
    package_digest:"b".repeat(64)});
  await assert.rejects(f.bound.confirmExport({workspace_ids:[ws],
    package_digest:"a".repeat(64)}),{code:"T3_KERNEL_EXCHANGE_DIGEST_MISMATCH"});
});
