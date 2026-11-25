import test from 'node:test';
import assert from 'node:assert/strict';
import {bindT4OriginalHistoryBoundary} from '../src/network/original-history-boundary.mjs';
const scope={workspaceId:'ws:recipient',originalWriteOwnerRef:'owner:original'},
  read={...scope,operation:'t1.listEventsSince',originalCommitOrderReadRequired:true,originalHistoryExclusionRequired:true};
const narrow={...scope,operation:'t1.deleteAsset',subjectId:'asset:target',originalHostMustSerializeSubjectMutations:true};
function fixture(requireWorkspaceMutationExclusion,deny=false){
  let held=false,writes=0,reads=0;const seen=[];
  const bridge=bindT4OriginalHistoryBoundary({...scope,getMode:()=> 'T4_NETWORK',requireWorkspaceMutationExclusion,
    withOriginalSubjectMutation:async(proof,action)=>{seen.push(proof);assert.equal(proof.originalHostMustSerializeAllWorkspaceGraphMutations,true);assert.equal(held,false);if(deny)return null;held=true;writes++;try{return await action();}finally{held=false;}},
    withOriginalHistoryReadBoundary:async(proof,action)=>{assert.equal(held,false);reads++;return action();}});
  return {bridge,seen,counts:()=>({writes,reads})};
}
test('selected recipient obtains stronger original workspace mutation boundary for Asset and Relation deletes',async()=>{
  const f=fixture(true);
  for(const operation of ['t1.deleteAsset','t1.deleteRelation']){
    const proof={...narrow,operation},result=await f.bridge.withOriginalSubjectMutation(proof,()=>f.bridge.withOriginalHistoryReadBoundary(read,()=>{f.bridge.assertOriginalHistoryReadScope({...read,commitOperation:'t1.listEventCommitWindow'});return 'original';}));
    assert.equal(result,'original');assert.equal(Object.hasOwn(proof,'originalHostMustSerializeAllWorkspaceGraphMutations'),false);
    assert.deepEqual(f.seen.at(-1),{...proof,originalHostMustSerializeAllWorkspaceGraphMutations:true});
  }
  assert.deepEqual(f.counts(),{writes:2,reads:0});
});
test('legacy and denied stronger original boundary cannot execute a narrow mutation',async()=>{
  const f=fixture(false);await assert.rejects(f.bridge.withOriginalSubjectMutation(narrow,()=>assert.fail('no action')),{code:'ORIGINAL_HISTORY_BOUNDARY_MUTATION_EXCLUSION_REQUIRED'});
  const g=fixture(true,true);await assert.rejects(g.bridge.withOriginalSubjectMutation(narrow,()=>assert.fail('no action')),{code:'ORIGINAL_HISTORY_BOUNDARY_NOT_PROVEN'});
  const h=fixture(true);await assert.rejects(h.bridge.withOriginalSubjectMutation({...narrow,originalHostMustSerializeAllWorkspaceGraphMutations:false},()=>assert.fail('no action')),{code:'ORIGINAL_HISTORY_BOUNDARY_MUTATION_EXCLUSION_REQUIRED'});
});
