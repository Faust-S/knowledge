// Read-only public-K02 source-pin diagnostic for the Agent 0.5 owner build.
// It does NOT read private build scripts or execute Windows programs.
// The configured owner build fetches a branch, then verifies a frozen SHA;
// a moving branch and a frozen SHA cannot both match. Check exact public API
// bytes independently from the changing research branch.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const OWNER_PIN_DIAGNOSTIC_VERSION =
  'IWXA.K02.AGENT05_OWNER_SOURCE_PIN_DIAGNOSTIC/0.1.0';
const SHA=/^[a-f0-9]{40}$/;
export const PINNED_PUBLIC_K02_API_BLOBS=Object.freeze({
  'index.mjs':'6dd21b566f6dfe3d2e920d3e877548361653460e',
  'model-step-selection.mjs':'45263714c1c2440406889e4ba5791686bc386c8f',
});
export function gitBlobSha(bytes){
  if(!Buffer.isBuffer(bytes))throw Error('INVALID_GIT_BLOB_BYTES');
  return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
}
export function inspectAgent05SourcePin({pinnedCommit,observedBranchHead,pinnedApiBlobs,observedApiBlobs}){
  if(!SHA.test(pinnedCommit??'')||!SHA.test(observedBranchHead??'')||
     !pinnedApiBlobs||!observedApiBlobs||
     typeof pinnedApiBlobs!=='object'||typeof observedApiBlobs!=='object'||
     Object.keys(pinnedApiBlobs).length!==2||
     Object.keys(observedApiBlobs).length!==2||
     Object.keys(PINNED_PUBLIC_K02_API_BLOBS).some(p=>
       !SHA.test(pinnedApiBlobs[p]??'')||!SHA.test(observedApiBlobs[p]??'')))
     throw Error('INVALID_K02_OWNER_PIN_INPUT');
  const sourceApiByteIdentical=Object.keys(PINNED_PUBLIC_K02_API_BLOBS)
    .every(p=>pinnedApiBlobs[p]===observedApiBlobs[p]);
  const branchHeadMatchesPinnedSource=pinnedCommit===observedBranchHead;
  const status=branchHeadMatchesPinnedSource?'BRANCH_HEAD_MATCHES_FROZEN_PIN':
    sourceApiByteIdentical?'BRANCH_HEAD_MOVED_FROZEN_API_STABLE':
    'BRANCH_HEAD_MOVED_OWNER_API_CHANGED';
  return {
    schema:OWNER_PIN_DIAGNOSTIC_VERSION,status,
    pinnedCommit,observedBranchHead,
    pinnedApiBlobs:{...pinnedApiBlobs},observedApiBlobs:{...observedApiBlobs},
    branchHeadMatchesPinnedSource,sourceApiByteIdentical,
    branchCheckoutWithShaAssertionWouldPass:branchHeadMatchesPinnedSource,
    actualPinnedWindowsBinaryVerified:false,
    installedAgentVerified:false,
    nextStep:branchHeadMatchesPinnedSource?'P01_BUILD_AND_WINDOWS_TEST':
      sourceApiByteIdentical?'P01_FETCH_EXACT_PIN_DIRECTLY_INSTEAD_OF_BRANCH':
      'P01_REPIN_AFTER_API_COMPATIBILITY_REVIEW',
  };
}
export async function observePublicOwnerApiBlobs(){
  const data={};
  for(const path of Object.keys(PINNED_PUBLIC_K02_API_BLOBS)){
    const bytes=await readFile(new URL('../'+path,import.meta.url));
    data[path]=gitBlobSha(bytes);
  }
  return data;
}
// Do not claim Windows build acceptance from a public source-file check.
// An older revision of index.mjs can be ABI identical but still packaged
// incorrectly (wrong binary SHA, CLI flags, U01 profile or Core receipts).
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const pinnedCommit=process.env.K02_PINNED_SOURCE_SHA;
  const observedBranchHead=process.env.GITHUB_SHA;
  const pinnedApiBlobs=PINNED_PUBLIC_K02_API_BLOBS;
  const observedApiBlobs=await observePublicOwnerApiBlobs();
  const report=inspectAgent05SourcePin({
    pinnedCommit,observedBranchHead,pinnedApiBlobs,observedApiBlobs});
  if(!report.sourceApiByteIdentical)
    throw Error('K02_OWNER_PUBLIC_API_CHANGED_REQUALIFY_PIN');
  process.stdout.write('K02_AGENT05_OWNER_SOURCE_PIN '+JSON.stringify(report)+'\n');
}
