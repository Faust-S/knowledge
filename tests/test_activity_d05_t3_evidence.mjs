// Evidence contract from the exact CehoVod T2 source + ORIGINAL released T3.
// Data modelled in this test; NOT a claim about factory execution of CASE-001.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {D05_SOURCE_PIN,D05_RESULT_TYPES,D05_EVENT_TYPES,
 createCehovodD05T3Bindings,createTrustedCehovodD05ReviewPort} from
 '../modules/activity-base-anonymizer/d05-t3-evidence-binding.mjs';
import {inspectSelectedT3Activity} from
 '../modules/activity-base-anonymizer/t3-selected-host.mjs';
import {createT3ReviewController} from
 '../modules/activity-base-anonymizer/t3-review-controller.mjs';

const core=process.env.IWXA_T3_PUBLIC_CORE_DIR;
assert.ok(core&&existsSync(join(resolve(core),'src/t3/index.mjs')),
 'ACTIVITY_D05_ORIGINAL_PINNED_T3_REQUIRED');
const original=await import(pathToFileURL(join(resolve(core),'src/t3/index.mjs')).href);
test('inspected D05 binding contract preserves 26 Result types and three reported events',()=>{
 assert.equal(D05_SOURCE_PIN.domain,'ru.5ibs.productionops');
 assert.equal(D05_SOURCE_PIN.commit,'0ada4f082a39ec9a7bf2be3f75b57ebc5ebc39b4');
 assert.equal(new Set(D05_RESULT_TYPES).size,26);
 assert.deepEqual([...D05_EVENT_TYPES],[
  'cehovod.result.saved','cehovod.order.transitioned',
  'cehovod.operation.transitioned',
 ]);
 const b=createCehovodD05T3Bindings();
 assert.equal(b.objects.length,26);assert.equal(b.events.length,3);
 assert.deepEqual(b.relations,[{kind:'based_on',relation:'based_on'}]);
 assert.deepEqual(b.context_events,['workspace.created']);
 assert.ok(b.objects.every(v=>v.semantic_kind==='Result'));
 assert.ok(b.events.every(v=>v.epistemic_status==='reported'));
 b.objects.length=0;
 assert.equal(createCehovodD05T3Bindings().objects.length,26);
});

/** Source parity is allowed ONLY with an already-approved local D05 checkout.
 * The public CI MUST NOT access or authenticate to the private website repo.
 */
if(process.env.IWXA_D05_SITE_SOURCE_DIR){
 const site=resolve(process.env.IWXA_D05_SITE_SOURCE_DIR);
 const root=join(site,'t2-site-module/cehovod');
 if(!existsSync(join(root,'result-contract.ts')))
  throw Error('ACTIVITY_D05_OPTIONAL_LOCAL_SOURCE_NOT_FOUND');
 const read=name=>readFileSync(join(root,name),'utf8');
 test('OPTIONAL local D05 exact source parity, never in public Actions',()=>{
  const match=read('result-contract.ts').match(/export const RESULT_TYPES = \[([\s\S]*?)\] as const;/);
  assert.ok(match);
  assert.deepEqual([...match[1].matchAll(/"([a-z0-9-]+)"/g)]
   .map(row=>row[1]),[...D05_RESULT_TYPES]);
  assert.match(read('module-id.ts'),/DOMAIN_ID = "ru\.5ibs\.productionops"/);
  const types=['commands.ts','order-transition.ts','operation-command.ts']
   .flatMap(name=>[...read(name).matchAll(/event_type:\s*"([^"]+)"/g)]
    .map(row=>row[1])).sort();
  assert.deepEqual(types,[...D05_EVENT_TYPES].sort());
  assert.match(read('commands.ts'),/kind: "based_on"/);
  assert.match(read('operation-command.ts'),/operation_id: a\.operation_id/);
 });
}

const W='ws:case001',DOMAIN='ru.5ibs.productionops',SECRET='PRIVATE_D05_CLIENT';
function fixture(){
 let revoked=false,readCalls=0,writeCalls=0;const listeners=new Set();
 const current=Object.freeze({workspace_id:W});
 const obj=(id,type,revision)=>({object_id:id,workspace_id:W,revision,
  schema_id:DOMAIN+'.'+type,schema_version:'1.0.0',
  data:{object_id:id,object_type:type,summary_markdown:SECRET,
    value:{quantity:120,kind:'MODEL_ONLY_NOT_VERIFIED'}},
  created_at:'2026-11-16T08:00:00Z',updated_at:'2026-11-16T09:00:00Z',
  created_by_service:DOMAIN+'.host',updated_by_service:DOMAIN+'.host',extensions:{}});
 const objects=[obj('draft:case001','production-order-draft',2),
  obj('order:case001','production-order',1),
  obj('execution:case001','production-execution',4),
  obj('qc:case001','quality-check-result',1)];
 const ev=(id,object_id,revision,event_type,at,payload)=>({
  event_id:id,object_id,revision,workspace_id:W,
  event_type,service_id:DOMAIN+'.host',occurred_at:at,payload});
 const events=[
  ev('event:1','draft:case001',1,'cehovod.result.saved',
   '2026-11-16T08:00:00Z',{private:SECRET}),
  ev('event:2','draft:case001',2,'cehovod.order.transitioned',
   '2026-11-16T08:02:00Z',{action:'approve',actor_role:'manager'}),
  ev('event:3','order:case001',1,'cehovod.result.saved',
   '2026-11-16T08:03:00Z',{private:SECRET}),
  ev('event:4','execution:case001',2,'cehovod.operation.transitioned',
   '2026-11-16T08:05:00Z',{operation_id:'cut',action:'complete'}),
  ev('event:5','execution:case001',4,'cehovod.operation.transitioned',
   '2026-11-16T09:00:00Z',{operation_id:'bend',action:'rework'}),
  ev('event:6','qc:case001',1,'cehovod.result.saved',
   '2026-11-16T09:01:00Z',{private:SECRET}),
 ];
 const relations=new Map([
  ['order:case001',[{workspace_id:W,relation_id:'ceh.link.order',
   from_object_id:'order:case001',to_object_id:'draft:case001',kind:'based_on'}]],
  ['execution:case001',[{workspace_id:W,relation_id:'ceh.link.execution',
   from_object_id:'execution:case001',to_object_id:'order:case001',kind:'based_on'}]],
 ]);
 const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const owner=Object.freeze({kind:'CORP',context_id:'ctx:d05',
  actor_id:'person:owner',principal_id:'person:owner',role_id:'role:reader',
  grant_id:'grant:activity-read',realm_id:'realm:corporate',audience:'host:t3',
  resource:W,purpose:'activity.analysis',workspace_id:W,
  organization_id:'org:d05',scope_revision:1});
 const signedAccess={
  currentContext:async()=>owner,
  actionFor:operation=>{
   assert.ok(['t1.getWorkspace','t1.listObjects','t1.getObject','t1.listEventsSince']
    .includes(operation));return 'activity.read';
  },
  operationDigest:({operation,input,context})=>digest({operation,input,context}),
  authorize:request=>({schema:'IWXA_T3_AUTHORIZATION_DECISION/1',
   allowed:!revoked,outcome:revoked?'DENIED':'PERMITTED',evidenceOnly:true,
   requestDigest:digest(request),policyDigest:digest('pinned-domain-policy'),
   validUntil:new Date(Date.now()+60_000).toISOString(),
   statusObservedAt:new Date(Date.now()-1000).toISOString(),
   evaluatedAt:new Date().toISOString(),statusSequence:1,
   authorityPath:[{grantId:request.grantId}]}),
  verifyDecisionBinding:(request,decision)=>decision.requestDigest===digest(request),
 };
 const kernel={
  sessionInfo:{contract_version:'1.3.0',runtime_version:'0.3.6'},
  hasOperation:op=>['t1.getWorkspace','t1.listObjects','t1.getObject','t1.listEventsSince'].includes(op),
  async getWorkspace(){readCalls++;return{workspace_id:W,created_at:'2026-11-16T00:00:00Z'};},
  async listObjects(){readCalls++;return objects;},
  async getObject(ws,id){readCalls++;return{
   object:objects.find(o=>o.object_id===id),
   relations:{incoming:[],outgoing:relations.get(id)??[]},
  };},
  async listEventsSince(){readCalls++;return events;},
  async putObject(){writeCalls++;throw Error('D05_ANALYSIS_WRITE_FORBIDDEN');},
 };
 return{
  context:{kernel,currentWorkspace:{get:()=>current,
   subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}}},
  signedAccess,
  bindings:createCehovodD05T3Bindings(),
  readActivityFromWorkspaceContext:original.readActivityFromWorkspaceContext,
  subscribeOwnerInvalidation(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  objects,events,reads:()=>readCalls,writes:()=>writeCalls,
  revoke(){revoked=true;for(const fn of listeners)fn();},
 };
}
test('original signed D2 reads modelled D05 source and HOLDS reported transitions',async()=>{
 const h=fixture(),before=structuredClone({objects:h.objects,events:h.events});
 const value=await inspectSelectedT3Activity(h);
 assert.equal(value.status,'HOLD');assert.equal(value.structural_candidate,null);
 assert.ok(value.reason_codes.includes('T3_D2_UNVERIFIED_EVENT_STEP'));
 assert.ok(value.reason_codes.includes('T3_D2_RARE_OBJECT_ROUTE'));
 assert.ok(value.reason_codes.includes('T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED'));
 assert.equal(value.export_allowed,false);
 assert.equal(value.anonymity,'NOT_ESTABLISHED');
 assert.equal(value.iwxa_package,null);
 assert.ok(h.reads()>8);assert.equal(h.writes(),0);
 assert.deepEqual({objects:h.objects,events:h.events},before);
 for(const sensitive of [SECRET,W,'120','cehovod.','event:1','order:case001','org:d05'])
  assert.equal(JSON.stringify(value).includes(sensitive),false,sensitive);
});
test('revocation prevents any ORIGINAL Kernel call for D05 Activity',async()=>{
 const h=fixture();h.revoke();
 const port=createTrustedCehovodD05ReviewPort(h);
 const states=[],ui=createT3ReviewController({host:port,onUpdate:s=>states.push(s)});
 assert.equal((await ui.readSelected()).status,'HOLD');
 assert.equal(states.at(-1).code,'T3_AUTHORITATIVE_READ_REFUSED');
 assert.equal(h.reads(),0);assert.equal(h.writes(),0);
 ui.dispose();
});
test('unknown CehoVod event stays unmapped rather than invented business step',async()=>{
 const h=fixture();h.events.push({...h.events[0],
  event_id:'event:unknown',event_type:'cehovod.machine.telemetry.unverified'});
 const v=await inspectSelectedT3Activity(h);
 assert.equal(v.status,'HOLD');assert.equal(v.structural_candidate,null);
 assert.ok(v.reason_codes.includes('T3_D2_UNMAPPED_SOURCE_RECORD'));
 assert.equal(h.writes(),0);
 assert.equal(JSON.stringify(v).includes('telemetry'),false);
});
test('foreign object fails original D2 Workspace read boundary',async()=>{
 const h=fixture();h.objects[0].workspace_id='ws:foreign';
 await assert.rejects(inspectSelectedT3Activity(h),
  {code:'T3_AUTHORITATIVE_READ_REFUSED'});
 assert.equal(h.writes(),0);
});
