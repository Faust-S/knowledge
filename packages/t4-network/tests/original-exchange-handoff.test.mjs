import test from 'node:test';
import assert from 'node:assert/strict';
import {createT4OriginalExchangeHandoff} from '../src/network/original-exchange-handoff.mjs';
import {packageSha256} from '../src/network/webdav-package-transfer.mjs';

function setup(overrides = {}) {
  const bytes = Buffer.from('opaque-fixture-not-real-iwxa');
  const full = {
    workspaces: ['company-a'], include_history: true, include_assets: true,
    include_relations: true, include_schemas: true,
  };
  const original = {
    filename: 'original.iwxa', bytes, size: bytes.length,
    package_digest: 'original-package-digest', semantic_digest: 'original-semantic-digest',
    manifest: {
      format: 'iwxa.package', format_version: '1.1', encryption: 'none',
      package_digest: 'original-package-digest', semantic_digest: 'original-semantic-digest',
      workspaces: ['company-a'], options: {include_history: true,include_assets: true,
        include_relations: true,include_schemas: true},
    },
    validation: {format: 'iwxa.package.validation', ok: true,
      file_count: 1,object_count: 1,schema_issues: [],path_issues: []},
    summary: {workspaces: 1},
  };
  const state = {
    status: 'confirmed', fileSavedConfirmed: true, ackSensitive: true, artifact: original,
    selection: full, previewSnapshot: full, packageSnapshot: full,
    preview: {workspaces: ['company-a']},
    receipt: {
      package_digest: 'original-package-digest', workspace_ids: ['company-a'],
      confirmed_at: '2026-11-21T00:00:00Z', confirmations: 1,
    },
  };
  let selection = {workspace_id: 'company-a'};
  const listeners = new Set(), events = [];
  const currentWorkspace = {
    get: () => selection,
    subscribe: callback => {listeners.add(callback); return () => listeners.delete(callback);},
  };
  const switchWorkspace = next => {selection = next; for (const listener of listeners) listener();};
  const operations = new Set(['t2.exportPackage','t2.confirmExport','t2.importPreview','t2.importCancel']);
  const originalKernel = {
    hasOperation: op => operations.has(op),
    importPreview: async b => {events.push(['importPreview', Buffer.from(b)]); return {preview_token:'original-token'};},
    importCancel: async token => {events.push(['importCancel',token]); return true;},
    importCommit: async () => {throw Error('T4_MUST_NOT_COMMIT');},
  };
  const transport = {
    putSnapshot: async input => {events.push(['putSnapshot',input]);return {state:'PUBLISHED_AND_READ_BACK',key:input.key,sha256:input.expectedSha256};},
    getSnapshot: async () => {events.push(['getSnapshot']);return {bytes,receipt:{state:'DOWNLOADED_VERIFIED_BYTES'}};},
  };
  let exportState = state;
  const args = {transport,originalKernel,currentWorkspace,readOriginalExportState:()=>exportState,workspaceId:'company-a'};
  return {state,original,events,transport,originalKernel,operations,args,
    update: next => {exportState = next;},
    switchWorkspace, handoff:()=>createT4OriginalExchangeHandoff({...args,...overrides})};
}

const matchesCode = code => error => {assert.equal(error.code,code);return true;};

test('confirmed original T3 export transfers exact opaque bytes with independent transport hash',async()=>{
  const h=setup();const result=await h.handoff().publishConfirmedExport();
  assert.equal(result.originalExportConfirmed,true);
  assert.equal(result.originalImportCommitted,false);
  assert.equal(result.originalPackageDigest,'original-package-digest');
  assert.equal(result.sha256,packageSha256(h.original.bytes));
  assert.equal(h.events.length,1);
  assert.deepEqual(Buffer.from(h.events[0][1].bytes),h.original.bytes);
  assert.equal(h.events[0][1].createOnly,true);
});
test('not confirmed state blocks without network',async()=>{
  const h=setup();h.update({...h.state,status:'package-ready'});
  await assert.rejects(h.handoff().publishConfirmedExport(),matchesCode('ORIGINAL_EXPORT_NOT_CONFIRMED'));
  assert.equal(h.events.length,0);
});
test('stale export or absent user acknowledgement blocks',async()=>{
  for(const patch of [{ackSensitive:false},{fileSavedConfirmed:false},{packageSnapshot:{workspaces:['other']}}]){
    const h=setup();h.update({...h.state,...patch});
    await assert.rejects(h.handoff().publishConfirmedExport(),e=>
      e.code==='ORIGINAL_EXPORT_NOT_CONFIRMED' ||
      e.code==='ORIGINAL_EXCHANGE_FULL_WORKSPACE_REQUIRED');
    assert.equal(h.events.length,0);
  }
});
test('original receipt mismatch blocks',async()=>{
  for(const patch of [
    {receipt:{...setup().state.receipt,package_digest:'forged'}},
    {receipt:{...setup().state.receipt,confirmations:0}},
    {artifact:{...setup().original,validation:{format:'iwxa.package.validation',ok:false}}},
    {artifact:{...setup().original,manifest:{...setup().original.manifest,workspaces:['other']}}},
  ]){
    const h=setup();h.update({...h.state,...patch});
    await assert.rejects(h.handoff().publishConfirmedExport(),matchesCode('ORIGINAL_EXPORT_RECEIPT_MISMATCH'));
    assert.equal(h.events.length,0);
  }
});
test('original operation capability required',async()=>{
  const h=setup();h.operations.delete('t2.confirmExport');
  await assert.rejects(h.handoff().publishConfirmedExport(),matchesCode('ORIGINAL_EXPORT_OPERATION_UNAVAILABLE'));
  assert.equal(h.events.length,0);
});
test('selection changed during original state acquisition prevents transfer',async()=>{
  const h=setup();
  const bridge=createT4OriginalExchangeHandoff({...h.args,readOriginalExportState:async()=>{h.switchWorkspace({workspace_id:'other'});return h.state;}});
  await assert.rejects(bridge.publishConfirmedExport(),matchesCode('ORIGINAL_WORKSPACE_FOCUS_CHANGED'));
  assert.equal(h.events.length,0);
});
test('lost focus after upload reports possible write instead of false negative',async()=>{
  const h=setup();const b=createT4OriginalExchangeHandoff({...h.args,transport:{
    ...h.transport,putSnapshot:async s=>{h.switchWorkspace({workspace_id:'other'});h.events.push(['putSnapshot',s]);return {state:'PUBLISHED_AND_READ_BACK'};},
  }});
  await assert.rejects(b.publishConfirmedExport(),e=>{
    assert.equal(e.code,'ORIGINAL_WORKSPACE_FOCUS_CHANGED');
    assert.equal(e.details.networkMayHavePublished,true);
    return true;
  });
  assert.equal(h.events.length,1);
});
test('original export state invalidation after network is explicit unknown',async()=>{
  const h=setup();const b=createT4OriginalExchangeHandoff({...h.args,transport:{
    ...h.transport,putSnapshot:async s=>{h.update({...h.state,status:'ready'});return {state:'PUBLISHED_AND_READ_BACK'};},
  }});
  await assert.rejects(b.publishConfirmedExport(),e=>{
    assert.equal(e.code,'ORIGINAL_EXPORT_STATE_CHANGED_AFTER_NETWORK');
    assert.equal(e.details.networkMayHavePublished,true);return true;
  });
});
test('download is sent only to original T3 importPreview and never auto-commits',async()=>{
  const h=setup();const r=await h.handoff().previewRemoteImport({key:'x.iwxa',expectedSha256:'0'.repeat(64)});
  assert.equal(r.originalImportPreviewed,true);
  assert.equal(r.originalImportCommitted,false);
  assert.equal(r.originalPreview.preview_token,'original-token');
  assert.equal(h.events[0][0],'getSnapshot');
  assert.equal(h.events[1][0],'importPreview');
  assert.deepEqual(h.events[1][1],h.original.bytes);
  assert.equal(h.events.length,2);
});
test('importPreview absent rejects before network',async()=>{
  const h=setup();h.operations.delete('t2.importPreview');
  await assert.rejects(h.handoff().previewRemoteImport({key:'x.iwxa',expectedSha256:'0'.repeat(64)}),
    matchesCode('ORIGINAL_IMPORT_PREVIEW_UNAVAILABLE'));
  assert.equal(h.events.length,0);
});
test('focus changed while downloading never invokes original preview',async()=>{
  const h=setup();const b=createT4OriginalExchangeHandoff({...h.args,transport:{
    ...h.transport,getSnapshot:async()=>{h.switchWorkspace({workspace_id:'other'});return {bytes:h.original.bytes,receipt:{}};},
  }});
  await assert.rejects(b.previewRemoteImport({key:'x.iwxa',expectedSha256:'0'.repeat(64)}),
    matchesCode('ORIGINAL_WORKSPACE_FOCUS_CHANGED'));
  assert.equal(h.events.length,0);
});
test('focus changed during original preview cancels original preview token',async()=>{
  const h=setup();h.originalKernel.importPreview=async()=>{h.switchWorkspace({workspace_id:'other'});return {preview_token:'token-to-cancel'};};
  await assert.rejects(h.handoff().previewRemoteImport({key:'x.iwxa',expectedSha256:'0'.repeat(64)}),
    matchesCode('ORIGINAL_WORKSPACE_FOCUS_CHANGED'));
  assert.deepEqual(h.events.map(e=>e[0]),['getSnapshot','importCancel']);
  assert.equal(h.events[1][1],'token-to-cancel');
});

test('original full-company release contract prevents incomplete exported workspace reaching network',async()=>{
  const current=setup();
  const missing=[
    {...current.state,selection:{...current.state.selection,include_history:false}},
    {...current.state,previewSnapshot:null},
    {...current.state,packageSnapshot:{...current.state.packageSnapshot,include_assets:false}},
    {...current.state,preview:{workspaces:['other-company']}},
    {...current.state,artifact:{...current.original,manifest:{...current.original.manifest,
      options:{...current.original.manifest.options,include_relations:false}}}},
  ];
  for(const next of missing){
    const h=setup();h.update(next);
    await assert.rejects(h.handoff().publishConfirmedExport(),
      matchesCode('ORIGINAL_EXCHANGE_FULL_WORKSPACE_REQUIRED'));
    assert.equal(h.events.length,0);
  }
});
test('invalid original validation detail cannot pass as a confirmed export',async()=>{
  const h=setup();h.update({...h.state,artifact:{...h.original,validation:{
    ...h.original.validation,object_count:NaN,
  }}});
  await assert.rejects(h.handoff().publishConfirmedExport(),
    matchesCode('ORIGINAL_EXPORT_RECEIPT_MISMATCH'));
  assert.equal(h.events.length,0);
});
