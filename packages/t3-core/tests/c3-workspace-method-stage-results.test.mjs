import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { applyWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { inspectWorkspaceMethodAgentPredecessorResults } from '../src/modules/base/owners/project-process-method-stage-input.mjs';
import { createTrustedWorkspaceMethodStageReader } from '../src/t3/workspace-method-stage-reader.mjs';

const ws='stage-result-workspace',projectId='research',time='2026-11-27T14:00:00Z';
const material={workspace_id:ws,object_id:'source',schema_id:'note',schema_version:'1.0.0',revision:1,data:{private:'source body'}};
const resultRef=Object.freeze({workspace_id:ws,object_id:'agent-atlas-result:fixture',schema_id:'iwxa.agent.accepted-result',revision:1});
const accepted={acceptanceKind:'HUMAN_ACCEPTED_DRAFT',readOnly:true,sourceObjectRef:resultRef,
  workRef:{projectId,workId:projectId+'.analyse',revision:'1'},taskId:'TSK-fixture',resultId:'RES-fixture',
  acceptedDigest:'a'.repeat(64),archiveSha256:'b'.repeat(64),privateSummary:'must not be projected'};
const resultObject={...resultRef,schema_version:'1.0.0',data:{taskId:accepted.taskId,resultId:accepted.resultId,
  acceptedDigest:accepted.acceptedDigest,workRef:accepted.workRef}};
const selection=[{stepId:'analyse',reference:resultRef}];
function draft(){return {templateId:'method',templateRevision:'1',projectId,name:'Research',objective:'Review original result',
  domainApplicability:['generic'],materials:[{object_id:'source',revision:1}],steps:[
    {id:'analyse',name:'Analyse',actor:'agent',instruction:'Analyse original',dependsOn:[],materialIds:['source']},
    {id:'review',name:'Review',actor:'human',instruction:'Review accepted result',dependsOn:['analyse'],materialIds:[]},
  ]};}
const clone=structuredClone;
async function setup(){
  const {owner}=await createProjectProcessSourceOwnerQualificationHarness(),value=draft();
  const result=await createWorkspaceMethodThroughSourceOwner({owner,workspaceId:ws,objects:[material],draft:value,
    recordIds:{project:'method-source',works:{[projectId+'.analyse']:'analyse-source',[projectId+'.review']:'review-source'}},knowledgeAt:time});
  const calls=[],nativeCalls=[];let selectedResult=clone(resultObject),native=clone(accepted);
  const readObject=async(workspaceId,id)=>{calls.push([workspaceId,id]);return workspaceId===ws?
    id===material.object_id?{object:clone(material)}:id===resultRef.object_id&&selectedResult?{object:clone(selectedResult)}:null:null;};
  const readAccepted=async ref=>{nativeCalls.push(ref);return clone(native);};
  return {owner,base:result.method,calls,nativeCalls,readObject,readAccepted,
    changeResult:x=>{selectedResult=x;},changeAccepted:x=>{native=x;}};
}
const args=(f,extra={})=>({owner:f.owner,readObject:f.readObject,readAccepted:f.readAccepted,workspaceId:ws,projectId,
  expected:f.base,stepId:'review',resultSelections:selection,...extra});
const code=expected=>error=>error?.code===expected;
test('original accepted Result readback is observed but cannot prove exact canonical input or reuse',async()=>{
  const f=await setup(),r=await inspectWorkspaceMethodAgentPredecessorResults(args(f));
  assert.equal(r.state,'ACCEPTED_RESULTS_OBSERVED_INPUT_BINDING_UNPROVEN');
  assert.equal(r.results[0].state,'ACCEPTED_WORK_NUMBER_MATCHED_INPUT_BINDING_UNPROVEN');
  assert.equal(r.results[0].accepted.resultId,accepted.resultId);assert.equal(r.results[0].accepted.acceptedDigest,accepted.acceptedDigest);
  assert.equal(r.exactInputBindingProven,false);assert.equal(r.resultReuseProven,false);assert.equal(r.executionAuthority,false);
  assert.equal(JSON.stringify(r).includes('must not be projected'),false);assert.equal(f.nativeCalls.length,2);
  assert.equal((await f.owner.audit()).length,3);
});
test('missing predecessor Result and root Work retain distinct non-execution states',async()=>{
  const f=await setup();
  const r=await inspectWorkspaceMethodAgentPredecessorResults(args(f,{resultSelections:[]}));
  assert.equal(r.state,'PREDECESSOR_RESULTS_REQUIRED');assert.equal(f.nativeCalls.length,0);
  const root=await inspectWorkspaceMethodAgentPredecessorResults(args(f,{stepId:'analyse',resultSelections:[]}));
  assert.equal(root.state,'NO_PREDECESSOR_RESULTS_REQUIRED');assert.equal(root.executionAuthority,false);
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{stepId:'analyse'})),code('METHOD_STAGE_RESULT_SELECTION_INVALID'));
});
test('stale or missing published Result cannot invoke original accepted owner',async()=>{
  const f=await setup();
  for(const object of [{...resultObject,revision:2},null,{...resultObject,deleted:true}]){
    f.changeResult(object);const r=await inspectWorkspaceMethodAgentPredecessorResults(args(f));
    assert.equal(r.state,'PREDECESSOR_RESULT_REVIEW_REQUIRED');assert.equal(r.results[0].accepted,null);
  }
  assert.equal(f.nativeCalls.length,0);
});
test('accepted Result from prior Work revision requires review, not implicit reuse',async()=>{
  const f=await setup(),d=draft();d.steps[0].instruction='New calculation scope';
  const next=(await applyWorkspaceMethodRevision({owner:f.owner,workspaceId:ws,projectId,expected:f.base,draft:d,objects:[material],
    operationId:'changed-work',knowledgeAt:'2026-11-27T14:01:00Z'})).method;
  const r=await inspectWorkspaceMethodAgentPredecessorResults(args(f,{expected:next}));
  assert.equal(r.state,'PREDECESSOR_RESULT_REVIEW_REQUIRED');assert.equal(r.results[0].state,'ACCEPTED_OLDER_OR_OTHER_WORK_REVISION');
  assert.equal(r.results[0].workRef.revision,2);assert.equal(r.results[0].accepted.workRef.revision,'1');
  assert.equal(r.resultReuseProven,false);
});
test('wrong published object, foreign selection, forged owner evidence or another Work is rejected',async()=>{
  const f=await setup();
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{resultSelections:[{stepId:'analyse',reference:{...resultRef,workspace_id:'foreign'}}]})),code('METHOD_STAGE_RESULT_SELECTION_INVALID'));
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{resultSelections:[...selection,...selection]})),code('METHOD_STAGE_RESULT_SELECTION_INVALID'));
  f.changeAccepted({...accepted,readOnly:false});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_OWNER_READBACK_INVALID'));
  f.changeAccepted({...accepted,resultId:'RES-other'});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_OWNER_READBACK_INVALID'));
  const other={...accepted,workRef:{...accepted.workRef,workId:projectId+'.other'}};
  f.changeAccepted(other);f.changeResult({...resultObject,data:{...resultObject.data,workRef:other.workRef}});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_WORK_MISMATCH'));
  f.changeResult({...resultObject,workspace_id:'foreign'});
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f)),code('METHOD_STAGE_RESULT_IDENTITY_MISMATCH'));
});
test('accepted owner or exact material changed during observation cannot confirm result',async()=>{
  const f=await setup();let calls=0;
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{readAccepted:async()=>({
    ...accepted,archiveSha256:(++calls===1?'b':'c').repeat(64)})})),code('METHOD_STAGE_RESULT_CHANGED'));
  let changed=false;
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{
    readAccepted:async()=>{changed=true;return accepted;},readObject:async(w,id)=>{
      const r=await f.readObject(w,id);return changed&&id==='source'?{object:{...r.object,revision:2}}:r;
    }})),code('METHOD_STAGE_RESULT_BASIS_CHANGED'));
});
function trusted(f){
  const workspace={workspace_id:ws,deleted_at:null};
  let chosen=workspace,active=true,allowed=true;const listeners=new Set();
  const currentWorkspace={get:()=>chosen,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
  const context={kind:'PERSONAL',context_id:'ctx:work',actor_id:'person:owner',principal_id:'person:owner',
    role_id:'role:owner',grant_id:'grant:owner',realm_id:'realm:personal',audience:'host:t3',resource:ws,
    purpose:'work',workspace_id:ws,organization_id:null,scope_revision:1};
  const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
  const access={currentContext:()=>context,actionFor:()=> 'object.read',operationDigest:sha,
    authorize:request=>({schema:'IWXA_T3_AUTHORIZATION_DECISION/1',allowed,outcome:allowed?'PERMITTED':'DENIED',
      evidenceOnly:true,requestDigest:sha(request),policyDigest:sha('policy'),statusSequence:1,
      validUntil:new Date(Date.now()+60000).toISOString(),statusObservedAt:new Date().toISOString(),
      evaluatedAt:new Date().toISOString(),authorityPath:[{grantId:context.grant_id}]}),
    verifyDecisionBinding:(request,decision)=>decision.requestDigest===sha(request)};
  const kernel={sessionInfo:{contract_version:'1.3.0'},hasOperation:op=>['t1.getWorkspace','t1.getObject'].includes(op),
    getWorkspace:async workspaceId=>workspaceId===ws?workspace:null,
    getObject:async(...a)=>{const row=await f.readObject(...a);return row?{...row,relations:{incoming:[],outgoing:[]}}:null;}};
  let hook=null;
  const reader=createTrustedWorkspaceMethodStageReader({kernel,accessForRead:async()=>access,currentWorkspace,sourceOwner:f.owner,
    originalAgentResultOwner:{readAccepted:async ref=>{if(hook)await hook();return f.readAccepted(ref);}},isHostActive:()=>active});
  const changeSelection=()=>{chosen={...workspace};for(const notify of listeners)notify();};
  return {reader,context,deny:()=>{allowed=false;},changeSelection,dispose:()=>{active=false;},hook:fn=>{hook=fn;}};
}
const hostInput=f=>({workspaceId:ws,projectId,stepId:'review',expected:f.base,resultSelections:selection});
test('trusted stage reader composes actual original signed binding and scoped original owner',async()=>{
  const f=await setup(),h=trusted(f);
  const r=await h.reader.inspect(hostInput(f));
  assert.equal(r.state,'ACCEPTED_RESULTS_OBSERVED_INPUT_BINDING_UNPROVEN');
  assert.equal(f.nativeCalls.length,2);
  h.deny();await assert.rejects(h.reader.inspect(hostInput(f)),code('T3_ACCESS_NOT_PERMITTED'));
  assert.equal(f.nativeCalls.length,2);
});
test('trusted stage reader rejects Workspace or full signed context changes during native owner read',async()=>{
  for(const change of ['selection','context','dispose']){
    const f=await setup(),h=trusted(f);
    h.hook(()=>{if(change==='selection')h.changeSelection();else if(change==='dispose')h.dispose();else h.context.purpose='different';});
    await assert.rejects(h.reader.inspect(hostInput(f)),e=>['T3_METHOD_STAGE_WORKSPACE_CHANGED','T3_METHOD_STAGE_SIGNED_CONTEXT_CHANGED'].includes(e.code));
  }
});

test('material changed during second native Result readback cannot pass final stage evidence',async()=>{
  const f=await setup();let calls=0;
  await assert.rejects(inspectWorkspaceMethodAgentPredecessorResults(args(f,{
    readAccepted:async()=>{calls++;return accepted;},
    readObject:async(w,id)=>{
      const r=await f.readObject(w,id);return calls>=2&&id==='source'?{object:{...r.object,revision:2}}:r;
    }})),code('METHOD_STAGE_RESULT_BASIS_CHANGED'));
});
test('original D1 permission revocation during accepted owner read prevents report',async()=>{
  const f=await setup(),h=trusted(f);
  h.hook(()=>{h.deny();});
  await assert.rejects(h.reader.inspect(hostInput(f)),code('T3_ACCESS_NOT_PERMITTED'));
});
