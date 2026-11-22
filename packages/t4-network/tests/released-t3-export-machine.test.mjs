import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_EXPORT_STATE,exportReducer} from '../../t3-core/src/modules/exchange/features/state/export-machine.ts';
import {createT4OriginalExchangeHandoff} from '../src/network/original-exchange-handoff.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';

function originalConfirmedState(){
  const workspaceId='company:original-1', bytes=Buffer.from('opaque-test-data-not-a-real-kernel-package');
  const digest='t3-original-export-reducer-package-digest',semantic='t3-original-export-reducer-semantic';
  const artifact={
    filename:'original-1.iwxa',bytes,size:bytes.byteLength,
    package_digest:digest,semantic_digest:semantic,
    manifest:{format:'iwxa.package',format_version:'1.1',encryption:'none',
      workspaces:[workspaceId],package_digest:digest,semantic_digest:semantic,
      options:{include_history:true,include_assets:true,include_relations:true,include_schemas:true}},
    validation:{format:'iwxa.package.validation',ok:true,
      file_count:1,object_count:1,schema_issues:[],path_issues:[]},
    summary:{workspaces:1},
  };
  const receipt={package_digest:digest,workspace_ids:[workspaceId],
    confirmed_at:'2026-11-22T12:00:00Z',confirmations:1};
  let s=INITIAL_EXPORT_STATE;
  const step=event=>{s=exportReducer(s,event);return s;};
  step({type:'load-workspaces'});
  step({type:'workspaces-loaded',catalog:[{workspace_id:workspaceId,profile:'generic',deleted_at:null}],
    initialWorkspaces:[workspaceId]});
  step({type:'preview-started'});
  step({type:'preview-succeeded',preview:{workspaces:[workspaceId]}});
  step({type:'ack-sensitive',value:true});
  step({type:'package-started'});
  step({type:'package-succeeded',artifact});
  step({type:'download-initiated'});
  step({type:'ack-file-saved',value:true});
  step({type:'confirm-started'});
  step({type:'confirm-succeeded',receipt});
  return {workspaceId,bytes,artifact,receipt,get state(){return s;},step};
}
function adapter(o,events){
  const current={workspace_id:o.workspaceId};
  return createT4OriginalExchangeHandoff({
    workspaceId:o.workspaceId,readOriginalExportState:()=>o.state,
    originalKernel:{hasOperation:operation=>
      ['t2.exportPackage','t2.confirmExport','t2.importPreview','t2.importCancel'].includes(operation),
      importPreview:async b=>{events.push(['preview',b]);return{preview_token:'original-preview'};}},
    currentWorkspace:{get:()=>current,subscribe:()=>()=>{}},
    transport:{putSnapshot:async p=>{events.push(['put',p]);return{state:'PUBLISHED_AND_READ_BACK'};},
      getSnapshot:async()=>({bytes:o.bytes,receipt:{state:'DOWNLOADED_VERIFIED_BYTES'}})},
  });
}

test('released T3 reducer confirmed state is consumable without a second Exchange',async()=>{
  const o=originalConfirmedState(),events=[];
  assert.equal(o.state.status,'confirmed');
  assert.equal(o.state.packageSnapshot.include_schemas,true);
  const result=await adapter(o,events).publishConfirmedExport();
  assert.equal(result.workspaceId,o.workspaceId);
  assert.equal(result.sha256,packageSha256(o.bytes));
  assert.equal(events.length,1);
  assert.deepEqual(Buffer.from(events[0][1].bytes),o.bytes);
});

test('released T3 reducer invalidates confirmed export on selection change',async()=>{
  const o=originalConfirmedState(),events=[];
  o.step({type:'set-selection',selection:{include_history:false}});
  assert.equal(o.state.status,'ready');
  assert.equal(o.state.receipt,null);
  await assert.rejects(adapter(o,events).publishConfirmedExport(),
    e=>e.code==='ORIGINAL_EXPORT_NOT_CONFIRMED');
  assert.equal(events.length,0);
});

test('released T3 reducer refuses inconsistent confirmation receipt',()=>{
  const o=originalConfirmedState();
  o.step({type:'reset'});
  o.step({type:'preview-started'});
  o.step({type:'preview-succeeded',preview:{workspaces:[o.workspaceId]}});
  o.step({type:'ack-sensitive',value:true});
  o.step({type:'package-started'});
  o.step({type:'package-succeeded',artifact:o.artifact});
  o.step({type:'download-initiated'});
  o.step({type:'ack-file-saved',value:true});
  o.step({type:'confirm-started'});
  o.step({type:'confirm-succeeded',receipt:{...o.receipt,workspace_ids:['other:workspace']}});
  assert.equal(o.state.status,'download-initiated');
  assert.equal(o.state.receipt,null);
});
