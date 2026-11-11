// Uses the ORIGINAL public T3 D1/D2 code checked out at an exact Git revision.
// This is a synthetic Host/Kernel facade contract test, not private signed
// issuer verification or installed T3 E2E. No browser is started.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectSelectedT3Activity, T3ActivityHold} from
  '../modules/activity-base-anonymizer/t3-selected-host.mjs';

const root = process.env.IWXA_T3_PUBLIC_CORE_DIR;
if (!root || !existsSync(join(resolve(root), 'src/t3/index.mjs'))) {
  throw Error('PUBLIC_PINNED_T3_CORE_CHECKOUT_REQUIRED');
}
const source = await import(pathToFileURL(join(resolve(root), 'src/t3/index.mjs')).href);
assert.equal(typeof source.readActivityFromWorkspaceContext, 'function');
assert.equal(typeof source.createSubjectKernelBinding, 'function');

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
    counts, revoke:()=>{revoked=true;}, switchDuringRead:()=>{swapped=true;},
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