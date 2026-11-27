import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {companyWorkRecordKeyParts,companyWorkEventPayload,readOriginalCompanyWorkspace,
  completeCompanyMergePlan,validateCompanyMergeReceipt} from '../src/t3/company-workspace-readback.mjs';
const ws='ws:company',org='org:one';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const data=(kind,artifactId,text)=>({schema:'IWXA_T3_ORIGINAL_COMPANY_WORK_RECORD/1',
  kind,artifactId,operationId:'operation:'+artifactId,organizationId:org,workspaceId:ws,
  executorId:'person:employee',taskId:'task:1',taskRevisionId:'a'.repeat(64),
  taskPackageSha256:'b'.repeat(64),mimeType:'text/plain',text,sha256:sha(text),
  sourceKind:kind==='RESULT'?'ORIGINAL_AGENT_HUMAN_ACCEPTED':'ORIGINAL_SIGNED_TASK'});
function fixture(){
  const rows=[data('TASK','task:1','Inspect manufacturing route'),data('RESULT','result:1','Verified route')].map(d=>({
    workspace_id:ws,object_id:'company:work:'+sha(JSON.stringify(companyWorkRecordKeyParts(d))),
    schema_id:'iwxa.t3.company-work-record',schema_version:'1.0.0',revision:1,data:d}));
  const events=rows.map((r,i)=>({workspace_id:ws,object_id:r.object_id,event_id:'evt:'+i,revision:1,
    idempotency_key:r.object_id.slice('company:work:'.length),event_type:'iwxa.company.work-record.committed',
    payload:companyWorkEventPayload(r.data,r.object_id)}));
  const preview={workspaces:[{workspace_id:ws}],objects:rows.map(r=>({
    workspace_id:ws,object_id:r.object_id,schema_id:r.schema_id,schema_version:r.schema_version,
    incoming_revision:1,local_revision:null,data_equal:false,conflict:false})),
    included:{objects:2,events:2,relations:1,assets:1}};
  const plan={mode:'merge',target_workspace:ws,conflict:'fail',include_workspaces:[ws],
    include_history:true,include_assets:true,include_relations:true};
  const receipt={mode:'merge',conflict_policy:'fail',workspace_id_map:{[ws]:ws},skipped_conflicts:[],
    applied:{workspaces:0,objects_inserted:2,objects_updated:0,objects_skipped:0,
      events:2,relations:1,assets:1,schemas_inserted:0,schemas_reused:1,schemas_rejected:0}};
  const kernel={sessionInfo:{contract_version:'1.3.0'},hasOperation:()=>true,
    getWorkspace:async()=>({workspace_id:ws,updated_at:'2026-11-25T00:00:00Z'}),
    listObjects:async()=>structuredClone(rows),listEventsSince:async()=>structuredClone(events)};
  return {rows,events,preview,plan,receipt,kernel};
}
test('all imported work rows and exact original event payloads are read independently; not signed acceptance',async()=>{
  const f=fixture();const result=await readOriginalCompanyWorkspace({kernel:f.kernel,workspaceId:ws,
    expectedRows:f.preview.objects,organizationId:org});
  assert.equal(result.checkedImportedObjects,2);
  assert.equal(result.records.find(r=>r.kind==='RESULT').text,'Verified route');
  assert.equal(result.signedReceiptVerified,false);
  assert.equal(result.originalKernelReadback,true);
  const cold=await readOriginalCompanyWorkspace({kernel:f.kernel,workspaceId:ws});
  assert.equal(cold.checkedImportedObjects,null);
  assert.deepEqual(cold.records,result.records);
});
test('missing imported row, changed content, changed event or mixed snapshot cannot confirm readback',async()=>{
  for(const mutate of [f=>f.rows.pop(),f=>f.rows[1].data.text='altered',
    f=>f.events[1].payload.taskId='another',f=>f.events.push(structuredClone(f.events[1])),
    f=>{let i=0;f.kernel.getWorkspace=async()=>({workspace_id:ws,updated_at:String(++i)})}]){
    const f=fixture();mutate(f);
    await assert.rejects(readOriginalCompanyWorkspace({kernel:f.kernel,workspaceId:ws,
      expectedRows:f.preview.objects,organizationId:org}));
  }
});
test('identical replay is complete without a duplicate object/event write; conflicting or partial receipts are not',()=>{
  const f=fixture();
  assert.equal(completeCompanyMergePlan(f.preview,f.plan,ws),true);
  assert.deepEqual(validateCompanyMergeReceipt(f.preview,f.plan,f.receipt),[]);
  Object.assign(f.preview.objects[0],{local_revision:1,data_equal:true});
  Object.assign(f.receipt.applied,{objects_inserted:1,objects_skipped:1,events:1});
  assert.deepEqual(validateCompanyMergeReceipt(f.preview,f.plan,f.receipt),[]);
  Object.assign(f.preview.objects[1],{local_revision:1,data_equal:true});
  Object.assign(f.receipt.applied,{objects_inserted:0,objects_skipped:2,events:0});
  assert.deepEqual(validateCompanyMergeReceipt(f.preview,f.plan,f.receipt),[]);
  for(const patch of [{objects_skipped:1},{objects_updated:1},{events:3},{assets:0}]){
    assert.ok(validateCompanyMergeReceipt(f.preview,f.plan,{...f.receipt,applied:{...f.receipt.applied,...patch}}).length);
  }
  assert.ok(validateCompanyMergeReceipt(f.preview,f.plan,{...f.receipt,skipped_conflicts:['some']}).length);
  assert.equal(completeCompanyMergePlan(f.preview,{...f.plan,conflict:'overwrite'},ws),false);
  f.preview.objects[0].local_revision=2;
  assert.equal(completeCompanyMergePlan(f.preview,f.plan,ws),false);
});
