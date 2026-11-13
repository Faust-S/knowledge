import assert from "node:assert/strict";
import test from "node:test";
import {projectActivitySnapshot} from "../../src/t3/activity/index.mjs";

const workspace_id="ws:original-t2-lifecycle";
const objects=Array.from({length:3},(_,i)=>({
  workspace_id,object_id:"bracket:"+i,revision:1,
  schema_id:"d05.bracket",schema_version:"1.0.0",
  data:{customer:"PRIVATE_CUSTOMER_"+i},
}));
const events=[{
  workspace_id,event_id:"original:t2:workspace-created",
  event_type:"workspace.created",service_id:"iwxa.workspace.integration",
  occurred_at:"2026-11-14T08:00:00Z",
  payload:{profile:"generic",capabilities:[],read_only:false},
},...objects.map((o,i)=>({
  workspace_id,event_id:"original:work:"+i,
  event_type:"d05.bracket.created",object_id:o.object_id,revision:1,
  service_id:"iwxa.workspace.integration",
  occurred_at:"2026-11-14T08:0"+(i+1)+":00Z",payload:{},
}))];
const base={objects:[{schema_id:"d05.bracket",schema_version:"1.0.0",
  semantic_kind:"Process"}],events:[{
  event_type:"d05.bracket.created",semantic_kind:"Event",
}],relations:[]};
const project=(bindings=base, sourceEvents=events)=>projectActivitySnapshot({
  workspace_id,objects,events:sourceEvents,bindings,
});

test("default original D2 still reports unmapped T2 workspace creation for verification",()=>{
  const out=project();
  assert.deepEqual(out.unmapped.event_ids,["original:t2:workspace-created"]);
  assert.equal(Object.hasOwn(out.unmapped,"excluded_context_event_ids"),false);
  assert.equal(out.events.length,3);
});

test("explicit verified intrinsic T2 event remains auditable but cannot become a business step",()=>{
  const before=structuredClone({objects,events});
  const out=project({...base,context_events:["workspace.created"]});
  assert.deepEqual(out.unmapped.event_ids,[]);
  assert.deepEqual(out.unmapped.excluded_context_event_ids,
    ["original:t2:workspace-created"]);
  assert.deepEqual(out.events.map(x=>x.event_id),[
    "original:work:0","original:work:1","original:work:2"]);
  assert.equal(out.nodes.length,3);
  assert.deepEqual({objects,events},before,"original T2 facts cannot be mutated");
  assert.equal(JSON.stringify(out).includes("PRIVATE_CUSTOMER"),false);
});

test("unknown lifecycle labels, duplicate labels and declared business overlaps refuse admission",()=>{
  for(const context_events of [
    ["unknown.admin.step"],["workspace.created","workspace.created"],
    ["workspace.deleted"],["d05.bracket.created"],
  ]) assert.throws(()=>project({...base,context_events}),
    {code:"INVALID_T2_CONTEXT_EVENT_BINDING"});
  assert.throws(()=>project({...base,context_events:["workspace.created"],
    events:[...base.events,{event_type:"workspace.created",semantic_kind:"Event"}]}),
    {code:"AMBIGUOUS_CONTEXT_EVENT_BINDING"});
});

test("object-linked or disguised lifecycle events cannot be suppressed by a context opt-in",()=>{
  const bindings={...base,context_events:["workspace.created"]};
  for(const modified of [
    {...events[0],object_id:"bracket:0"},
    {...events[0],revision:1},
    {...events[0],payload:{}},
    {...events[0],payload:{profile:"generic",capabilities:[],read_only:false,
      private_field:"NOT_A_REAL_T2_CONTEXT"}},
  ])assert.throws(()=>project(bindings,[modified,...events.slice(1)]),
    {code:"T2_CONTEXT_EVENT_NOT_VERIFIED"});
});
