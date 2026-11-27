import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createT4OriginalFreshWorkspaceBaseline,createT4OriginalNetworkBaselineAdmissionPort,readT4OriginalFreshWorkspaceBaselineSelection} from '../src/network/original-network-baseline-admission.mjs';

import {digestT4OriginalEventRecord} from '../src/network/original-event-window.mjs';

const H=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const clone=x=>structuredClone(x);
const error=code=>e=>e?.code===code;
const identity={technicalWorkspaceId:'workspace:technical',sourceWorkspaceId:'workspace:business',
  originalWriteOwnerRef:'owner:original',sourceNodeRef:'node:source',recipientNodeRef:'node:recipient',
  scopeRef:'scope:original',ownerEpoch:2};
const input={originalBaselineRef:'event:materialized',originalBaselineDigest:H('original materialization'),
  sourceCursor:{schema:'IWXA_T4_ORIGINAL_EVENT_CURSOR_V1',workspaceId:identity.sourceWorkspaceId,
    originalWriteOwnerRef:identity.originalWriteOwnerRef,lastEventId:'event:source:1',
    sourcePrefixDigest:H('prefix'),seenEventCount:1,originalPermissionProof:false}};
function fixture(){
  const objects=new Map(),events=[];let puts=0,consents=0,allowed=true,witness=true,read=true,write=true,
    lost=false,session='host:first',active=true,network=true;
  const kernel={
    hasOperation:op=>['t1.getObject','t1.putObject','t1.listEventsSince'].includes(op),
    async getObject(w,id){assert.equal(w,identity.technicalWorkspaceId);return clone(objects.get(id)??null)},
    async listEventsSince(w){assert.equal(w,identity.technicalWorkspaceId);return clone(events)},
    async putObject(o){
      puts++;assert.equal(o.workspace_id,identity.technicalWorkspaceId);
      assert.equal(o.base_revision,0);assert.equal(objects.has(o.object_id),false);
      assert.equal(o.schema_id,'iwxa.t4.network.record');
      const object={...clone(o),revision:1,deleted:false};delete object.event;delete object.base_revision;
      const event={...clone(o.event),event_id:'event:technical:'+puts,workspace_id:o.workspace_id,
        object_id:o.object_id,revision:1};objects.set(o.object_id,{object});events.push(event);
      if(lost){lost=false;throw Object.assign(Error('lost response'),{code:'ACK_LOST'})}
      return {object,event};
    }
  };
  const port=(role='SOURCE',overrides={})=>createT4OriginalNetworkBaselineAdmissionPort({
    ...identity,role,originalKernel:kernel,getMode:()=>network?'T4_NETWORK':'LOCAL_T3',
    readOriginalHostContext:async()=>({workspaceId:identity.technicalWorkspaceId,
      originalWriteOwnerRef:identity.originalWriteOwnerRef,scopeRef:identity.scopeRef,
      nodeRef:role==='SOURCE'?identity.sourceNodeRef:identity.recipientNodeRef,hostSessionRef:session}),
    authorizeOriginalTechnicalRead:async()=>read,authorizeOriginalTechnicalWrite:async()=>write,
    authorizeOriginalBaselineAdmission:async p=>{consents++;assert.equal(p.networkMetadataIsNotAdmission,true);return allowed},
    verifyOriginalBaselineEvidence:async p=>witness&&p.baseline.originalBaselineRef===input.originalBaselineRef&&
      p.baseline.originalBaselineDigest===input.originalBaselineDigest,...overrides});
  return {objects,events,port,kernel,get puts(){return puts},get consents(){return consents},
    deny(){allowed=false},revokeWitness(){witness=false},revokeRead(){read=false},revokeWrite(){write=false},
    lose(){lost=true},restart(){session='host:cold'},stop(){active=false},local(){network=false},isActive:()=>active};
}
test('K13 original baseline is immutable role-scoped Object/Event, never an ACK',async()=>{
  const f=fixture(),p=f.port();
  assert.equal(await p.readOriginalAdmittedBaseline(),null);
  const result=await p.admitOriginalBaseline(input);
  assert.equal(result.state,'ADMITTED');assert.equal(result.sourceCursorAdvanced,false);
  assert.equal(result.originalSubjectMutationInvoked,false);
  assert.equal(result.baseline.schema,'IWXA_T4_ORIGINAL_SOURCE_BASELINE_V1');
  f.restart();assert.deepEqual(await f.port().readOriginalAdmittedBaseline(),result.baseline);
  assert.equal((await f.port().admitOriginalBaseline(input)).state,'ALREADY_ADMITTED');
  assert.equal(f.puts,1);assert.equal(f.consents,1);
  const other=f.port('RECIPIENT');assert.notEqual(other.checkpointRef,p.checkpointRef);
  assert.equal(await other.readOriginalAdmittedBaseline(),null);
  assert.equal((await other.admitOriginalBaseline(input)).baseline.schema,'IWXA_T4_ORIGINAL_RECIPIENT_BASELINE_V1');
  assert.equal(f.puts,2);
  assert.equal(await f.port('SOURCE',{ownerEpoch:3}).readOriginalAdmittedBaseline(),null);
});
test('K13 consent, evidence, technical write and local network mode are separate requirements',async()=>{
  const f=fixture();f.deny();
  await assert.rejects(f.port().admitOriginalBaseline(input),error('BASELINE_ADMISSION_ORIGINAL_CONSENT_DENIED'));
  assert.equal(f.puts,0);
  const g=fixture();g.revokeWitness();
  await assert.rejects(g.port().admitOriginalBaseline(input),error('BASELINE_ADMISSION_ORIGINAL_WITNESS_DENIED'));
  assert.equal(g.puts,0);assert.equal(g.consents,0);
  const h=fixture();h.revokeWrite();
  await assert.rejects(h.port().admitOriginalBaseline(input),error('BASELINE_ADMISSION_ORIGINAL_ACCESS_DENIED'));
  assert.equal(h.puts,0);
  const l=fixture();l.local();
  await assert.rejects(l.port().admitOriginalBaseline(input),error('BASELINE_ADMISSION_NETWORK_MODE_OFF'));
  assert.equal(l.puts,0);
});
test('K13 lost commit response recovers from original Event and cannot change admitted cursor',async()=>{
  const f=fixture();f.lose();
  await assert.rejects(f.port().admitOriginalBaseline(input),e=>e?.code==='BASELINE_ADMISSION_ORIGINAL_WRITE_OUTCOME_UNKNOWN'&&
    e.details.automaticRetryAllowed===false);
  f.restart();assert.deepEqual((await f.port().readOriginalAdmittedBaseline()).sourceCursor,input.sourceCursor);
  assert.equal((await f.port().admitOriginalBaseline(input)).state,'ALREADY_ADMITTED');
  await assert.rejects(f.port().admitOriginalBaseline({...input,sourceCursor:{...input.sourceCursor,seenEventCount:2}}),
    error('BASELINE_ADMISSION_ALREADY_BOUND'));
  assert.equal(f.puts,1);
});
test('K13 original evidence revocation, changed Event and lost Object block cold admission',async()=>{
  const f=fixture();await f.port().admitOriginalBaseline(input);f.restart();f.revokeWitness();
  await assert.rejects(f.port().readOriginalAdmittedBaseline(),error('BASELINE_ADMISSION_ORIGINAL_WITNESS_DENIED'));
  const g=fixture();await g.port().admitOriginalBaseline(input);g.events[0].payload.recordDigest=H('tampered');
  await assert.rejects(g.port().readOriginalAdmittedBaseline(),error('BASELINE_ADMISSION_ORIGINAL_RECORD_INVALID'));
  const h=fixture();await h.port().admitOriginalBaseline(input);h.objects.clear();
  await assert.rejects(h.port().admitOriginalBaseline(input),error('BASELINE_ADMISSION_ORIGINAL_RECORD_MISSING'));
  assert.equal(h.puts,1);
});
test('K13 admitted baseline must match current Host context and original scope',async()=>{
  const f=fixture(),p=f.port();await p.admitOriginalBaseline(input);
  await assert.rejects(p.readOriginalAdmittedBaseline({...identity,originalHostSessionRef:'host:foreign',originalBaselineAdmissionRequired:true}),
    error('BASELINE_ADMISSION_ORIGINAL_SCOPE_MISMATCH'));
  await assert.rejects(p.admitOriginalBaseline({...input,sourceCursor:{...input.sourceCursor,workspaceId:'workspace:foreign'}}),
    error('BASELINE_ADMISSION_ORIGINAL_WITNESS_INVALID'));
  const old=p.forOriginalHostLifetime(f.isActive);f.stop();
  await assert.rejects(old.readOriginalAdmittedBaseline(),error('ORIGINAL_HOST_LIFETIME_ENDED'));
  f.restart();f.revokeRead();
  await assert.rejects(f.port().readOriginalAdmittedBaseline(),error('BASELINE_ADMISSION_ORIGINAL_ACCESS_DENIED'));
  assert.equal(f.puts,1);
});

test('K125 baseline exact technical history uses original indexed reads on cold admission and refuses an orphan Event',async()=>{
  const f=fixture(),kernel=f.kernel,calls=[];
  kernel.hasOperation=op=>['t1.getObject','t1.putObject','t1.listEventsSince','t1.listEventObjectCommitWindow'].includes(op);
  kernel.listEventsSince=async()=>{throw Error('legacy forbidden');};
  kernel.listEventObjectCommitWindow=async(ws,id,after,limit)=>{
    calls.push([ws,id,after,limit]);const entries=f.events.filter(e=>e.object_id===id).map(event=>({event:clone(event),legacy_history:false}));
    return {entries,next_after_event_id:entries.at(-1)?.event.event_id??after,has_more:false,
      order:'LOCAL_TRANSACTION_COMMIT_ORDER',legacy_history_causal_proven:false};
  };
  const opts={enableOriginalTechnicalObjectHistory:true},port=f.port('SOURCE',opts);
  assert.equal((await port.admitOriginalBaseline(input)).state,'ADMITTED');
  f.restart();assert.deepEqual((await f.port('SOURCE',opts).readOriginalAdmittedBaseline()).sourceCursor,input.sourceCursor);
  assert.equal(f.puts,1);
  assert.equal(calls.every(c=>c[1]===port.checkpointRef),true);
  f.objects.clear();
  await assert.rejects(f.port('SOURCE',opts).readOriginalAdmittedBaseline(),error('BASELINE_ADMISSION_ORIGINAL_RECORD_MISSING'));
});
test('K125 exact baseline does not use a legacy route on original authority denial',async()=>{
  const f=fixture(),kernel=f.kernel;
  kernel.hasOperation=()=>true;kernel.listEventObjectCommitWindow=async()=>{throw Error('must not read');};
  await assert.rejects(f.port('RECIPIENT',{enableOriginalTechnicalObjectHistory:true,
    authorizeOriginalTechnicalRead:async p=>p.operation!=='t1.listEventObjectCommitWindow'}).admitOriginalBaseline(input),
    error('BASELINE_ADMISSION_ORIGINAL_ACCESS_DENIED'));
  assert.equal(f.puts,0);
});


const freshEvent=()=>({event_id:'event:original:creation',event_type:'workspace.created',
  workspace_id:identity.sourceWorkspaceId,occurred_at:'2026-11-27T12:00:00.000Z',
  service_id:'iwxa.admin-center.workspace',payload:{profile:'generic',capabilities:[],read_only:false}});
function freshFixture(role='SOURCE'){
  const creation=freshEvent(),events=[creation],objects=[],assets=[],reads=[];
  const selection={confirmed:true,eventId:creation.event_id,eventDigest:digestT4OriginalEventRecord(creation,identity.sourceWorkspaceId)};
  let active=true,allowed=true,mode='T4_NETWORK',afterAssets=null;
  const kernel={hasOperation:op=>['t1.listEventsSince','t1.listObjects','t1.listAssets'].includes(op),
    async listEventsSince(ws){assert.equal(ws,identity.sourceWorkspaceId);reads.push('events');return clone(events)},
    async listObjects(q){assert.deepEqual(q,{workspace_id:identity.sourceWorkspaceId,include_deleted:true});reads.push('objects');return clone(objects)},
    async listAssets(q){assert.deepEqual(q,{workspace_id:identity.sourceWorkspaceId});reads.push('assets');const out=clone(assets);afterAssets?.();return out}};
  const create=()=>createT4OriginalFreshWorkspaceBaseline({selection,role,workspaceId:identity.sourceWorkspaceId,
    originalWriteOwnerRef:identity.originalWriteOwnerRef,originalKernel:kernel,getMode:()=>mode,
    authorizeOriginalRead:async p=>{assert.equal(p.workspaceId,identity.sourceWorkspaceId);return allowed;},
    requireCurrent:()=>{if(!active)throw Error('HOST_CLOSED')}});
  const proof=(baseline,admit)=>({...identity,role,operation:'t4.network.original.baseline.'+(admit?'admit':'verify'),
    baseline,originalMaterializationWitnessRequired:true,networkMetadataIsNotAdmission:true});
  return {creation,events,objects,assets,reads,selection,create,proof,deny:()=>allowed=false,
    disable:()=>mode='LOCAL_T3',close:()=>active=false,afterAssets:f=>afterAssets=f};
}
test('first-use copies with the SAME original creation Event derive the identical source cursor; cold read does not require emptiness',async()=>{
  const s=freshFixture(),r=freshFixture('RECIPIENT');
  const source=s.create(),recipient=r.create();
  const input=await source.readOriginalBaselineAdmissionInput();
  assert.deepEqual(input,await recipient.readOriginalBaselineAdmissionInput());
  assert.equal(input.sourceCursor.lastEventId,s.creation.event_id);
  assert.equal(input.sourceCursor.seenEventCount,1);
  assert.equal(await source.verifyOriginalBaselineEvidence(s.proof(input,true)),true);
  assert.equal(await source.authorizeOriginalBaselineAdmission(s.proof(input,true)),true);
  s.events.push({...s.creation,event_id:'event:later',occurred_at:'2026-11-27T12:00:01.000Z',
    event_type:'business.created',object_id:'object:later',revision:1,payload:{title:'Later'}});
  s.objects.push({object_id:'object:later'});
  assert.equal(await s.create().verifyOriginalBaselineEvidence(s.proof(input,false)),true);
  await assert.rejects(s.create().readOriginalBaselineAdmissionInput(),{code:'BASELINE_FRESH_WORKSPACE_NOT_EMPTY'});
  assert.equal(await recipient.verifyOriginalBaselineEvidence(r.proof({...input,sourceCursor:{...input.sourceCursor,seenEventCount:2}},false)),false);
});
test('different creation Event, changed bytes, pre-existing data and mid-read mutation are not an admitted fresh baseline',async()=>{
  for(const [change,code] of [
    [f=>f.events[0].event_id='event:different','BASELINE_FRESH_ORIGINAL_CREATION_EVENT_MISMATCH'],
    [f=>f.events[0].payload.capabilities.push('different'),'BASELINE_FRESH_ORIGINAL_CREATION_EVENT_MISMATCH'],
    [f=>f.objects.push({object_id:'hidden-tombstone',deleted:true}),'BASELINE_FRESH_WORKSPACE_NOT_EMPTY'],
    [f=>f.assets.push({asset_id:'asset:existing'}),'BASELINE_FRESH_WORKSPACE_NOT_EMPTY'],
    [f=>f.afterAssets(()=>f.events.push({...f.creation,event_id:'event:second',occurred_at:'2026-11-27T12:00:01.000Z'})),'BASELINE_FRESH_WORKSPACE_CHANGED']]){
    const f=freshFixture(),port=f.create();change(f);
    await assert.rejects(port.readOriginalBaselineAdmissionInput(),{code});
  }
});
test('explicit original read permission and native lifetime remain required for first-use baseline',async()=>{
  const f=freshFixture(),port=f.create();f.deny();
  await assert.rejects(port.readOriginalBaselineAdmissionInput(),e=>['ORIGINAL_T3_EVENT_READ_NOT_AUTHORIZED','BASELINE_ADMISSION_ORIGINAL_ACCESS_DENIED'].includes(e.code));
  assert.deepEqual(f.reads,[]);
  const g=freshFixture(),p=g.create();g.disable();
  await assert.rejects(p.readOriginalBaselineAdmissionInput(),{code:'BASELINE_ADMISSION_NETWORK_MODE_OFF'});
  const h=freshFixture(),q=h.create();h.close();await assert.rejects(q.readOriginalBaselineAdmissionInput(),/HOST_CLOSED/);
});


test('preparation returns a candidate from original creation history, never confirmation',()=>{
  const f=freshFixture();
  assert.deepEqual(readT4OriginalFreshWorkspaceBaselineSelection({workspaceId:identity.sourceWorkspaceId,originalEvents:f.events}),
    {...f.selection,confirmed:false});
  assert.throws(()=>readT4OriginalFreshWorkspaceBaselineSelection({workspaceId:identity.sourceWorkspaceId,originalEvents:[]}),
    {code:'BASELINE_FRESH_WORKSPACE_NOT_EMPTY'});
  assert.throws(()=>readT4OriginalFreshWorkspaceBaselineSelection({workspaceId:identity.sourceWorkspaceId,
    originalEvents:[{...f.creation,event_type:'business.created'}]}),{code:'BASELINE_FRESH_ORIGINAL_CREATION_EVENT_MISMATCH'});
});


test('signed same-Workspace merge roundtrip admits the exact shared two-creation prefix in both roles',async()=>{
  const s=freshFixture(),r=freshFixture('RECIPIENT');
  const second={...clone(s.creation),event_id:'event:local:creation',service_id:'iwxa.personal-agent.workspace',
    occurred_at:'2026-11-27T12:00:01.000Z'};
  for(const f of [s,r]){
    f.events.push(clone(second));
    const candidate=readT4OriginalFreshWorkspaceBaselineSelection({workspaceId:identity.sourceWorkspaceId,originalEvents:f.events});
    assert.equal(candidate.confirmed,false);assert.equal(candidate.creationAnchors.length,2);
    Object.assign(f.selection,candidate,{confirmed:true});
  }
  const input=await s.create().readOriginalBaselineAdmissionInput();
  assert.deepEqual(await r.create().readOriginalBaselineAdmissionInput(),input);
  assert.equal(input.sourceCursor.seenEventCount,2);assert.equal(input.sourceCursor.lastEventId,second.event_id);
  const later={...clone(second),event_id:'event:later',event_type:'business.created',
    occurred_at:'2026-11-27T12:00:02.000Z',object_id:'object:later',revision:1};
  r.events.push(later);r.objects.push({object_id:later.object_id});
  assert.equal(await r.create().verifyOriginalBaselineEvidence(r.proof(input,false)),true);
  await assert.rejects(r.create().readOriginalBaselineAdmissionInput(),{code:'BASELINE_FRESH_WORKSPACE_NOT_EMPTY'});
  for(const change of [
    f=>f.events.reverse(),f=>f.events.shift(),f=>{f.events[0].payload.capabilities.push('different');},
    f=>{f.events[0].event_type='business.created';}
  ]){
    const f=freshFixture('RECIPIENT');f.events.push(clone(second));Object.assign(f.selection,s.selection);
    change(f);
    await assert.rejects(f.create().readOriginalBaselineAdmissionInput(),{code:'BASELINE_FRESH_ORIGINAL_CREATION_EVENT_MISMATCH'});
  }
  const f=freshFixture();f.events.push(clone(second));Object.assign(f.selection,s.selection);
  f.afterAssets(()=>f.events.push({...clone(second),event_id:'event:third'}));
  await assert.rejects(f.create().readOriginalBaselineAdmissionInput(),{code:'BASELINE_FRESH_WORKSPACE_CHANGED'});
  assert.throws(()=>readT4OriginalFreshWorkspaceBaselineSelection({workspaceId:identity.sourceWorkspaceId,originalEvents:f.events}),
    {code:'BASELINE_FRESH_WORKSPACE_NOT_EMPTY'});
});
