import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectT4OriginalObjectDeletePreflight}
  from '../src/network/original-object-delete-preflight.mjs';

const ws='original:workspace',id='original:object:one',owner='original:owner';
const err=code=>e=>e?.code===code;
function fixture(){
  let graph={object:{workspace_id:ws,object_id:id,revision:2,
    schema_id:'iwxa.demo.note',schema_version:'1.0.0',
    data:{title:'Work'},extensions:{},deleted:false},
    relations:{outgoing:[],incoming:[]}},
    assets=[],mode='T4_NETWORK',readCount=0,deleteCalls=0,allow=true;
  const kernel={
    hasOperation:op=>['t1.getObject','t1.listAssets','t1.deleteObject'].includes(op),
    getObject:async()=>{readCount++;return structuredClone(graph);},
    listAssets:async()=>structuredClone(assets),
    deleteObject:async()=>{deleteCalls++;throw Error('never invoked');},
  };
  const ports={
    workspaceId:ws,objectId:id,originalWriteOwnerRef:owner,
    expectedBaseRevision:2,originalKernel:kernel,
    authorizeOriginalRead:async()=>allow,
    authorizeOriginalDelete:async()=>allow,
    getMode:()=>mode,
  };
  return{ports,setGraph:v=>{graph=v;},getGraph:()=>graph,
    setAssets:v=>{assets=v;},setMode:v=>{mode=v;},setAllow:v=>{allow=v;},
    counts:()=>({reads:readCount,deletes:deleteCalls})};
}
test('dependency-free original T3 object returns a read-only advisory without calling deleteObject',async()=>{
  const f=fixture();
  const result=await inspectT4OriginalObjectDeletePreflight(f.ports);
  assert.equal(result.originalT3DeleteInvoked,false);
  assert.equal(result.networkDeletePermitted,false);
  assert.equal(result.originalHostMustRecheckAtMutation,true);
  assert.match(result.preImageDigest,/^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(f.counts(),{reads:2,deletes:0});
});
test('live original outgoing Relation blocks object deletion policy',async()=>{
  const f=fixture();f.getGraph().relations.outgoing.push({
    relation_id:'relation:one',from_object_id:id,to_object_id:'another:object'});
  await assert.rejects(inspectT4OriginalObjectDeletePreflight(f.ports),
    e=>e.code==='OBJECT_DELETE_ORIGINAL_RELATIONS_REQUIRE_REVIEW'&&
      e.details.outgoing===1&&e.details.physicalCascadeAllowed===false);
  assert.equal(f.counts().deletes,0);
});
test('original incoming Relation also blocks deletion preflight',async()=>{
  const f=fixture();f.getGraph().relations.incoming.push({
    relation_id:'relation:in',from_object_id:'another:object',to_object_id:id});
  await assert.rejects(inspectT4OriginalObjectDeletePreflight(f.ports),
    err('OBJECT_DELETE_ORIGINAL_RELATIONS_REQUIRE_REVIEW'));
  assert.equal(f.counts().deletes,0);
});
test('original T3 attached Asset blocks deletion policy before any delete',async()=>{
  const f=fixture();f.setAssets([{asset_id:'asset:one',object_id:id,revision:1}]);
  await assert.rejects(inspectT4OriginalObjectDeletePreflight(f.ports),
    e=>e.code==='OBJECT_DELETE_ORIGINAL_ASSETS_REQUIRE_REVIEW'&&
      e.details.attachedAssets===1);
  assert.equal(f.counts().deletes,0);
});
test('tombstone or nonmatching original base revision fails closed',async()=>{
  const f=fixture();f.getGraph().object.deleted=true;
  await assert.rejects(inspectT4OriginalObjectDeletePreflight(f.ports),
    err('OBJECT_DELETE_ORIGINAL_OBJECT_ABSENT_OR_TOMBSTONED'));
  f.getGraph().object.deleted=false;
  f.getGraph().object.revision=3;
  await assert.rejects(inspectT4OriginalObjectDeletePreflight(f.ports),
    err('OBJECT_DELETE_ORIGINAL_REVISION_CONFLICT'));
  assert.equal(f.counts().deletes,0);
});
test('LOCAL_T3 and revoked original permissions do not inspect original T3',async()=>{
  const f=fixture();f.setMode('LOCAL_T3');
  await assert.rejects(inspectT4OriginalObjectDeletePreflight(f.ports),
    err('OBJECT_DELETE_T4_NETWORK_MODE_OFF'));
  assert.deepEqual(f.counts(),{reads:0,deletes:0});
  f.setMode('T4_NETWORK');f.setAllow(false);
  await assert.rejects(inspectT4OriginalObjectDeletePreflight(f.ports),
    err('OBJECT_DELETE_ORIGINAL_AUTHORITY_DENIED'));
  assert.deepEqual(f.counts(),{reads:0,deletes:0});
});
test('changes to original pre-image between two reads block advisory',async()=>{
  const f=fixture();let reads=0;
  f.ports.originalKernel.getObject=async()=>{
    reads++;
    return {...structuredClone(f.getGraph()),
      object:{...structuredClone(f.getGraph().object),
        data:{title:reads===1?'before':'after'}}};
  };
  await assert.rejects(inspectT4OriginalObjectDeletePreflight(f.ports),
    err('OBJECT_DELETE_ORIGINAL_PREIMAGE_CHANGED'));
  assert.equal(f.counts().deletes,0);
});
