import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectAgent05SourcePin,observePublicOwnerApiBlobs,
  PINNED_PUBLIC_K02_API_BLOBS,gitBlobSha} from '../consumers/agent05-owner-source-pin-check.mjs';

const PIN='467fddc8a49dab475af79a63b0ca4eea78fd5ff2';
const NOW='32f2e02a8d88e97dbe1361c4263773b6bba71923';
test('Agent 0.5 frozen public K02 API source blobs still match current contract bytes',async()=>{
 const observed=await observePublicOwnerApiBlobs();
 assert.deepEqual(observed,PINNED_PUBLIC_K02_API_BLOBS);
 assert.match(observed['index.mjs'],/^[0-9a-f]{40}$/);
 assert.match(observed['model-step-selection.mjs'],/^[0-9a-f]{40}$/);
});
test('branch advancing past a frozen owner SHA means branch checkout + exact assertion must fail',()=>{
 const r=inspectAgent05SourcePin({
   pinnedCommit:PIN,observedBranchHead:NOW,
   pinnedApiBlobs:PINNED_PUBLIC_K02_API_BLOBS,
   observedApiBlobs:PINNED_PUBLIC_K02_API_BLOBS,
 });
 assert.equal(r.status,'BRANCH_HEAD_MOVED_FROZEN_API_STABLE');
 assert.equal(r.branchCheckoutWithShaAssertionWouldPass,false);
 assert.equal(r.sourceApiByteIdentical,true);
 assert.equal(r.nextStep,'P01_FETCH_EXACT_PIN_DIRECTLY_INSTEAD_OF_BRANCH');
 assert.equal(r.actualPinnedWindowsBinaryVerified,false);
 assert.equal(r.installedAgentVerified,false);
});
test('exact frozen checkout is only source-level approval, never a Windows binary receipt',()=>{
 const r=inspectAgent05SourcePin({
   pinnedCommit:PIN,observedBranchHead:PIN,
   pinnedApiBlobs:PINNED_PUBLIC_K02_API_BLOBS,
   observedApiBlobs:PINNED_PUBLIC_K02_API_BLOBS,
 });
 assert.equal(r.status,'BRANCH_HEAD_MATCHES_FROZEN_PIN');
 assert.equal(r.branchCheckoutWithShaAssertionWouldPass,true);
 assert.equal(r.installedAgentVerified,false);
});
test('source API changes require explicit owner re-pin and qualification',()=>{
 const changed={...PINNED_PUBLIC_K02_API_BLOBS,
   'index.mjs':'f'.repeat(40)};
 const r=inspectAgent05SourcePin({
   pinnedCommit:PIN,observedBranchHead:NOW,
   pinnedApiBlobs:PINNED_PUBLIC_K02_API_BLOBS,observedApiBlobs:changed,
 });
 assert.equal(r.status,'BRANCH_HEAD_MOVED_OWNER_API_CHANGED');
 assert.equal(r.nextStep,'P01_REPIN_AFTER_API_COMPATIBILITY_REVIEW');
 assert.equal(r.sourceApiByteIdentical,false);
});
test('Git blob SHA-1 includes its content-size prefix',()=>{
 const actual=gitBlobSha(Buffer.from('abc'));
 assert.equal(actual,'f2ba8f84ab5c1bce84a7b441cb1959cfc7093b7f');
 assert.throws(()=>gitBlobSha('abc'),/INVALID_GIT_BLOB_BYTES/);
});
