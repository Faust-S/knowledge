import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_INFERENCE_DRAFT_SCHEMA, saveLocalInferenceDraft,
  listLocalInferenceDrafts, getLocalInferenceDraft,
} from "../src/t3/local-inference-draft.mjs";

const WSA="ws:local-a",WSB="ws:foreign-b";
const INPUT={expected_workspace_id:WSA,model_id:"SmolLM2-360M-Instruct",
  engine:"@mlc-ai/web-llm@0.2.87",output:"An untrusted local suggestion"};
function fixture(){
  let focused=Object.freeze({workspace_id:WSA});
  const callbacks=new Set();
  const store=new Map();
  const calls=[];
  const granted=new Set(["t1.getWorkspace","t1.putObject","t1.getObject",
    "t1.listObjects"]);
  let rejectWrite=false,corruptReadback=false;
  const context={
    currentWorkspace:{
      get:()=>focused,
      subscribe(fn){callbacks.add(fn);return()=>callbacks.delete(fn);},
    },
    kernel:{
      sessionInfo:{contract_version:"1.3.0",runtime_version:"0.3.6"},
      hasOperation:(op)=>granted.has(op),
      async getWorkspace(id){
        calls.push(["getWorkspace",id]);
        return {workspace_id:id};
      },
      async putObject(command){
        calls.push(["putObject",command.workspace_id]);
        if(rejectWrite)throw Object.assign(new Error("NO_GRANT"),{code:"NO_GRANT"});
        const row={...command,revision:1,created_at:"2026-11-11T18:00:00Z"};
        store.set(command.object_id,structuredClone(row));
        return {object:row,event:{workspace_id:command.workspace_id,
          event_id:"event:local-inference-save"}};
      },
      async getObject(ws,id){
        calls.push(["getObject",ws,id]);
        const row=store.get(id);
        return {object:corruptReadback?{...row,data:{text:"other"}}:structuredClone(row),
          relations:{outgoing:[],incoming:[]}};
      },
      async listObjects(query){
        calls.push(["listObjects",query.workspace_id]);
        return [...store.values()].map(row=>structuredClone(row));
      },
    },
  };
  return {context,calls,store,granted,
    select(id){focused=Object.freeze({workspace_id:id});for(const cb of callbacks)cb(focused)},
    rejectWrites(){rejectWrite=true},corrupt(){corruptReadback=true},
  };
}

test("D5 explicit save is an original T2 object/event with readback, without prompt or implicit authority",async()=>{
  const f=fixture();
  const receipt=await saveLocalInferenceDraft(f.context,INPUT);
  assert.equal(receipt.workspace_id,WSA);
  assert.equal(receipt.revision,1);
  assert.equal(receipt.event_id,"event:local-inference-save");
  assert.equal(receipt.readback,true);
  assert.equal(receipt.status,"DRAFT_UNTRUSTED");
  const object=f.store.get(receipt.object_id);
  assert.equal(object.schema_id,LOCAL_INFERENCE_DRAFT_SCHEMA);
  assert.equal(object.data.model_integrity,"NOT_ATTESTED");
  assert.equal(object.data.status,"DRAFT_UNTRUSTED");
  assert.equal(object.data.text,INPUT.output);
  assert.equal(object.event.event_type,"t3.local-inference.draft.saved");
  assert.equal(object.base_revision,0);
  assert.equal(JSON.stringify(object).includes("PROMPT_SECRET_DO_NOT_STORE"),false);
  assert.deepEqual(f.calls.map(x=>x[0]),["getWorkspace","putObject","getObject"]);
  const reopened=fixture();
  reopened.store.set(receipt.object_id,structuredClone(object)); // simulates original T2 DB8 reload
  assert.deepEqual(await listLocalInferenceDrafts(reopened.context,{
    expected_workspace_id:WSA,
  }),[{workspace_id:WSA,object_id:receipt.object_id,revision:1,
    status:"DRAFT_UNTRUSTED",model_id:INPUT.model_id,text:INPUT.output}]);
});
test("D5 refuses missing, foreign or altered selection before any original Kernel write",async()=>{
  const f=fixture();
  await assert.rejects(saveLocalInferenceDraft(f.context,{
    ...INPUT,expected_workspace_id:WSB,
  }),{code:"T3_D5_WORKSPACE_CHANGED"});
  assert.deepEqual(f.calls,[]);
  await assert.rejects(saveLocalInferenceDraft(f.context,{
    ...INPUT,expected_workspace_id:undefined,
  }),{code:"T3_D5_EXPLICIT_WORKSPACE_REQUIRED"});
  assert.deepEqual(f.calls,[]);
  f.select(WSB);
  await assert.rejects(saveLocalInferenceDraft(f.context,INPUT),
    {code:"T3_D5_WORKSPACE_CHANGED"});
  assert.deepEqual(f.calls,[]);
});
test("D5 missing write permission and revoked original Kernel right cannot create a result",async()=>{
  const f=fixture();f.granted.delete("t1.putObject");
  await assert.rejects(saveLocalInferenceDraft(f.context,INPUT),
    {code:"T3_D5_KERNEL_PERMISSION_REQUIRED"});
  assert.deepEqual(f.calls,[]);
  f.granted.add("t1.putObject");f.rejectWrites();
  await assert.rejects(saveLocalInferenceDraft(f.context,INPUT),{code:"NO_GRANT"});
  assert.equal(f.store.size,0);
  assert.equal(f.calls.filter(x=>x[0]==="putObject").length,1);
});
test("D5 aborts on observed A-B-A focus change, even when selection returns to same ID",async()=>{
  const f=fixture();
  f.context.kernel.getWorkspace=async id=>{
    f.select(WSB);f.select(WSA);
    return {workspace_id:id};
  };
  await assert.rejects(saveLocalInferenceDraft(f.context,INPUT),
    {code:"T3_D5_WORKSPACE_CHANGED"});
  assert.equal(f.calls.some(x=>x[0]==="putObject"),false);
});
test("D5 never says success or retries after a committed write with corrupt readback",async()=>{
  const f=fixture();f.corrupt();
  await assert.rejects(saveLocalInferenceDraft(f.context,INPUT),error=>{
    assert.equal(error.code,"T3_D5_WRITE_MAY_HAVE_COMMITTED");
    assert.equal(error.cause_code,"T3_D5_DRAFT_READBACK_MISMATCH");
    assert.equal(error.workspace_id,WSA);
    assert.equal(f.store.has(error.object_id),true);
    return true;
  });
  assert.equal(f.calls.filter(x=>x[0]==="putObject").length,1);
});
test("D5 scoped listing neither exposes foreign records nor treats rejected focus as success",async()=>{
  const f=fixture();
  const receipt=await saveLocalInferenceDraft(f.context,INPUT);
  f.store.set("item:foreign",{workspace_id:WSB,object_id:"item:foreign",
    schema_id:LOCAL_INFERENCE_DRAFT_SCHEMA,data:{text:"SECRET"}});
  await assert.rejects(listLocalInferenceDrafts(f.context,{
    expected_workspace_id:WSA,
  }),{code:"T3_D5_SOURCE_SCOPE_MISMATCH"});
  f.store.delete("item:foreign");
  const rows=await listLocalInferenceDrafts(f.context,{expected_workspace_id:WSA});
  assert.deepEqual(rows.map(x=>x.object_id),[receipt.object_id]);
});

test("D5 opens a saved AI draft by exact ID through original Kernel after cold restart",async()=>{
  const first=fixture();
  const receipt=await saveLocalInferenceDraft(first.context,INPUT);
  const afterRestart=fixture();
  afterRestart.store.set(receipt.object_id,structuredClone(first.store.get(receipt.object_id)));
  const loaded=await getLocalInferenceDraft(afterRestart.context,{
    expected_workspace_id:WSA,object_id:receipt.object_id,
  });
  assert.equal(loaded.readback,true);
  assert.equal(loaded.object_id,receipt.object_id);
  assert.equal(loaded.workspace_id,WSA);
  assert.equal(loaded.text,INPUT.output);
  assert.equal(loaded.engine,INPUT.engine);
  assert.equal(loaded.status,"DRAFT_UNTRUSTED");
  assert.equal(Object.isFrozen(loaded),true);
  assert.deepEqual(afterRestart.calls.map(row=>row[0]),["getWorkspace","getObject"]);
});
test("D5 opening a saved draft cannot cross workspaces, create records or accept forged IDs",async()=>{
  const f=fixture();
  const receipt=await saveLocalInferenceDraft(f.context,INPUT);
  f.calls.length=0;
  await assert.rejects(getLocalInferenceDraft(f.context,{
    expected_workspace_id:WSA,object_id:"local-inference:INVALID",
  }),{code:"T3_D5_DRAFT_ID_INVALID"});
  assert.deepEqual(f.calls,[]);
  const existing=f.store.get(receipt.object_id);
  f.store.set(receipt.object_id,{...existing,workspace_id:WSB});
  await assert.rejects(getLocalInferenceDraft(f.context,{
    expected_workspace_id:WSA,object_id:receipt.object_id,
  }),{code:"T3_D5_DRAFT_READBACK_INVALID"});
  assert.equal(f.calls.some(row=>row[0]==="putObject"),false);
  f.store.set(receipt.object_id,{...existing,deleted_at:"2026-11-12T00:00:00Z"});
  await assert.rejects(getLocalInferenceDraft(f.context,{
    expected_workspace_id:WSA,object_id:receipt.object_id,
  }),{code:"T3_D5_DRAFT_READBACK_INVALID"});
});
test("D5 rejects focus A-B-A changes and missing original Kernel read permission",async()=>{
  const f=fixture();
  const receipt=await saveLocalInferenceDraft(f.context,INPUT);
  f.calls.length=0;
  f.granted.delete("t1.getObject");
  await assert.rejects(getLocalInferenceDraft(f.context,{
    expected_workspace_id:WSA,object_id:receipt.object_id,
  }),{code:"T3_D5_KERNEL_PERMISSION_REQUIRED"});
  assert.deepEqual(f.calls,[]);
  f.granted.add("t1.getObject");
  const original=f.context.kernel.getObject;
  f.context.kernel.getObject=async(...args)=>{
    f.select(WSB);f.select(WSA);
    return original(...args);
  };
  await assert.rejects(getLocalInferenceDraft(f.context,{
    expected_workspace_id:WSA,object_id:receipt.object_id,
  }),{code:"T3_D5_WORKSPACE_CHANGED"});
});
