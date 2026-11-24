import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectT4OriginalObjectDeletePreflight,readT4OriginalObjectDeletionReview}
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

const coverage=()=>({schema:'IWXA_T4_ORIGINAL_OBJECT_DELETE_COVERAGE_V1',
  workspaceId:ws,objectId:id,originalWriteOwnerRef:owner,
  hostSessionRef:'original:host',originalAccessRef:'original:access',
  allIncidentRelationsVisible:true,allLiveOwnedAssetsVisible:true,
  completeOriginalAuthorityVerified:true});
const reviewPorts=f=>({...f.ports,readOriginalDependencyCoverage:async()=>coverage()});
const relationRow=(rid,from,to)=>({workspace_id:ws,relation_id:rid,from_object_id:from,
  to_object_id:to,kind:'depends-on',created_by_service:'service:owner'});
const assetRow=(aid,revision=1)=>({workspace_id:ws,asset_id:aid,object_id:id,
  service_id:'service:asset',revision,size:29,mime:'text/plain'});
test('complete original coverage distinguishes isolated Object from filtered empty read',async()=>{
  const f=fixture();
  await assert.rejects(readT4OriginalObjectDeletionReview(f.ports),
    err('OBJECT_DELETE_COMPLETE_ORIGINAL_SCOPE_REQUIRED'));
  await assert.rejects(readT4OriginalObjectDeletionReview({...reviewPorts(f),
    readOriginalDependencyCoverage:async()=>({...coverage(),allIncidentRelationsVisible:false})}),
    err('OBJECT_DELETE_ORIGINAL_DEPENDENCY_VISIBILITY_UNPROVEN'));
  assert.equal(f.counts().reads,0);
  const review=await readT4OriginalObjectDeletionReview(reviewPorts(f));
  assert.equal(review.state,'ISOLATED_ORIGINAL_OBJECT');
  assert.equal(review.originalCompleteDependencyVisibilityVerified,true);
  assert.equal(review.networkDeletePermitted,false);
  assert.equal(review.dependencyCount,0);
  assert.equal(f.counts().deletes,0);
});
test('dependency review enumerates exact original relations and assets in stable order without cascading',async()=>{
  const f=fixture();
  f.getGraph().relations.outgoing=[relationRow('link:z',id,'object:z')];
  f.getGraph().relations.incoming=[relationRow('link:a','object:a',id)];
  f.setAssets([assetRow('asset:z',3),assetRow('asset:a',2)]);
  const review=await readT4OriginalObjectDeletionReview(reviewPorts(f));
  assert.equal(review.state,'DEPENDENCIES_REQUIRE_EXPLICIT_MUTATIONS');
  assert.equal(review.dependencyCount,4);
  assert.deepEqual(review.relations.map(x=>x.relationId),['link:a','link:z']);
  assert.deepEqual(review.assets.map(x=>[x.assetId,x.revision]),[['asset:a',2],['asset:z',3]]);
  assert.equal(review.relations[0].originalCreatorRef,'service:owner');
  assert.equal(review.physicalCascadeAllowed,false);
  assert.equal(review.originalHostMustRecheckAtMutation,true);
  assert.equal(f.counts().deletes,0);
});
test('dependency review refuses changed assets without relying on Object revision',async()=>{
  const f=fixture();let reads=0;
  f.ports.originalKernel.listAssets=async()=>[assetRow('asset:one',++reads)];
  await assert.rejects(readT4OriginalObjectDeletionReview(reviewPorts(f)),
    err('OBJECT_DELETE_ORIGINAL_DEPENDENCIES_CHANGED'));
  assert.equal(f.counts().deletes,0);
});
test('dependency review refuses changed original authority and invalid foreign rows',async()=>{
  const f=fixture();let reads=0;
  await assert.rejects(readT4OriginalObjectDeletionReview({...reviewPorts(f),
    readOriginalDependencyCoverage:async()=>({...coverage(),hostSessionRef:'host:'+String(++reads)})}),
    err('OBJECT_DELETE_ORIGINAL_DEPENDENCY_COVERAGE_CHANGED'));
  f.setAssets([{...assetRow('asset:one'),object_id:'other:object'}]);
  await assert.rejects(readT4OriginalObjectDeletionReview(reviewPorts(f)),
    err('OBJECT_DELETE_ORIGINAL_ASSET_LIST_INVALID'));
  assert.equal(f.counts().deletes,0);
});
test('self-edge appears once only if both original directions agree',async()=>{
  const f=fixture(),self=relationRow('self:one',id,id);
  f.getGraph().relations.outgoing=[self];
  await assert.rejects(readT4OriginalObjectDeletionReview(reviewPorts(f)),
    err('OBJECT_DELETE_ORIGINAL_RELATION_LIST_INVALID'));
  f.getGraph().relations.incoming=[self];
  const result=await readT4OriginalObjectDeletionReview(reviewPorts(f));
  assert.equal(result.dependencyCount,1);
});
