import test from 'node:test';
import assert from 'node:assert/strict';
import {createT3ReviewController} from '../modules/activity-base-anonymizer/t3-review-controller.mjs';
import {createTrustedT3ReviewPort} from '../modules/activity-base-anonymizer/t3-selected-host.mjs';
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
  const selectionListeners=new Set(), ownerListeners=new Set();
  let selected=Object.freeze({workspace_id:workspace});
  let context=Object.freeze({kind:'PERSONAL', workspace_id:workspace,actor_id:secret});
  let reads=0;
  const releases=[];
  const wait=()=>new Promise(res=>{releases.push(res);});
  const trusted={
    context:{kernel:{},currentWorkspace:{
      get:()=>selected,
      subscribe(cb){selectionListeners.add(cb);return ()=>selectionListeners.delete(cb);},
    }},
    signedAccess:{currentContext:()=>context, authorize(){},verifyDecisionBinding(){},
      actionFor(){},operationDigest(){}},
    bindings:{objects:[],events:[]},
    subscribeOwnerInvalidation(cb){ownerListeners.add(cb);return ()=>ownerListeners.delete(cb);},
    async readActivityFromWorkspaceContext(){
      reads++;
      if(options.blocked)await wait();
      if(options.deny)throw Error(secret);
      return makeView();
    },
  };
  const privatePort=createTrustedT3ReviewPort(trusted);
  // Only this limited capability crosses to the React surface.
  const host={readSelected:privatePort.readSelected,
    subscribeInvalidation:privatePort.subscribeInvalidation};
  return {host, selectionChange(){selected=Object.freeze({workspace_id:'ws:other'});
      selectionListeners.forEach(fn=>fn());},
    grantChanged(){ownerListeners.forEach(fn=>fn());},
    changeActor(){context=Object.freeze({kind:'PERSONAL',workspace_id:workspace,actor_id:'changed'});
      ownerListeners.forEach(fn=>fn());},
    release(){releases.shift()?.();}, selectionListeners,ownerListeners,calls:()=>reads};
}

test('renderer only receives a two-method capability, not Kernel or Access',async()=>{
  const h=makeHost(),states=[];
  assert.deepEqual(Object.keys(h.host).sort(),['readSelected','subscribeInvalidation']);
  assert.equal('signedAccess' in h.host,false);
  assert.equal('context' in h.host,false);
  const controller=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.equal(states[0].status,'READY_TO_READ');
  assert.equal(h.calls(),0);
  assert.equal((await controller.readSelected()).status,'REVIEW');
  assert.equal(h.calls(),1);
  assert.equal(states.at(-1).review.export_allowed,false);
  assert.equal(states.at(-1).review.anonymity,'NOT_ESTABLISHED');
  assert.equal(JSON.stringify(states).includes(secret),false);
  controller.dispose();
});

test('changing selected Workspace instantly removes an already shown preview',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();h.selectionChange();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  c.dispose();
});

test('signed status revocation signal clears an already shown preview',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();h.grantChanged();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  c.dispose();
});

test('in-flight read cannot update UI after selected Workspace changes',async()=>{
  const h=makeHost({blocked:true}),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  const p=c.readSelected();await Promise.resolve();
  h.selectionChange();h.release();
  assert.equal((await p).status,'INVALIDATED');
  assert.equal(states.at(-1).review,null);c.dispose();
});

test('in-flight read cannot update UI after signed status change',async()=>{
  const h=makeHost({blocked:true}),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  const p=c.readSelected();await Promise.resolve();
  h.grantChanged();h.release();
  assert.equal((await p).status,'INVALIDATED');
  assert.equal(states.at(-1).review,null);c.dispose();
});

test('concurrent read results never overwrite the newest review',async()=>{
  const h=makeHost({blocked:true}),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  const first=c.readSelected(), second=c.readSelected();
  h.release();assert.equal((await first).status,'INVALIDATED');
  assert.equal(states.at(-1).status,'READING');
  h.release();assert.equal((await second).status,'REVIEW');
  c.dispose();
});

test('original Host denial becomes a generic HOLD with no private exception',async()=>{
  const h=makeHost({deny:true}),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.deepEqual(await c.readSelected(),{status:'HOLD'});
  assert.equal(states.at(-1).code,'T3_AUTHORITATIVE_READ_REFUSED');
  assert.equal(JSON.stringify(states).includes(secret),false);c.dispose();
});

test('requires owner invalidation subscription, never trusts unobservable grant',()=>{
  const h=makeHost();delete h.host.subscribeInvalidation;
  assert.throws(()=>createT3ReviewController({host:h.host,onUpdate(){}}),
    {code:'T3_TRUSTED_HOST_INVALIDATION_REQUIRED'});
});

test('detaching removes both trusted Host subscriptions and rejects further reads',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  c.dispose();c.dispose();
  assert.equal(h.selectionListeners.size,0);assert.equal(h.ownerListeners.size,0);
  assert.equal((await c.readSelected()).status,'DETACHED');
  assert.equal(states.length,1);
});

test('reset switches to synthetic example without keeping old T3-derived review',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();c.reset();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});c.dispose();
});

test('untrusted or extended Host response cannot inject raw identities into renderer',async()=>{
  const h=makeHost(),states=[];
  const clean=await h.host.readSelected();
  h.host.readSelected=async()=>({...clean,source_identity:secret});
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.equal((await c.readSelected()).status,'HOLD');
  assert.equal(states.at(-1).code,'T3_HOST_RESULT_UNVERIFIED');
  assert.equal(JSON.stringify(states).includes(secret),false);c.dispose();
});

test('Host cannot report anonymous or exportable when T3 risk is undetermined',async()=>{
  const h=makeHost(),states=[];
  const clean=await h.host.readSelected();
  h.host.readSelected=async()=>({...clean,anonymity:'ANONYMOUS',export_allowed:true,
    iwxa_package:{source:secret}});
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.equal((await c.readSelected()).status,'HOLD');
  assert.equal(states.at(-1).code,'T3_HOST_RESULT_UNVERIFIED');c.dispose();
});

test('arbitrary text in Host reason codes is not accepted into UI',async()=>{
  const h=makeHost(),states=[];const clean=await h.host.readSelected();
  h.host.readSelected=async()=>({...clean,reason_codes:[secret]});
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.equal((await c.readSelected()).status,'HOLD');
  assert.equal(JSON.stringify(states).includes(secret),false);c.dispose();
});

test('mutating owner-returned candidate after delivery cannot mutate React review',async()=>{
  const h=makeHost(),states=[];const owner=await h.host.readSelected();
  h.host.readSelected=async()=>owner;
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.equal((await c.readSelected()).status,'REVIEW');
  const kept=JSON.stringify(states.at(-1).review);
  owner.structural_candidate[0].object_type='raw_private_source_id';
  assert.equal(JSON.stringify(states.at(-1).review),kept);c.dispose();
});
test('optional signed derivation button requires a current accepted review',async()=>{
  const h=makeHost(),states=[];let writes=0;
  h.host.stageSelected=async()=>{writes++;return {
    status:'OWNER_REVIEW_DRAFT',readback:true,export_allowed:false,
  };};
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  assert.deepEqual(await c.stageSelected(),{status:'UNAVAILABLE'});
  assert.equal(writes,0);
  await c.readSelected();
  assert.deepEqual(await c.stageSelected(),{status:'STAGED'});
  assert.equal(states.at(-1).status,'STAGED');
  assert.equal(states.at(-1).review,null);
  assert.equal(writes,1);
  assert.deepEqual(await c.stageSelected(),{status:'UNAVAILABLE'});
  assert.equal(writes,1);
  assert.equal(JSON.stringify(states).includes(secret),false);
  c.dispose();
});
test('derivation result with unknown data never reaches renderer as success',async()=>{
  const h=makeHost(),states=[];
  h.host.stageSelected=async()=>({
    status:'OWNER_REVIEW_DRAFT',readback:true,export_allowed:false,
    raw_person_id:secret,
  });
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();
  assert.deepEqual(await c.stageSelected(),{status:'HOLD'});
  assert.equal(states.at(-1).code,'T3_HOST_STAGE_RESULT_UNVERIFIED');
  assert.equal(JSON.stringify(states).includes(secret),false);
  c.dispose();
});
test('grant invalidation during an in-flight derivation hides late success',async()=>{
  const h=makeHost(),states=[];
  let release;
  h.host.stageSelected=()=>new Promise(resolve=>{release=()=>resolve({
    status:'OWNER_REVIEW_DRAFT',readback:true,export_allowed:false,
  });});
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();
  const pending=c.stageSelected();
  assert.equal(states.at(-1).status,'STAGING');
  h.grantChanged();
  release();
  assert.deepEqual(await pending,{status:'INVALIDATED'});
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  c.dispose();
});
test('Activity never advertises a stage command without the trusted owner',async()=>{
  const h=makeHost(),states=[];
  const c=createT3ReviewController({host:h.host,onUpdate:s=>states.push(s)});
  await c.readSelected();
  assert.deepEqual(await c.stageSelected(),{status:'UNAVAILABLE'});
  c.dispose();
});
