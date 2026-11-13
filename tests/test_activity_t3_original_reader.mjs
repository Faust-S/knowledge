// Uses the ORIGINAL public T3 D1/D2 code checked out at an exact Git revision.
// This is a synthetic Host/Kernel facade contract test, not private signed
// issuer verification or installed T3 E2E. No browser is started.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectSelectedT3Activity, T3ActivityHold, createTrustedT3ReviewPort} from
  '../modules/activity-base-anonymizer/t3-selected-host.mjs';
import {bindT3ControlActivityReview} from '../modules/activity-base-anonymizer/t3-control-host-link.mjs';
import {createT3ReviewController} from
  '../modules/activity-base-anonymizer/t3-review-controller.mjs';

const root = process.env.IWXA_T3_PUBLIC_CORE_DIR;
if (!root || !existsSync(join(resolve(root), 'src/t3/index.mjs'))) {
  throw Error('PUBLIC_PINNED_T3_CORE_CHECKOUT_REQUIRED');
}
const source = await import(pathToFileURL(join(resolve(root), 'src/t3/index.mjs')).href);
assert.equal(typeof source.readActivityFromWorkspaceContext, 'function');
assert.equal(typeof source.createSubjectKernelBinding, 'function');
const {createControlLoopbackOwner}=await import(pathToFileURL(
  join(resolve(root),'src/t3/control-loopback-owner.mjs')).href);


const W = 'ws:host-selected';
const now = () => new Date();
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bindings = {
  objects: [{schema_id: 'd06.order', schema_version: '1.0.0', semantic_kind: 'Process'}],
  events: [
    {event_type: 'd06.order.opened', semantic_kind: 'Event'},
    {event_type: 'd06.order.finished', semantic_kind: 'Event'},
  ],
  relations: [],
};
function fixture() {
  let workspace = Object.freeze({workspace_id: W});
  let revoked = false;
  let swapped = false;
  let corrupt = false;
  const listeners = new Set();
  const accessListeners = new Set();
  const counts = {read: 0, write: 0};
  const objects = Array.from({length: 3}, (_, i) => ({
    object_id: `order:${i}`, workspace_id: W, revision: 2,
    schema_id: 'd06.order', schema_version: '1.0.0',
    data: {private_person: `PRIVATE_PERSON_${i}`},
    created_at: '2026-11-11T09:00:00Z', updated_at: '2026-11-11T09:02:00Z',
    created_by_service: 'd06', updated_by_service: 'd06', extensions: {},
  }));
  const events = objects.flatMap((o, i) => [
    {event_id:`event:${i}:1`,workspace_id: W,object_id:o.object_id,revision:1,
      event_type:'d06.order.opened',service_id:'d06',occurred_at:'2026-11-11T09:00:00Z',
      payload:{private:'PRIVATE_NOT_TO_COPY'}},
    {event_id:`event:${i}:2`,workspace_id: W,object_id:o.object_id,revision:2,
      event_type:'d06.order.finished',service_id:'d06',occurred_at:'2026-11-11T09:02:00Z',
      payload:{private:'PRIVATE_NOT_TO_COPY'}},
  ]);
  const user = Object.freeze({kind:'PERSONAL', context_id:'ctx:personal',
    actor_id:'person:owner',principal_id:'person:owner',role_id:'role:reader',
    grant_id:'grant:activity-read',realm_id:'realm:personal',audience:'host:t3',
    resource:W,purpose:'activity.analysis',workspace_id:W,organization_id:null,
    scope_revision:1});
  const port = {
    currentContext:()=>user,
    actionFor:operation => {
      assert.ok(['t1.getWorkspace','t1.listObjects','t1.getObject','t1.listEventsSince']
        .includes(operation), 'Activity must never request a T2 write operation');
      return 'activity.read';
    },
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    authorize:request => ({schema:'IWXA_T3_AUTHORIZATION_DECISION/1',
      allowed:!revoked,outcome:revoked?'DENIED':'PERMITTED',evidenceOnly:true,
      requestDigest:digest(request),policyDigest:digest('synthetic-policy'),
      validUntil:new Date(Date.now()+60_000).toISOString(),
      statusObservedAt:new Date(Date.now()-1000).toISOString(),
      evaluatedAt:now().toISOString(),statusSequence:1,
      authorityPath:[{grantId:request.grantId}]}),
    verifyDecisionBinding: (request,decision) => decision.requestDigest===digest(request),
  };
  const kernel = {
    sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6'},
    hasOperation: op => ['t1.getWorkspace','t1.listObjects','t1.getObject','t1.listEventsSince'].includes(op),
    async getWorkspace(id){counts.read++;return {workspace_id:id,created_at:'2026-11-11T00:00:00Z'};},
    async listObjects(query){counts.read++;if (corrupt) return [objects[0],{...objects[1],workspace_id:'ws:foreign'},objects[2]];
      return objects;},
    async getObject(id,objectId){counts.read++;
      if (swapped){swapped=false;workspace=Object.freeze({workspace_id:'ws:other'});for(const l of listeners)l();}
      return {object:objects.find(x=>x.object_id===objectId),relations:{incoming:[],outgoing:[]}};},
    async listEventsSince(){counts.read++;return events;},
    async putObject(){counts.write++;throw Error('MUST_NOT_WRITE');},
  };
  const context = {kernel,currentWorkspace:{get:()=>workspace,subscribe(l){listeners.add(l);return()=>listeners.delete(l);}}};
  return {context,signedAccess:port,bindings,
    readActivityFromWorkspaceContext:source.readActivityFromWorkspaceContext,
    subscribeInvalidation(listener){accessListeners.add(listener);return()=>accessListeners.delete(listener);},
    counts, revoke:()=>{revoked=true;for(const l of accessListeners)l();},
    switchDuringRead:()=>{swapped=true;},
    corruptSource:()=>{corrupt=true;}, objects, events};
}

test('original public T3 D1/D2 reader is really invoked with the selected Host and signed owner port',async()=>{
  const h=fixture();const before=structuredClone({objects:h.objects,events:h.events});
  const value=await inspectSelectedT3Activity(h);
  assert.equal(value.status,'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  assert.equal(value.structural_candidate.length,1);
  assert.equal(value.structural_candidate[0].object_local_successions.length,1);
  assert.equal(value.structural_candidate[0].object_local_successions[0].cohort_band,'3-9');
  assert.ok(h.counts.read>=9);assert.equal(h.counts.write,0);
  assert.deepEqual({objects:h.objects,events:h.events},before);
  assert.equal(value.export_allowed,false);
  for(const s of ['PRIVATE_PERSON_', 'PRIVATE_NOT_TO_COPY', 'order:0', W,
    'd06.order', 'event:0:1', '2026-11-11'])
    assert.equal(JSON.stringify(value).includes(s),false,s);
});

test('original signed D1 binding rejects revocation before a single source read',async()=>{
  const h=fixture();h.revoke();
  await assert.rejects(inspectSelectedT3Activity(h),
    e=>e instanceof T3ActivityHold && e.code==='T3_AUTHORITATIVE_READ_REFUSED');
  assert.equal(h.counts.read,0);assert.equal(h.counts.write,0);
});

test('original D2 rejects cross-workspace projection rows without leaking them',async()=>{
  const h=fixture();h.corruptSource();
  await assert.rejects(inspectSelectedT3Activity(h),
    {code:'T3_AUTHORITATIVE_READ_REFUSED'});
  assert.equal(h.counts.write,0);
});

test('original Workspace selection subscription detects switch midway through D2 read',async()=>{
  const h=fixture();h.switchDuringRead();
  await assert.rejects(inspectSelectedT3Activity(h),
    {code:'T3_AUTHORITATIVE_READ_REFUSED'});
  assert.equal(h.counts.write,0);
});

test('original D2 missing object revision yields HOLD, never an assumed transition',async()=>{
  const h=fixture();h.events[0].revision=99;
  const value=await inspectSelectedT3Activity(h);
  assert.equal(value.status,'HOLD');
  assert.equal(value.structural_candidate,null);
  assert.ok(value.reason_codes.includes('T3_D2_UNRESOLVED_SOURCE_LINK'));
  assert.equal(h.counts.write,0);
});

test('original T3 D1/D2 read reaches Host-mounted Activity review and revoked grant clears it',async()=>{
  const h=fixture();
  const states=[];
  const ui=createT3ReviewController({
    host:createTrustedT3ReviewPort({...h,subscribeOwnerInvalidation:h.subscribeInvalidation}),
    onUpdate:s=>states.push(s),
  });
  assert.equal(states.at(-1).status,'READY_TO_READ');
  assert.equal(h.counts.read,0);
  const result=await ui.readSelected();
  assert.equal(result.status,'REVIEW');
  assert.equal(states.at(-1).review.status,'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  assert.equal(states.at(-1).review.export_allowed,false);
  assert.ok(h.counts.read>0);
  const before=h.counts.read;
  h.revoke();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  assert.equal((await ui.readSelected()).status,'HOLD');
  assert.equal(states.at(-1).code,'T3_AUTHORITATIVE_READ_REFUSED');
  assert.equal(h.counts.read,before,'revocation must prevent original Kernel reads');
  assert.equal(h.counts.write,0);
  assert.equal(JSON.stringify(states).includes('PRIVATE_NOT_TO_COPY'),false);
  ui.dispose();
});

test('original T3 Workspace subscription prevents an in-flight stale Activity UI view',async()=>{
  const h=fixture();
  const states=[];
  const ui=createT3ReviewController({
    host:createTrustedT3ReviewPort({...h,subscribeOwnerInvalidation:h.subscribeInvalidation}),
    onUpdate:s=>states.push(s),
  });
  h.switchDuringRead();
  assert.equal((await ui.readSelected()).status,'INVALIDATED');
  assert.equal(states.at(-1).status,'READY_TO_READ');
  assert.equal(states.at(-1).review,null);
  assert.equal(h.counts.write,0);
  ui.dispose();
});

test('original T3 D1/D2 reader is invoked from the Control-signed Activity Host link', async () => {
  const h=fixture(),changed=new Set();
  let epoch=1,grantCalls=0;
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'north-lab',contextEpoch:epoch}),
    signedActivityAccess:createPort=>{grantCalls++;return createPort(h.signedAccess);},
    subscribeInvalidation:fn=>{changed.add(fn);return()=>changed.delete(fn);},
  };
  const link=bindT3ControlActivityReview({
    control,context:h.context,bindings:h.bindings,
    createSignedAccessHostPort:owner=>owner,
    readActivityFromWorkspaceContext:source.readActivityFromWorkspaceContext,
  });
  const states=[],ui=createT3ReviewController({host:link.port,onUpdate:v=>states.push(v)});
  assert.equal((await ui.readSelected()).status,'REVIEW');
  assert.equal(grantCalls,1);
  assert.ok(h.counts.read>=9);
  assert.equal(h.counts.write,0);
  assert.equal(states.at(-1).review.export_allowed,false);
  const readCount=h.counts.read;
  h.revoke();epoch++;for(const fn of changed)fn();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  assert.equal((await ui.readSelected()).status,'HOLD');
  assert.equal(h.counts.read,readCount);
  assert.equal(h.counts.write,0);
  assert.equal(grantCalls,2);
  ui.dispose();link.dispose();
  assert.equal(changed.size,0);
});

test('original T3 Workspace switching during the Control-linked read invalidates the UI',async()=>{
  const h=fixture(),changed=new Set();
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'north-lab',contextEpoch:1}),
    signedActivityAccess:factory=>factory(h.signedAccess),
    subscribeInvalidation:fn=>{changed.add(fn);return()=>changed.delete(fn);},
  };
  const link=bindT3ControlActivityReview({
    control,context:h.context,bindings:h.bindings,
    createSignedAccessHostPort:owner=>owner,
    readActivityFromWorkspaceContext:source.readActivityFromWorkspaceContext,
  });
  const updates=[],ui=createT3ReviewController({host:link.port,onUpdate:v=>updates.push(v)});
  h.switchDuringRead();
  assert.equal((await ui.readSelected()).status,'INVALIDATED');
  assert.deepEqual(updates.at(-1),{status:'READY_TO_READ',review:null});
  assert.equal(h.counts.write,0);
  ui.dispose();link.dispose();
});


test('ORIGINAL T3 signed factory authorizes every Control-linked D2 read and fails on revoked grant',async()=>{
  assert.equal(typeof source.createSignedAccessHostPort,'function');
  const h=fixture(),now=Date.now(),changed=new Set();
  let revoked=false,approvals=0,issued=0;
  const actor={kind:'CORP',context_id:'context:synthetic-north:1',
    actor_id:'person:synthetic',principal_id:'org:synthetic-north',
    role_id:'role:activity-reader',grant_id:'grant:activity-read',
    realm_id:'realm:synthetic-north',audience:'host:t3',
    resource:W,workspace_id:W,purpose:'activity.read',
    organization_id:'org:synthetic-north',scope_revision:1};
  function observedPreview(input){
    const operation=input.operation;
    const request={id:operation.operationId,actorId:actor.actor_id,
      principalId:actor.principal_id,roleId:actor.role_id,
      grantId:actor.grant_id,audience:operation.audience,
      resource:operation.resource,action:operation.action,
      purpose:operation.purpose,realmId:actor.realm_id,
      operationDigest:digest({synthetic_gate:input})};
    return {schema:'IWXA_T3_ORGANIZATION_OPERATION_PREVIEW/1',
      authorized:false,subjectType:'ORGANIZATION',
      organizationId:actor.organization_id,workspaceId:W,
      scopeDigest:request.operationDigest,
      credentialKeyId:'credential:synthetic',request};
  }
  const ownerSpec={
    currentContext:()=>actor,
    actionFor(operation){
      assert.ok(['t1.getWorkspace','t1.listObjects','t1.getObject',
        't1.listEventsSince'].includes(operation));
      return 'activity.read';
    },
    operationDigest:({operation,input,context})=>digest({operation,input,context}),
    canonicalDigest:digest,
    corporate:{productId:'IWXA_CONTROL_CENTER',
      inputFor:()=>({synthetic:true}),
      prove:()=>({keyId:'credential:synthetic',proof:'contract-only'}),
      gate:{
        preview:observedPreview,
        authorize(input,{challenge,proof}){
          approvals++;
          if(revoked)return {schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',
            allowed:false,outcome:'DENIED',evidenceOnly:true,productionActivation:false};
          const p=observedPreview(input);
          return {schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',
            allowed:true,outcome:'PERMITTED',
            evidenceOnly:true,productionActivation:false,
            requestDigest:digest(p.request),policyDigest:digest('synthetic'),
            operationDigest:p.request.operationDigest,
            evidenceDigest:digest({challenge,proof}),
            grantId:actor.grant_id,organizationId:actor.organization_id,
            workspaceId:W,statusSequence:1,
            validUntil:new Date(now+60_000).toISOString(),
            doesNotTransferData:true,doesNotAcceptCorporateCopy:true};
        },
      },
    },
    clock:()=>now,
  };
  const control={
    snapshot:()=>({context:'ORGANIZATION',contextId:'north-lab',contextEpoch:1}),
    signedActivityAccess(createPort){issued++;return createPort(ownerSpec);},
    subscribeInvalidation(fn){changed.add(fn);return()=>changed.delete(fn);},
  };
  const link=bindT3ControlActivityReview({
    control,context:h.context,bindings:h.bindings,
    createSignedAccessHostPort:source.createSignedAccessHostPort,
    readActivityFromWorkspaceContext:source.readActivityFromWorkspaceContext,
  });
  const states=[],ui=createT3ReviewController({host:link.port,onUpdate:v=>states.push(v)});
  assert.equal((await ui.readSelected()).status,'REVIEW');
  assert.equal(issued,1);
  assert.ok(approvals>=9);
  assert.ok(h.counts.read>=9);
  assert.equal(h.counts.write,0);
  assert.equal(states.at(-1).review.export_allowed,false);
  assert.equal(states.at(-1).review.anonymity,'NOT_ESTABLISHED');
  const readCount=h.counts.read;
  revoked=true;for(const fn of changed)fn();
  assert.deepEqual(states.at(-1),{status:'READY_TO_READ',review:null});
  assert.equal((await ui.readSelected()).status,'HOLD');
  assert.equal(h.counts.read,readCount);
  assert.equal(issued,2);
  assert.equal(h.counts.write,0);
  ui.dispose();link.dispose();assert.equal(changed.size,0);
});

function qualifiedOriginalFixture() {
  const h=fixture();
  h.bindings=structuredClone(h.bindings);
  h.bindings.objects.push({
    schema_id:'d06.material',schema_version:'1.0.0',semantic_kind:'Entity',
  });
  h.bindings.events[1].object_links=[
    {field:'affected',qualifier:'uses',many:true},
  ];
  const materials=Array.from({length:3},(_,i)=>({
    object_id:`material:${i}`,workspace_id:W,revision:1,
    schema_id:'d06.material',schema_version:'1.0.0',
    data:{private_supplier:`PRIVATE_SUPPLIER_${i}`},
    created_at:'2026-11-11T09:00:00Z',updated_at:'2026-11-11T09:00:00Z',
    created_by_service:'d06',updated_by_service:'d06',extensions:{},
  }));
  h.objects.push(...materials);
  for(let i=0;i<3;i++){
    const event=h.events.find(e=>e.event_id===`event:${i}:2`);
    event.payload.affected=[{object_id:`material:${i}`,revision:1}];
  }
  return h;
}
test('new public T3 D2 projects qualified event-object links through original signed Host to Activity',async()=>{
  const h=qualifiedOriginalFixture();
  const before=structuredClone({objects:h.objects,events:h.events,bindings:h.bindings});
  const result=await inspectSelectedT3Activity(h);
  assert.equal(result.status,'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
  assert.equal(result.structural_candidate.length,2);
  assert.deepEqual(result.structural_candidate.map(x=>x.cohort_band),['3-9','3-9']);
  assert.equal(result.export_allowed,false);
  assert.equal(result.anonymity,'NOT_ESTABLISHED');
  assert.equal(result.iwxa_package,null);
  assert.ok(h.counts.read>=12,'original Kernel must read every source object and recheck');
  assert.equal(h.counts.write,0);
  assert.deepEqual({objects:h.objects,events:h.events,bindings:h.bindings},before);
  const leaked=JSON.stringify(result);
  for(const secret of ['material:0','PRIVATE_SUPPLIER','PRIVATE_PERSON_',
    'PRIVATE_NOT_TO_COPY','d06.material','uses','event:0:2',W])
    assert.equal(leaked.includes(secret),false,secret);
  const beforeRevoke=h.counts.read;
  h.revoke();
  await assert.rejects(inspectSelectedT3Activity(h),{code:'T3_AUTHORITATIVE_READ_REFUSED'});
  assert.equal(h.counts.read,beforeRevoke,'revoked actor must never reach original Kernel');
});
test('new public T3 D2 reports unresolved multi-object links as privacy HOLD',async()=>{
  const h=qualifiedOriginalFixture();
  h.events.find(x=>x.event_id==='event:0:2').payload.affected[0].object_id='external:unverified';
  const result=await inspectSelectedT3Activity(h);
  assert.equal(result.status,'HOLD');
  assert.ok(result.reason_codes.includes('T3_D2_UNRESOLVED_SOURCE_LINK'));
  assert.equal(result.structural_candidate,null);
  assert.equal(result.export_allowed,false);
  assert.equal(JSON.stringify(result).includes('external:unverified'),false);
});

test('original source-bound epistemic classification reaches Activity and never becomes observed truth',async()=>{
  for(const epistemic_status of ['reported','declared','inferred','proposed']){
    const h=fixture();
    h.bindings=structuredClone(h.bindings);
    h.bindings.events[1].epistemic_status=epistemic_status;
    const unchanged=structuredClone({objects:h.objects,events:h.events,bindings:h.bindings});
    const review=await inspectSelectedT3Activity(h);
    assert.equal(review.status,'HOLD',epistemic_status);
    assert.deepEqual(review.reason_codes,['T3_D2_UNVERIFIED_EVENT_STEP']);
    assert.equal(review.structural_candidate,null);
    assert.equal(review.export_allowed,false);
    assert.equal(review.anonymity,'NOT_ESTABLISHED');
    assert.equal(review.iwxa_package,null);
    assert.equal(h.counts.write,0);
    assert.deepEqual({objects:h.objects,events:h.events,bindings:h.bindings},unchanged);
    const rendered=JSON.stringify(review);
    for(const secret of ['PRIVATE_PERSON_','PRIVATE_NOT_TO_COPY',W,'d06.order','event:0'])
      assert.equal(rendered.includes(secret),false,secret);
  }
  const observed=fixture();
  observed.bindings=structuredClone(observed.bindings);
  observed.bindings.events[1].epistemic_status='observed';
  assert.equal((await inspectSelectedT3Activity(observed)).status,
    'STRUCTURE_PRESERVED_REVIEW_REQUIRED');
});
test('malformed epistemic status in original D2 source contract fails closed',async()=>{
  const h=fixture();h.bindings=structuredClone(h.bindings);
  h.bindings.events[1].epistemic_status='verified_by_ai';
  await assert.rejects(inspectSelectedT3Activity(h),{
    code:'T3_AUTHORITATIVE_READ_REFUSED',
  });
  assert.equal(h.counts.write,0);
});

test('original T3 signed loopback owner mounts Activity Read without second Control app',async()=>{
  const h=fixture(),origin='http://127.0.0.1:19713',token='q'.repeat(44),epoch=1;
  const encrypted=new TextEncoder();
  let eventController=null,accessCount=0;
  const answer=(value,status=200)=>new Response(JSON.stringify(value),{
    status,headers:{'Content-Type':'application/json'},
  });
  const trustedFetch=async(url,request={})=>{
    assert.ok(url.startsWith(origin+'/api/t3/'));
    assert.equal(request.headers.Authorization,'Bearer '+token);
    if(url.endsWith('/owner-events')){
      assert.equal(request.headers.Accept,'text/event-stream');
      return new Response(new ReadableStream({start(controller){
        eventController=controller;
        controller.enqueue(encrypted.encode('event: ready\n\n'));
      }}),{status:200,headers:{'Content-Type':'text/event-stream'}});
    }
    if(url.endsWith('/context-epoch'))return answer({contextEpoch:epoch});
    const command=JSON.parse(request.body);
    if(command.verb==='select'){
      accessCount++;
      return answer({available:command.scope==='activity'&&
        command.operation==='activity.read',contextEpoch:epoch});
    }
    if(command.verb==='context')return answer({
      context:await h.signedAccess.currentContext(),
    });
    if(command.verb==='action')return answer({
      action:await h.signedAccess.actionFor(command.kernelOperation),
    });
    if(command.verb==='digest')return answer({
      digest:await h.signedAccess.operationDigest({
        operation:command.kernelOperation,
        input:command.command,context:command.context,
      }),
    });
    if(command.verb==='authorize')return answer({
      decision:await h.signedAccess.authorize(command.request),
    });
    throw Error('UNRECOGNIZED_ORIGINAL_CONTROL_REQUEST');
  };
  const original=createControlLoopbackOwner({
    origin,token,fetchImpl:trustedFetch,
  });
  const bridge=bindT3ControlActivityReview({
    control:original,context:h.context,bindings:h.bindings,
    readActivityFromWorkspaceContext:source.readActivityFromWorkspaceContext,
  });
  assert.deepEqual(Object.keys(bridge.port).sort(),[
    'readSelected','subscribeInvalidation',
  ]);
  const updates=[],ui=createT3ReviewController({
    host:bridge.port,onUpdate:value=>updates.push(value),
  });
  try{
    assert.deepEqual(await ui.readSelected(),{status:'REVIEW'});
    assert.equal(updates.at(-1).review.export_allowed,false);
    assert.equal(updates.at(-1).review.anonymity,'NOT_ESTABLISHED');
    assert.equal(h.counts.write,0);
    assert.equal(accessCount,1);
    assert.equal(JSON.stringify(updates).includes('PRIVATE_PERSON_'),false);
    const prior=h.counts.read;
    const invalidated=new Promise(resolve=>{bridge.port.subscribeInvalidation(resolve);});
    h.revoke();
    eventController.enqueue(encrypted.encode('event: invalidated\n\n'));
    await invalidated;
    assert.deepEqual(updates.at(-1),{status:'READY_TO_READ',review:null});
    assert.deepEqual(await ui.readSelected(),{status:'HOLD'});
    assert.equal(h.counts.read,prior,'revoked Control owner cannot reach Kernel');
    assert.equal(h.counts.write,0);
  }finally{
    ui.dispose();bridge.dispose();
    try{eventController?.close();}catch{}
  }
});
