import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectProcessSourceOwnerQualificationHarness } from '../src/modules/base/owners/project-process-source-owner.mjs';
import { createWorkspaceMethodThroughSourceOwner } from '../src/modules/base/owners/project-process-method-materialization.mjs';
import { applyWorkspaceMethodRevision } from '../src/modules/base/owners/project-process-method-revision.mjs';
import { readWorkspaceMethodStageInputBasis,readWorkspaceMethodInputOverview,inspectWorkspaceMethodMaterialEvidence } from '../src/modules/base/owners/project-process-method-stage-input.mjs';

const workspaceId='stage-scope',projectId='research',time='2026-11-27T13:00:00Z',nextTime='2026-11-27T13:01:00Z';
const objects=['source','model','unused'].map((object_id,i)=>({workspace_id:workspaceId,object_id,revision:i+1,
  schema_id:'fixture.material',schema_version:'1.0.0',data:{private:'material body not part of the input basis'}}));
function draft(){return {templateId:'method',templateRevision:'1',projectId,name:'Research',objective:'Compare independent results',
  domainApplicability:['generic'],materials:objects.map(({object_id,revision})=>({object_id,revision})),steps:[
    {id:'review',name:'Review',actor:'human',instruction:'Review both',dependsOn:['analyse','compute'],materialIds:[]},
    {id:'prepare',name:'Prepare',actor:'human',instruction:'Prepare',dependsOn:[],materialIds:['source']},
    {id:'analyse',name:'Analyse',actor:'agent',instruction:'Analyse',dependsOn:['prepare'],materialIds:['source']},
    {id:'compute',name:'Compute',actor:'program',instruction:'Compute',dependsOn:['prepare'],materialIds:['model']},
  ]};}
async function setup(){
  const {owner}=await createProjectProcessSourceOwnerQualificationHarness();
  const value=draft(),recordIds={project:'stage-project',works:Object.fromEntries(value.steps.map(s=>[projectId+'.'+s.id,'stage-'+s.id]))};
  const result=await createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft:value,recordIds,knowledgeAt:time});
  const calls=[];
  const readObject=async(ws,id)=>{calls.push([ws,id]);const object=objects.find(o=>o.workspace_id===ws&&o.object_id===id);return object?{object:{...object}}:null;};
  return {owner,base:result.method,readObject,calls};
}
const read=(f,stepId,extra={})=>readWorkspaceMethodStageInputBasis({owner:f.owner,workspaceId,projectId,expected:f.base,
  readObject:f.readObject,stepId,...extra});
const code=expected=>error=>error?.code===expected;
async function edit(f,stepId){
  const value=draft();value.steps.find(s=>s.id===stepId).instruction='Changed instruction';
  return (await applyWorkspaceMethodRevision({owner:f.owner,workspaceId,projectId,expected:f.base,draft:value,objects,
    operationId:'stage-edit',knowledgeAt:nextTime})).method;
}
test('stage basis addresses only its exact transitive material closure and no payloads',async()=>{
  const f=await setup(),p=await read(f,'compute');
  assert.equal(p.state,'INPUT_REFERENCES_VERIFIED');assert.deepEqual(p.basis.prerequisiteClosure.map(r=>r.stepId),['prepare','compute']);
  assert.deepEqual(p.basis.materialRefs.map(r=>r.object_id),['model','source']);
  assert.deepEqual(f.calls.map(c=>c[1]),['model','source','model','source']);
  assert.deepEqual(p.predecessors.map(r=>r.stepId),['prepare']);assert.equal(p.predecessors[0].acceptedResultRef,null);
  assert.equal(p.requiredResultOwnerReadback,true);assert.match(p.inputBasisDigest,/^[a-f0-9]{64}$/);
  assert.equal(p.resultReuseProven,false);assert.equal(p.executionAuthority,false);assert.equal(p.writeAuthorized,false);
  assert.equal(JSON.stringify(p).includes('material body'),false);
  assert.equal((await f.owner.audit()).length,5);
});
test('selective source edit leaves independent stage basis identical and changes downstream input basis',async()=>{
  const f=await setup(),compute=await read(f,'compute'),review=await read(f,'review');
  const next=await edit(f,'analyse');
  const afterCompute=await read(f,'compute',{expected:next}),afterReview=await read(f,'review',{expected:next});
  assert.equal(afterCompute.inputBasisDigest,compute.inputBasisDigest);
  assert.notEqual(afterReview.inputBasisDigest,review.inputBasisDigest);
  assert.deepEqual(afterReview.basis.prerequisiteClosure.map(r=>r.stepId),['prepare','analyse','compute','review']);
  assert.equal(afterCompute.resultReuseProven,false);
  await assert.rejects(read(f,'review'),code('METHOD_STAGE_SOURCE_CHANGED'));
  assert.equal((await f.owner.audit()).length,7);
});
test('changed or unavailable declared inputs block stage basis but unrelated materials do not',async()=>{
  const f=await setup();
  const stale=async(ws,id)=>{
    const result=await f.readObject(ws,id);
    if(id==='model')return {object:{...result.object,revision:9}};
    return result;
  };
  const compute=await read(f,'compute',{readObject:stale});
  assert.equal(compute.state,'MATERIAL_REVIEW_REQUIRED');assert.equal(compute.inputBasisDigest,null);
  assert.equal(compute.materials.find(r=>r.object_id==='model').state,'CHANGED');
  const prepare=await read(f,'prepare',{readObject:stale});
  assert.equal(prepare.state,'INPUT_REFERENCES_VERIFIED');assert.equal(prepare.requiredResultOwnerReadback,false);
  for(const readObject of [async(ws,id)=>id==='model'?null:f.readObject(ws,id),async(ws,id)=>{
    const r=await f.readObject(ws,id);return id==='model'?{object:{...r.object,deleted_at:time}}:r;
  }]){
    const unavailable=await read(f,'compute',{readObject});assert.equal(unavailable.inputBasisDigest,null);
    assert.equal(unavailable.materials.find(r=>r.object_id==='model').state,'UNAVAILABLE');
  }
  assert.equal((await f.owner.audit()).length,5);
});
test('wrong scope/schema or denied original read cannot be interpreted as admitted input',async()=>{
  const f=await setup();
  for(const patch of [{workspace_id:'foreign'},{object_id:'foreign'},{schema_id:'iwxa.workspace.internal.saved-view'},{schema_version:''}]){
    await assert.rejects(read(f,'prepare',{readObject:async(ws,id)=>({object:{...(await f.readObject(ws,id)).object,...patch}})}),
      code('METHOD_STAGE_MATERIAL_IDENTITY_MISMATCH'));
  }
  await assert.rejects(read(f,'prepare',{readObject:async()=>{throw Object.assign(new Error('denied'),{code:'PERMISSION_DENIED'});}}),code('PERMISSION_DENIED'));
  assert.equal((await f.owner.audit()).length,5);
});
test('stage input read rejects material changed between two original addressed observations',async()=>{
  const f=await setup();let n=0;
  await assert.rejects(read(f,'prepare',{readObject:async(ws,id)=>{
    const row=await f.readObject(ws,id);return {object:{...row.object,revision:++n}};
  }}),code('METHOD_STAGE_MATERIAL_CHANGED'));
});
test('method edit while material read is in progress invalidates selected input basis',async()=>{
  const f=await setup();let release,entered;const gate=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{entered=resolve;});
  const pending=read(f,'review',{readObject:async(ws,id)=>{entered();await gate;return f.readObject(ws,id);}});
  await started;await edit(f,'analyse');release();
  await assert.rejects(pending,code('METHOD_STAGE_SOURCE_CHANGED'));
});
test('exact stage source selection is captured before original async reads',async()=>{
  const f=await setup();let release;const gate=new Promise(resolve=>{release=resolve;});let first=true;
  const port={load:async(...args)=>{if(first){first=false;await gate;}return f.owner.load(...args);}};
  const mutable={projectRef:{...f.base.projectRef},workRefs:f.base.workRefs.map(r=>({...r}))};
  const pending=read(f,'prepare',{owner:port,expected:mutable});
  mutable.projectRef.recordId='substitution';mutable.workRefs[0].recordId='substitution';release();
  const value=await pending;assert.equal(value.state,'INPUT_REFERENCES_VERIFIED');
  assert.deepEqual(value.basis.projectRef,f.base.projectRef);
  await assert.rejects(read(f,'nonexistent'),code('METHOD_STAGE_UNKNOWN'));
  await assert.rejects(read(f,'prepare',{expected:{...f.base,workRefs:f.base.workRefs.slice(1)}}),code('METHOD_STAGE_SOURCE_CHANGED'));
  assert.equal((await f.owner.audit()).length,5);
});

test('selected closure does not load unrelated heads or require their old revisions to remain current',async()=>{
  const f=await setup(),before=await read(f,'compute');
  await edit(f,'analyse');
  const loads=[];
  const owner={load:async(kind,ws,id)=>{loads.push([kind,id]);return f.owner.load(kind,ws,id);}};
  const value=await read(f,'compute',{owner});
  assert.equal(value.inputBasisDigest,before.inputBasisDigest);
  assert.equal(value.selectedClosureVerified,true);assert.equal(value.completeMethodCurrentVerified,false);
  assert.equal(value.unrelatedHeadsNotRead,true);assert.equal(value.executionAuthority,false);
  assert.equal(loads.length,9);
  assert.deepEqual([...new Set(loads.map(row=>row[1]))].sort(),[projectId,projectId+'.compute',projectId+'.prepare'].sort());
  await assert.rejects(read(f,'review'),code('METHOD_STAGE_SOURCE_CHANGED'));
});
test('selected closure requires exact canonical prerequisite links and refuses a forged cycle',async()=>{
  const f=await setup();
  const broken={load:async(kind,ws,id)=>{
    const r=await f.owner.load(kind,ws,id);
    if(kind!=='work'||id!==projectId+'.compute')return r;
    return {...r,refs:{...r.refs,canonicalHeads:{...r.refs.canonicalHeads,
      ['predecessor:'+projectId+'.prepare']:{...r.refs.canonicalHeads['predecessor:'+projectId+'.prepare'],recordId:'forged'}}}};
  }};
  await assert.rejects(read(f,'compute',{owner:broken}),e=>e.code==='METHOD_SOURCE_REFERENCE_CHANGED');
  const cycle={load:async(kind,ws,id)=>{
    const r=await f.owner.load(kind,ws,id);
    if(kind!=='work'||id!==projectId+'.prepare')return r;
    return {...r,value:{...r.value,dependencies:[{predecessorWorkId:projectId+'.compute',relation:'finish-to-start',lagNanoseconds:0n}]}};
  }};
  await assert.rejects(read(f,'compute',{owner:cycle}),code('METHOD_DEPENDENCY_CYCLE'));
});
test('selected closure rejects a complete-looking selection containing duplicate canonical revision IDs',async()=>{
  const f=await setup();
  const workRefs=f.base.workRefs.map(row=>({...row}));
  workRefs[1].recordId=workRefs[0].recordId;
  await assert.rejects(read(f,'compute',{expected:{...f.base,workRefs}}),code('METHOD_STAGE_SELECTION_INVALID'));
});


const overview=(f,extra={})=>readWorkspaceMethodInputOverview({owner:f.owner,workspaceId,projectId,
  expected:f.base,readObject:f.readObject,...extra});
test('complete method overview shares original stage digests with one bounded set of source and material observations',async()=>{
  const f=await setup(),loads=[];
  const owner={load:async(kind,ws,id)=>{loads.push([kind,id]);return f.owner.load(kind,ws,id);}};
  const r=await overview(f,{owner});
  assert.deepEqual(r.stages.map(s=>s.stepId),['review','prepare','analyse','compute']);
  assert.deepEqual(r.counts,{total:4,inputReferencesVerified:4,materialReviewRequired:0,predecessorResultsRequired:3,rootInputsVerified:1});
  assert.equal(loads.length,15);
  assert.deepEqual(f.calls.map(c=>c[1]),['model','source','model','source']);
  for(const row of r.stages){
    const single=await read(f,row.stepId);
    assert.equal(row.inputBasisDigest,single.inputBasisDigest);
    assert.equal(row.prerequisiteCount,single.basis.prerequisiteClosure.length-1);
  }
  assert.equal(r.completeMethodCurrentVerified,true);assert.equal(r.executionStatusObserved,false);
  assert.equal(r.executionAuthority,false);assert.equal(r.resultReuseProven,false);
  assert.equal(JSON.stringify(r).includes('material body'),false);
  assert.equal((await f.owner.audit()).length,5);
});
test('overview identifies material issues only for affected Work closures and ignores unused material',async()=>{
  const f=await setup();
  const readObject=async(ws,id)=>{const row=await f.readObject(ws,id);return id==='model'?{object:{...row.object,revision:9}}:row;};
  const r=await overview(f,{readObject});
  assert.deepEqual(r.stages.map(s=>[s.stepId,s.state,s.materialIssues]),[
    ['review','MATERIAL_REVIEW_REQUIRED',['model']],['prepare','INPUT_REFERENCES_VERIFIED',[]],
    ['analyse','PREDECESSOR_RESULTS_REQUIRED',[]],['compute','MATERIAL_REVIEW_REQUIRED',['model']]]);
  assert.equal(r.counts.inputReferencesVerified,2);assert.equal(r.counts.materialReviewRequired,2);
  assert.equal(r.counts.predecessorResultsRequired,1);
  assert.equal(r.stages[0].inputBasisDigest,null);
  assert.equal(r.stages[3].inputBasisDigest,null);
  assert.equal(f.calls.some(c=>c[1]==='unused'),false);
});
test('overview refuses a stale complete method while independent selected Work stays readable',async()=>{
  const f=await setup(),before=await overview(f);
  const next=await edit(f,'analyse');
  await assert.rejects(overview(f),code('METHOD_STAGE_SOURCE_CHANGED'));
  const independent=await read(f,'compute');
  const after=await overview(f,{expected:next});
  assert.equal(independent.inputBasisDigest,before.stages.find(s=>s.stepId==='compute').inputBasisDigest);
  assert.equal(after.stages.find(s=>s.stepId==='compute').inputBasisDigest,independent.inputBasisDigest);
  assert.notEqual(after.stages.find(s=>s.stepId==='review').inputBasisDigest,before.stages.find(s=>s.stepId==='review').inputBasisDigest);
});
test('overview refuses material or original source change during shared readback',async()=>{
  const f=await setup();let n=0;
  await assert.rejects(overview(f,{readObject:async(ws,id)=>{
    const row=await f.readObject(ws,id);return id==='model'?{object:{...row.object,revision:++n}}:row;
  }}),code('METHOD_STAGE_MATERIAL_CHANGED'));
  const g=await setup();let once=false;
  await assert.rejects(overview(g,{readObject:async(ws,id)=>{
    if(!once){once=true;await edit(g,'analyse');}
    return g.readObject(ws,id);
  }}),code('METHOD_STAGE_SOURCE_CHANGED'));
});
test('complete method overview rejects missing or duplicate original revisions before presenting a partial board',async()=>{
  const f=await setup();
  await assert.rejects(overview(f,{expected:{...f.base,workRefs:f.base.workRefs.slice(1)}}),code('METHOD_STAGE_SOURCE_CHANGED'));
  const rows=f.base.workRefs.map(row=>({...row}));rows[1].recordId=rows[0].recordId;
  await assert.rejects(overview(f,{expected:{...f.base,workRefs:rows}}),code('METHOD_STAGE_SELECTION_INVALID'));
});


test('single selected stage identity is captured before async source observation',async()=>{
  const f=await setup();let release,entered;const gate=new Promise(resolve=>{release=resolve;});
  const ready=new Promise(resolve=>{entered=resolve;});let first=true;
  const owner={load:async(...args)=>{if(first){first=false;entered();await gate;}return f.owner.load(...args);}};
  const args={owner,workspaceId,projectId,expected:f.base,readObject:f.readObject,stepId:'compute'};
  const pending=readWorkspaceMethodStageInputBasis(args);await ready;args.stepId='prepare';release();
  assert.equal((await pending).basis.stepId,'compute');
});
test('64-stage complete overview scales owner reads with Works and shares each material observation',async()=>{
  const {owner}=await createProjectProcessSourceOwnerQualificationHarness();
  const value=draft();value.steps=Array.from({length:64},(_,i)=>({id:'stage-'+i,name:'Stage '+i,
    actor:'program',instruction:'Calculate stage '+i,dependsOn:i?['stage-'+(i-1)]:[],materialIds:['model']}));
  const result=await createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects,draft:value,
    recordIds:{project:'large-project',works:Object.fromEntries(value.steps.map(s=>[projectId+'.'+s.id,'large-'+s.id]))},knowledgeAt:time});
  let loads=0,materialReads=0;
  const port={load:async(...args)=>{loads++;return owner.load(...args);}};
  const material=async(ws,id)=>{materialReads++;return {object:{...objects.find(o=>o.workspace_id===ws&&o.object_id===id)}};};
  const r=await readWorkspaceMethodInputOverview({owner:port,workspaceId,projectId,expected:result.method,readObject:material});
  assert.equal(r.stages.length,64);assert.equal(loads,195);assert.equal(materialReads,2);
  assert.equal(r.stages.at(-1).prerequisiteCount,63);
  assert.equal(r.counts.predecessorResultsRequired,63);assert.equal(r.counts.rootInputsVerified,1);
  const last=await readWorkspaceMethodStageInputBasis({owner,workspaceId,projectId,expected:result.method,readObject:material,stepId:'stage-63'});
  assert.equal(r.stages.at(-1).inputBasisDigest,last.inputBasisDigest);
  assert.equal((await owner.audit()).length,65);
});

function evidenceFixture(f){
  const bytes=new TextEncoder().encode('private attachment');
  const asset={workspace_id:workspaceId,object_id:'source',asset_id:'attachment',revision:1,mime:'text/plain',
    size:bytes.length,service_id:'svc',created_at:time,updated_at:time,updated_by_service:'svc'};
  const calls=[];
  const readObject=async(w,id)=>{const row=await f.readObject(w,id);return row?{object:{...row.object,extensions:{}}}:null;};
  const listAssets=async query=>{calls.push(['list',query]);return query.object_id==='source'?[asset]:[];};
  const getAsset=async(w,id)=>{calls.push(['get',w,id]);return {asset,bytes};};
  const args={owner:f.owner,workspaceId,projectId,expected:f.base,stepId:'compute',readObject,listAssets,getAsset};
  return {args,asset,bytes,calls};
}
test('visible material content and original attached bytes yield deterministic evidence without exposing payload or execution authority',async()=>{
  const f=await setup(),e=evidenceFixture(f);
  const first=await inspectWorkspaceMethodMaterialEvidence(e.args);
  assert.equal(first.state,'VISIBLE_MATERIAL_CONTENT_OBSERVED');
  assert.equal(first.observation.counts.materials,2);assert.equal(first.observation.counts.assets,1);
  assert.equal(first.observation.counts.assetBytes,e.bytes.length);
  assert.match(first.materialEvidenceDigest,/^[a-f0-9]{64}$/);
  assert.match(first.observation.materials.find(r=>r.reference.object_id==='source').visibleAssets[0].sha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first).includes('private attachment'),false);
  assert.equal(JSON.stringify(first).includes('material body'),false);
  for(const key of ['atomicSnapshot','allAssetsProven','contentBindingProven','exactInputBindingProven','writeAuthorized','executionAuthority','dispatchAuthorized','resultReuseProven'])
    assert.equal(first[key],false);
  const second=await inspectWorkspaceMethodMaterialEvidence(e.args);
  assert.equal(first.materialEvidenceDigest,second.materialEvidenceDigest);
  assert.equal(e.calls.some(row=>row[1]?.object_id==='unused'),false);
  assert.equal((await f.owner.audit()).length,5);
});
test('material data or exact bytes change alters content evidence even when original Object revision does not',async()=>{
  const f=await setup(),e=evidenceFixture(f),first=await inspectWorkspaceMethodMaterialEvidence(e.args);
  const next=await inspectWorkspaceMethodMaterialEvidence({...e.args,getAsset:async()=>({asset:e.asset,
    bytes:Uint8Array.from(e.bytes,b=>b^1)})});
  assert.equal(first.stageInput.inputBasisDigest,next.stageInput.inputBasisDigest);
  assert.notEqual(first.materialEvidenceDigest,next.materialEvidenceDigest);
  const altered=await inspectWorkspaceMethodMaterialEvidence({...e.args,readObject:async(w,id)=>{
    const r=await e.args.readObject(w,id);return id==='source'?{object:{...r.object,data:{value:2.125}}}:r;
  }});
  assert.notEqual(first.materialEvidenceDigest,altered.materialEvidenceDigest);
});
test('content evidence refuses changes across repeated observations including same-revision bytes and changing attachment membership',async()=>{
  const f=await setup(),e=evidenceFixture(f);let reads=0;
  await assert.rejects(inspectWorkspaceMethodMaterialEvidence({...e.args,getAsset:async()=>({asset:e.asset,
    bytes:++reads===1?e.bytes:Uint8Array.from(e.bytes,b=>b^1)})}),code('METHOD_MATERIAL_CONTENT_CHANGED'));
  let lists=0;
  await assert.rejects(inspectWorkspaceMethodMaterialEvidence({...e.args,listAssets:async q=>
    q.object_id==='source'&&++lists===1?[e.asset]:[]}),code('METHOD_MATERIAL_CONTENT_CHANGED'));
});
test('content evidence rejects foreign, duplicate, malformed and over-budget Asset metadata before opening bytes',async()=>{
  const f=await setup(),e=evidenceFixture(f);let reads=0;
  for(const [rows,error] of [
    [[{...e.asset,workspace_id:'foreign'}],'METHOD_MATERIAL_ASSET_IDENTITY_MISMATCH'],
    [[{...e.asset,object_id:'unused'}],'METHOD_MATERIAL_ASSET_IDENTITY_MISMATCH'],
    [[{...e.asset,size:-1}],'METHOD_MATERIAL_ASSET_IDENTITY_MISMATCH'],
    [[{...e.asset,size:33*1024*1024}],'METHOD_MATERIAL_EVIDENCE_BUDGET_EXCEEDED']
  ]){
    await assert.rejects(inspectWorkspaceMethodMaterialEvidence({...e.args,listAssets:async q=>q.object_id==='source'?rows:[],
      getAsset:async()=>{reads++;return {asset:e.asset,bytes:e.bytes};}}),code(error));
  }
  assert.equal(reads,0);
  await assert.rejects(inspectWorkspaceMethodMaterialEvidence({...e.args,listAssets:async q=>q.object_id==='source'?[e.asset,e.asset]:[]}),
    code('METHOD_MATERIAL_ASSET_IDENTITY_MISMATCH'));
  await assert.rejects(inspectWorkspaceMethodMaterialEvidence({...e.args,getAsset:async()=>({asset:{...e.asset,revision:2},bytes:e.bytes})}),
    code('METHOD_MATERIAL_ASSET_CHANGED'));
  await assert.rejects(inspectWorkspaceMethodMaterialEvidence({...e.args,getAsset:async()=>({asset:e.asset,bytes:new Uint8Array(0)})}),
    code('METHOD_MATERIAL_ASSET_CHANGED'));
});
test('content evidence never reads Assets for stale material refs or bypasses missing original Asset rights',async()=>{
  const f=await setup(),e=evidenceFixture(f);let reads=0;
  const stale=await inspectWorkspaceMethodMaterialEvidence({...e.args,readObject:async(w,id)=>{
    const r=await e.args.readObject(w,id);return id==='source'?{object:{...r.object,revision:2}}:r;
  },listAssets:async()=>{reads++;return [];}});
  assert.equal(stale.state,'MATERIAL_REVIEW_REQUIRED');assert.equal(stale.materialEvidenceDigest,null);assert.equal(reads,0);
  await assert.rejects(inspectWorkspaceMethodMaterialEvidence({...e.args,getAsset:undefined}),code('METHOD_MATERIAL_ASSET_OWNER_REQUIRED'));
  await assert.rejects(inspectWorkspaceMethodMaterialEvidence({...e.args,listAssets:async()=>{throw Object.assign(Error('denied'),{code:'PERMISSION_DENIED'});}}),code('PERMISSION_DENIED'));
});
