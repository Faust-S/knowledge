import test from 'node:test';
import assert from 'node:assert/strict';
import {createT3ReviewController} from '../modules/activity-base-anonymizer/t3-review-controller.mjs';
const secret='VERY_PRIVATE_PERSON_ID';
const workspace='ws:subject';
const row=i=>({object_id:`obj:${i}`,revision:1,schema_id:'schema.private',
  schema_version:'1.0.0',semantic_kind:'Process'});
const makeView=()=>({workspace_id:workspace,
  nodes:[0,1,2].map(row),events:[0,1,2].flatMap(i=>[
    {event_id:`start:${i}`,event_type:'private.start',semantic_kind:'Event',
      occurred_at:'2026-11-11T11:00:00Z',object_ref:{object_id:`obj:${i}`,revision:1}},
    {event_id:`end:${i}`,event_type:'private.end',semantic_kind:'Event',
      occurred_at:'2026-11-11T11:02:00Z',object_ref:{object_id:`obj:${i}`,revision:1}},
  ]),relations:[],unresolved:[],unmapped:{object_ids:[],event_ids:[],relation_ids:[]}});
function makeHost(options={}) {
  const listeners=new Set(), ownerListeners=new Set();
  let selected=Object.freeze({workspace_id:workspace});
  let context=Object.freeze({kind:'PERSONAL', workspace_id:workspace,actor_id:secret});
  let reads=0;
  const releases=[];
  const wait=()=>new Promise(res=>{releases.push(res);});
  let blocked=options.blocked??false;
  const host={
    context:{kernel:{},currentWorkspace:{
      get:()=>selected,
      subscribe(cb){listeners.add(cb);return ()=>listeners.delete(cb);},
    }},
    signedAccess:{currentContext:()=>context, authorize(){},verifyDecisionBinding(){},
      actionFor(){},operationDigest(){}},
    bindings:{objects:[],events:[]},
    subscribeInvalidation(cb){ownerListeners.add(cb);return ()=>ownerListeners.delete(cb);},
    async readActivityFromWorkspaceContext(){
      reads++;
      if(blocked) await wait();
      if(options.deny)throw Error(secret);
      return makeView();
    },
  };
  return {host, selectionChange(){selected=Object.freeze({workspace_id:'ws:other'});
      listeners.forEach(fn=>fn());}, grantChanged(){ownerListeners.forEach(fn=>fn());},
    changeActor(){context=Object.freeze({kind:'PERSONAL',workspace_id:workspace,actor_id:'changed'});
      ownerListeners.forEach(fn=>fn());},
    release(){releases.shift()?.();}, listeners, ownerListeners, calls:()=>reads};
}

test('connected Host starts READY_TO_READ without fetching any data',async()=>{
  const h=makeHost(), states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.equal(states[0].status,'READY_TO_READ');
  assert.equal(h.calls(),0);
  const r=await c.readSelected();
  assert.equal(r.status,'REVIEW');
  assert.equal(h.calls(),1);
  assert.equal(states.at(-1).review.export_allowed,false);
  assert.equal(states.at(-1).review.anonymity,'NOT_ESTABLISHED');
  assert.equal(JSON.stringify(states).includes(secret),false);
  c.dispose();
});

test('change of selected Workspace invalidates an already shown preview',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();
  h.selectionChange();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  c.dispose();
});

test('signed status revocation signal clears a completed review',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();
  h.grantChanged();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  c.dispose();
});

test('in-flight read cannot update the UI after Workspace switch',async()=>{
  const h=makeHost({blocked:true}),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  const p=c.readSelected();
  await Promise.resolve();
  h.selectionChange();h.release();
  assert.equal((await p).status,'INVALIDATED');
  assert.equal(states.at(-1).review,null);
  c.dispose();
});

test('in-flight read cannot update the UI after signed status change',async()=>{
  const h=makeHost({blocked:true}),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  const p=c.readSelected();
  await Promise.resolve();
  h.grantChanged();h.release();
  assert.equal((await p).status,'INVALIDATED');
  assert.equal(states.at(-1).review,null);
  c.dispose();
});

test('concurrent reads only render the newest completion',async()=>{
  const h=makeHost({blocked:true}),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  const first=c.readSelected();
  const second=c.readSelected();
  h.release();
  assert.equal((await first).status,'INVALIDATED');
  assert.equal(states.at(-1).status,'READING');
  h.release();
  assert.equal((await second).status,'REVIEW');
  assert.equal(states.at(-1).status,'REVIEW');
  c.dispose();
});

test('original Host denial is a generic HOLD without private exception',async()=>{
  const h=makeHost({deny:true}),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.deepEqual(await c.readSelected(),{status:'HOLD'});
  assert.equal(states.at(-1).code,'T3_AUTHORITATIVE_READ_REFUSED');
  assert.equal(JSON.stringify(states).includes(secret),false);
  c.dispose();
});

test('requires Host-owned invalidation subscription, never silently trusts a stale permission',()=>{
  const h=makeHost(),states=[];
  delete h.host.subscribeInvalidation;
  assert.throws(()=>createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)}),
    {code:'T3_TRUSTED_HOST_INVALIDATION_REQUIRED'});
  assert.equal(states.length,0);
});

test('detaching removes listeners, rejects read and does not publish late state',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  c.dispose();c.dispose();
  assert.equal(h.listeners.size,0);assert.equal(h.ownerListeners.size,0);
  assert.equal((await c.readSelected()).status,'DETACHED');
  assert.equal(states.length,1);
});

test('reset switches from T3 review to synthetic example without leaking previous graph',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();
  c.reset();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  c.dispose();
});