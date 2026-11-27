import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_EXPORT_STATE, exportReducer, canStartExportPreview, canStartExportPackage} from '../../src/modules/exchange/features/state/export-machine.ts';

const ws={workspace_id:'w',profile:'generic',deleted_at:null};
const preview={workspaces:['w'],counts:{workspaces:1,objects:1,events:1,relations:0,assets:0,schemas:1}};
const artifact={filename:'workspace.iwxa',bytes:new Uint8Array([1,2,3]),size:3,package_digest:'sha256-archive',semantic_digest:'sha256-semantic'};
const receipt={confirmed_at:'2026-11-25T00:00:00Z',package_digest:artifact.package_digest,workspace_ids:['w'],confirmations:1};
const apply=(s,...events)=>events.reduce(exportReducer,s);
const ready=()=>apply(INITIAL_EXPORT_STATE,{type:'load-workspaces'},{type:'workspaces-loaded',catalog:[ws],initialWorkspaces:['w']});
const viewed=()=>apply(ready(),{type:'preview-started'},{type:'preview-succeeded',preview});
const acknowledged=()=>apply(viewed(),{type:'ack-sensitive',value:true});
const packed=()=>apply(acknowledged(),{type:'package-started'},{type:'package-succeeded',artifact});
const offered=()=>apply(packed(),{type:'download-initiated'},{type:'ack-file-saved',value:true});
const confirmed=()=>apply(offered(),{type:'confirm-started'},{type:'confirm-succeeded',receipt});

for (const previous of [viewed,packed,offered,confirmed]) {
  test(`a fresh preview is admitted from ${previous().status} and clears old confirmation`,()=>{
    const before=previous();assert.equal(canStartExportPreview(before),true);
    const next=apply(before,{type:'preview-started'});
    assert.equal(next.status,'previewing');assert.equal(next.preview,null);assert.equal(next.artifact,null);
    assert.equal(next.receipt,null);assert.equal(next.ackSensitive,false);assert.equal(next.fileSavedConfirmed,false);
    assert.equal(next.packageSnapshot,null);assert.equal(next.previewSnapshot,before.selection);
    const completed=apply(next,{type:'preview-succeeded',preview});
    assert.equal(canStartExportPackage(completed),false);
    assert.equal(canStartExportPackage(apply(completed,{type:'ack-sensitive',value:true})),true);
  });
}
test('loading or failed catalog cannot retain or reissue a previous archive',()=>{
  const loading=apply(offered(),{type:'load-workspaces'});
  assert.equal(loading.status,'loading-workspaces');assert.deepEqual(loading.catalog,[]);
  assert.deepEqual(loading.selection.workspaces,[]);assert.equal(loading.artifact,null);
  assert.equal(loading.previewSnapshot,null);assert.equal(loading.packageSnapshot,null);
  assert.equal(canStartExportPreview(loading),false);
  const error=apply(loading,{type:'workspaces-failed',error:'offline'});
  assert.equal(canStartExportPreview(error),false);assert.equal(canStartExportPackage(error),false);
  assert.equal(apply(error,{type:'confirm-started'}),error);
});
test('no preview is issued for a missing workspace or active operation',()=>{
  for (const state of [INITIAL_EXPORT_STATE,apply(ready(),{type:'set-selection',selection:{workspaces:['missing']}}),apply(ready(),{type:'preview-started'}),apply(acknowledged(),{type:'package-started'}),apply(offered(),{type:'confirm-started'})]) {
    assert.equal(canStartExportPreview(state),false);assert.equal(apply(state,{type:'preview-started'}),state);
  }
});
test('package action is admitted only for a freshly acknowledged matching preview',()=>{
  for (const state of [ready(),viewed(),packed(),offered(),confirmed(),{...acknowledged(),previewSnapshot:null},{...acknowledged(),selection:{...acknowledged().selection,include_history:false}}]) {
    assert.equal(canStartExportPackage(state),false);assert.equal(apply(state,{type:'package-started'}),state);
  }
  assert.equal(canStartExportPackage(acknowledged()),true);
  assert.equal(apply(acknowledged(),{type:'package-started'}).status,'packaging');
});
test('reoffering an unconfirmed archive requires a fresh explicit saved-file acknowledgement',()=>{
  const state=apply(offered(),{type:'download-initiated'});
  assert.equal(state.artifact,artifact);assert.equal(state.fileSavedConfirmed,false);
  assert.equal(apply(state,{type:'confirm-started'}),state);
  assert.equal(apply(state,{type:'ack-file-saved',value:true},{type:'confirm-started'}).status,'confirming');
});
test('failed preview cannot show an old artifact or acknowledgement',()=>{
  const state=apply(confirmed(),{type:'preview-started'},{type:'preview-failed',error:'unavailable'});
  assert.equal(state.status,'error');assert.equal(state.preview,null);assert.equal(state.artifact,null);
  assert.equal(state.receipt,null);assert.equal(canStartExportPreview(state),true);
});
test('selection change continues to invalidate a late preview and packaging completion',()=>{
  for(const [before,done] of [[apply(ready(),{type:'preview-started'}),{type:'preview-succeeded',preview}],[apply(acknowledged(),{type:'package-started'}),{type:'package-succeeded',artifact}]]) {
    const changed=apply(before,{type:'set-selection',selection:{include_history:false}});
    assert.equal(apply(changed,done),changed);assert.equal(changed.artifact,null);
  }
});
