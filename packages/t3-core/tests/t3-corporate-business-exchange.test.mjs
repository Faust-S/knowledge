import test from 'node:test';
import assert from 'node:assert/strict';
import {createSubjectKernelBinding} from '../src/t3/subject-access-binding.mjs';

const now=Date.parse('2026-11-24T00:00:00Z');
const ws='ws:company',dg='a'.repeat(64),sd='b'.repeat(64);
const counts={workspaces:1,objects:1,events:1,relations:0,assets:0,schemas:1};
const zero=Object.fromEntries(Object.keys(counts).map(k=>[k,0]));
const opts={workspaces:[ws],include_history:true,include_assets:true,
  include_relations:true,include_schemas:true};
const row={workspace_id:ws,object_id:'company:work:one',
  schema_id:'iwxa.t3.company-work-record',schema_version:'1.0.0'};
const plan={mode:'merge',target_workspace:ws,include_workspaces:[ws],conflict:'fail',
  include_history:true,include_assets:true,include_relations:true};
const input={preview_token:'token:preview',package_digest:dg,plan};
const confirm={workspace_ids:[ws],package_digest:dg};
const bytes=()=>Uint8Array.from([1,2]);

// Test only the signed binding and original Kernel contract. These are not
// physical archives, real Access signatures, or an installed-product witness.
function fixture(){
  const calls=[],context={kind:'CORP',context_id:'context:corp',actor_id:'person:a',
    principal_id:'org:a',role_id:'role:employee',grant_id:'grant:corp',
    realm_id:'realm:corp',audience:'host:t3',resource:ws,purpose:'purpose:work',
    workspace_id:ws,organization_id:'org:a',scope_revision:1};
  const manifest={format:'iwxa.package',format_version:'1.0',encryption:'none',
    workspaces:[ws],workspace_states:[{workspace_id:ws}],options:opts,counts,
    files:[{path:'content/objects.ndjson'}],package_digest:dg,semantic_digest:sd};
  const f={calls,context,rows:[structuredClone(row)],events:[
    {workspace_id:ws,event_type:'iwxa.company.work',object_id:row.object_id}],old:null,
    preview:{preview_token:input.preview_token,package_digest:dg,semantic_digest:sd,
      expires_at:new Date(now+60000).toISOString(),allowed_modes:['merge'],preview:{
        manifest:structuredClone(manifest),package_digest:dg,semantic_digest:sd,
        workspaces:[{workspace_id:ws}],objects:[structuredClone(row)],conflicts:[],
        schemas:[{schema_id:row.schema_id,schema_version:'1.0.0',
          status:'embedded_equal',object_count:1}],totals:structuredClone(counts),
        included:structuredClone(counts),excluded_by_permission:structuredClone(zero),
        unsupported:[],invalid:{envelopes:0,dependencies:0,schema_validation:0,
          schema_conflicts:0},scope_mode:'workspace'}}};
  f.artifact={bytes:bytes(),size:2,validation:{ok:true},manifest:structuredClone(manifest),
    package_digest:dg,semantic_digest:sd,summary:{scope_mode:'workspace',
      included:structuredClone(counts),excluded_by_permission:structuredClone(zero)}};
  const kernel={sessionInfo:{contract_version:'1.3.0'},hasOperation:()=>true,
    getObject:async()=>f.old,listEventsSince:async()=>f.events,listObjects:async()=>f.rows,
    exportPreview:async()=>({workspaces:[ws],counts,summary:f.artifact.summary}),
    exportPackage:async()=>{calls.push('export');return f.artifact},
    importPreview:async()=>{calls.push('preview');return f.preview},
    importCancel:async()=>{calls.push('cancel');return true},
    importCommit:async()=>{calls.push('commit');return {mode:'merge',
      workspace_id_map:{[ws]:ws},skipped_conflicts:[],package_digest:dg}},
    confirmExport:async()=>{calls.push('confirm');return{workspace_ids:[ws],package_digest:dg}}};
  const owner=()=>({currentContext:()=>context,actionFor:()=> 'action:work',
    operationDigest:()=>dg,authorize:()=>({
      schema:'IWXA_T3_ORGANIZATION_OPERATION_DECISION/1',allowed:true,
      outcome:'PERMITTED',evidenceOnly:true,requestDigest:dg,policyDigest:dg,
      statusSequence:1,organizationId:context.organization_id,workspaceId:ws,
      grantId:context.grant_id,operationDigest:dg,evidenceDigest:dg,
      productionActivation:false,doesNotTransferData:true,doesNotAcceptCorporateCopy:true,
      validUntil:new Date(now+60000).toISOString()}),verifyDecisionBinding:()=>true});
  const previewSession={};
  f.kernel=kernel;
  f.bound=()=>createSubjectKernelBinding({kernel,access:owner(),previewSession,
    corporateBusinessExchange:true,clock:()=>now});
  return f;
}
test('complete business export uses original archive parser and cancels inspection before confirmation',async()=>{
  const f=fixture();
  await f.bound().exportPreview(opts);
  await f.bound().exportPackage(opts);
  await f.bound().confirmExport(confirm);
  assert.deepEqual(f.calls,['export','preview','cancel','confirm']);
  await assert.rejects(f.bound().confirmExport(confirm),
    {code:'T3_CORPORATE_EXCHANGE_VERIFIED_EXPORT_REQUIRED'});
});
test('complete business import preserves original token across method-specific ports',async()=>{
  const f=fixture();
  await f.bound().importPreview(bytes());
  await f.bound().importCommit(input);
  assert.deepEqual(f.calls,['preview','commit']);
});
test('protected or incomplete local inventory cannot be exported',async()=>{
  for(const [mutate,code] of [
    [f=>f.old={object:{}},'T3_CORPORATE_EXCHANGE_LEGACY_REGISTRY_PRESENT'],
    [f=>f.events.push({workspace_id:ws,event_type:'t3.access.signed_registry.persisted'}),
      'T3_CORPORATE_EXCHANGE_LEGACY_REGISTRY_PRESENT'],
    [f=>f.rows.push({...row,object_id:'result:applied:one'}),
      'T3_CORPORATE_EXCHANGE_PROTECTED_OR_UNSUPPORTED_CONTENT'],
    [f=>f.artifact.summary.excluded_by_permission.objects=1,
      'T3_CORPORATE_EXCHANGE_EXPORT_INCOMPLETE'],
  ]){
    const f=fixture();mutate(f);
    await assert.rejects(f.bound().exportPreview(opts),{code});
    assert.deepEqual(f.calls,[]);
  }
  await assert.rejects(fixture().bound().exportPackage({...opts,include_assets:false}),
    {code:'T3_CORPORATE_EXCHANGE_COMPLETE_WORKSPACE_REQUIRED'});
});
test('denied import previews are cancelled before any write or new local authority',async()=>{
  for(const mutate of [
    p=>p.objects[0].schema_id='iwxa.admin.applied-results',
    p=>p.objects[0].object_id='t3.access.signed-registry',
    p=>p.manifest.options.include_assets=false,
    p=>p.manifest.files.push({path:'technical/grants.json'}),
    p=>p.excluded_by_permission.objects=1,
    p=>p.schemas[0].status='embedded_new',
    p=>{p.manifest.workspaces=['ws:foreign'];p.workspaces[0].workspace_id='ws:foreign';
      p.objects[0].workspace_id='ws:foreign'},
  ]){
    const f=fixture();mutate(f.preview.preview);
    await assert.rejects(f.bound().importPreview(bytes()),
      {code:'T3_CORPORATE_EXCHANGE_BUSINESS_ARCHIVE_REQUIRED'});
    assert.deepEqual(f.calls,['preview','cancel']);
    await assert.rejects(f.bound().importCommit(input),{code:'T3_SUBJECT_IMPORT_PREVIEW_REQUIRED'});
  }
});
test('partial, skip-conflict and remapped imports fail before original commit',async()=>{
  for(const [patch,code] of [
    [{include_history:false},'T3_CORPORATE_EXCHANGE_COMPLETE_WORKSPACE_REQUIRED'],
    [{conflict:'overwrite'},'T3_CORPORATE_EXCHANGE_COMPLETE_WORKSPACE_REQUIRED'],
    [{conflict:'skip'},'T3_CORPORATE_EXCHANGE_COMPLETE_WORKSPACE_REQUIRED'],
    [{include_objects:[ws+'/one']},'T3_CORPORATE_EXCHANGE_COMPLETE_WORKSPACE_REQUIRED'],
    [{target_workspace:'ws:other'},'T3_SUBJECT_IMPORT_PLAN_OUT_OF_SCOPE'],
  ]){
    const f=fixture();
    await f.bound().importPreview(bytes());
    await assert.rejects(f.bound().importCommit({...input,plan:{...plan,...patch}}),{code});
    assert.deepEqual(f.calls,['preview']);
  }
});
test('export digest and original inspection cancellation must both be confirmed',async()=>{
  const f=fixture();
  await f.bound().exportPackage(opts);
  await assert.rejects(f.bound().confirmExport({...confirm,package_digest:sd}),
    {code:'T3_CORPORATE_EXCHANGE_VERIFIED_EXPORT_REQUIRED'});
  assert.deepEqual(f.calls,['export','preview','cancel']);
  const g=fixture();g.kernel.importCancel=async()=>false;
  await assert.rejects(g.bound().exportPackage(opts),
    {code:'T3_CORPORATE_EXCHANGE_INSPECTION_CANCEL_UNCONFIRMED'});
  await assert.rejects(g.bound().confirmExport(confirm),
    {code:'T3_CORPORATE_EXCHANGE_VERIFIED_EXPORT_REQUIRED'});
});
