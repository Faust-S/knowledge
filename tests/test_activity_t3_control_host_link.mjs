import test from 'node:test';
import assert from 'node:assert/strict';
import {bindT3ControlActivityReview} from '../modules/activity-base-anonymizer/t3-control-host-link.mjs';
import {createT3ReviewController} from '../modules/activity-base-anonymizer/t3-review-controller.mjs';

const secret='PRIVATE_PERSON_AND_GRANT_11';
const W='ws:selected';
function source(){
  const nodes=Array.from({length:3},(_,i)=>({object_id:`order:${i}`,revision:1,
    schema_id:'private.order',schema_version:'1.0.0',semantic_kind:'Process'}));
  return {workspace_id:W,nodes,events:nodes.flatMap((n,i)=>[
    {event_id:`e:${i}:1`,event_type:'private.start',semantic_kind:'Event',
      occurred_at:'2026-11-11T11:00:00Z',object_ref:{object_id:n.object_id,revision:1}},
    {event_id:`e:${i}:2`,event_type:'private.end',semantic_kind:'Event',
      occurred_at:'2026-11-11T11:01:00Z',object_ref:{object_id:n.object_id,revision:1}},
  ]),relations:[],unresolved:[],unmapped:{object_ids:[],event_ids:[],relation_ids:[]}};
}
function fixture(opts={}){
  let workspace=Object.freeze({workspace_id:W}),epoch=1,scope='ORGANIZATION',org='north-lab';
  let revoked=false,readerCount=0,grantCount=0,allowRead=true,stopRelease=null;
  const scopeListeners=new Set(),workspaceListeners=new Set();
  const current=()=>({kind:'CORP',workspace_id:W,actor_id:secret,
    grant_id:`private:grant:${epoch}`});
  const owner=()=>({currentContext:current,authorize(){},verifyDecisionBinding(){},
    actionFor(){},operationDigest(){}});
  const control={
    snapshot:()=>({context:scope,contextId:org,contextEpoch:epoch,identity:secret}),
    signedActivityAccess(create){
      grantCount++;
      if(revoked||!allowRead)throw Error(secret);
      return create({port:owner()});
    },
    subscribeInvalidation(fn){scopeListeners.add(fn);return()=>scopeListeners.delete(fn);},
  };
  const context={kernel:{},currentWorkspace:{get:()=>workspace,
    subscribe(fn){workspaceListeners.add(fn);return()=>workspaceListeners.delete(fn);}}};
  const args={control,context,createSignedAccessHostPort:({port})=>port,bindings:{},
    readActivityFromWorkspaceContext:async()=>{
      readerCount++;
      if(opts.blocked)await new Promise(resolve=>{stopRelease=resolve});
      return source();
    }};
  return {args,control,context,
    revoke(){revoked=true;epoch++;scopeListeners.forEach(fn=>fn());},
    changeOrg(next='south-lab'){org=next;epoch++;scopeListeners.forEach(fn=>fn());},
    selectPersonal(){scope='PERSONAL';epoch++;scopeListeners.forEach(fn=>fn());},
    selectWorkspace(other){workspace=Object.freeze({workspace_id:other});workspaceListeners.forEach(fn=>fn());},
    deny(){allowRead=false;epoch++;scopeListeners.forEach(fn=>fn());},
    tickSilent(){epoch++;},
    release(){stopRelease?.();stopRelease=null;},
    reads:()=>readerCount,grants:()=>grantCount,
    scopeListeners,workspaceListeners};
}
function setup(opts={}){
  const v=fixture(opts),link=bindT3ControlActivityReview(v.args),updates=[];
  const ui=createT3ReviewController({host:link.port,onUpdate:s=>updates.push(s)});
  return {v,link,ui,updates};
}

test('narrow Control link keeps signed grants and Kernel out of the renderer',async()=>{
  const {v,link,ui,updates}=setup();
  assert.deepEqual(Object.keys(link.port).sort(),['readSelected','subscribeInvalidation']);
  assert.equal('control' in link.port,false);
  assert.equal('kernel' in link.port,false);
  assert.equal('signedAccess' in link.port,false);
  assert.equal((await ui.readSelected()).status,'REVIEW');
  assert.equal(v.reads(),1);assert.equal(v.grants(),1);
  assert.equal(updates.at(-1).review.export_allowed,false);
  assert.equal(updates.at(-1).review.anonymity,'NOT_ESTABLISHED');
  assert.equal(JSON.stringify(updates).includes(secret),false);
  ui.dispose();link.dispose();
});

test('each read obtains a fresh original signed Activity DATA port',async()=>{
  const {v,ui,link}=setup();
  await ui.readSelected();await ui.readSelected();
  assert.equal(v.reads(),2);assert.equal(v.grants(),2);
  ui.dispose();link.dispose();
});

test('revocation clears review and a refused right never reaches original reader',async()=>{
  const {v,ui,link,updates}=setup();
  await ui.readSelected();v.revoke();
  assert.deepEqual(updates.at(-1),{status:'READY_TO_READ',review:null});
  assert.equal((await ui.readSelected()).status,'HOLD');
  assert.equal(updates.at(-1).code,'T3_CONTROL_ACTIVITY_READ_NOT_GRANTED');
  assert.equal(v.reads(),1);
  assert.equal(JSON.stringify(updates).includes(secret),false);
  ui.dispose();link.dispose();
});

test('change of active organization invalidates preview, and next read requires new grant',async()=>{
  const {v,ui,link,updates}=setup();
  await ui.readSelected();v.changeOrg();
  assert.equal(updates.at(-1).review,null);
  await ui.readSelected();
  assert.equal(v.grants(),2);assert.equal(v.reads(),2);
  ui.dispose();link.dispose();
});

test('PERSONAL without corporate selected context is denied before original read',async()=>{
  const {v,ui,link,updates}=setup();v.selectPersonal();
  await ui.readSelected();
  assert.equal(updates.at(-1).status,'HOLD');
  assert.equal(updates.at(-1).code,'T3_CONTROL_SELECTED_ORGANIZATION_REQUIRED');
  assert.equal(v.reads(),0);
  ui.dispose();link.dispose();
});

test('module Workspace selection invalidates preview synchronously',async()=>{
  const {v,ui,link,updates}=setup();
  await ui.readSelected();v.selectWorkspace('ws:foreign');
  assert.deepEqual(updates.at(-1),{status:'READY_TO_READ',review:null});
  assert.equal((await ui.readSelected()).status,'HOLD');
  assert.equal(v.reads(),1);
  ui.dispose();link.dispose();
});

test('Control context switch during original async read denies stale response',async()=>{
  const {v,ui,link,updates}=setup({blocked:true});
  const pending=ui.readSelected();await Promise.resolve();
  v.changeOrg();v.release();
  assert.equal((await pending).status,'INVALIDATED');
  assert.deepEqual(updates.at(-1),{status:'READY_TO_READ',review:null});
  ui.dispose();link.dispose();
});

test('silent owner epoch changes during async read fail closed',async()=>{
  const {v,ui,link,updates}=setup({blocked:true});
  const pending=ui.readSelected();await Promise.resolve();
  v.tickSilent();v.release();
  assert.equal((await pending).status,'HOLD');
  assert.ok(['T3_CONTROL_CONTEXT_CHANGED_DURING_READ',
    'T3_SELECTED_CONTEXT_CHANGED_AFTER_READ'].includes(updates.at(-1).code));
  ui.dispose();link.dispose();
});

test('closing link invalidates already visible review, disposes subscriptions, no future reads',async()=>{
  const {v,ui,link,updates}=setup();
  await ui.readSelected();link.dispose();link.dispose();
  assert.deepEqual(updates.at(-1),{status:'READY_TO_READ',review:null});
  assert.equal(v.scopeListeners.size,0);
  assert.equal(v.workspaceListeners.size,0);
  assert.equal((await ui.readSelected()).status,'HOLD');
  assert.equal(updates.at(-1).code,'T3_CONTROL_HOST_DETACHED');
  ui.dispose();
});

test('broken original owner or missing event subscription cannot masquerade as connected Host',()=>{
  const v=fixture();
  assert.throws(()=>bindT3ControlActivityReview({...v.args,control:{...v.control,subscribeInvalidation:null}}),
    {code:'T3_CONTROL_ORIGINAL_HOST_REQUIRED'});
  assert.throws(()=>bindT3ControlActivityReview({...v.args,createSignedAccessHostPort:null}),
    {code:'T3_CONTROL_ORIGINAL_HOST_REQUIRED'});
});

test('subscriber failure never prevents owner context transition',async()=>{
  const v=fixture(),link=bindT3ControlActivityReview(v.args);
  link.port.subscribeInvalidation(()=>{throw Error('synthetic ui failure');});
  v.changeOrg();
  assert.equal(v.control.snapshot().contextId,'south-lab');
  link.dispose();
});