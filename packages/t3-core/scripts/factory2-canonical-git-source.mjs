/** The canonical Git commit/tree is the source, never an owner ZIP surrogate. */
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {realpathSync} from 'node:fs';

const SHA=/^[0-9a-f]{40}$/;
const BRANCH=/^(?!-)(?!.*\.\.)(?!.*\/\.)(?!.*\.lock(?:\/|$))[-A-Za-z0-9._/]+$/;
const fail=code=>{throw new Error('FACTORY2_GIT_'+code);};
function git(root,...args){
 try{return execFileSync('git',['-C',root,...args],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']}).trim();}
 catch{fail('EXECUTION_FAILED:'+args[0]);}
}
function fingerprint(subject){
 return createHash('sha256').update('IWXA_T2_CANONICAL_GIT_SUBJECT_V1\n'+
   [subject.remote,subject.branch,subject.head,subject.tree].join('\n')+'\n','utf8').digest('hex');
}
export function canonicalGitSourceFingerprint(subject){
 if(!subject||typeof subject!=='object'||Array.isArray(subject)||
    typeof subject.remote!=='string'||!subject.remote.trim()||
    typeof subject.branch!=='string'||!BRANCH.test(subject.branch)||
    !SHA.test(subject.head)||!SHA.test(subject.tree))fail('SOURCE_IDENTITY_INVALID');
 return fingerprint(subject);
}
/** Fetch is performed only at init; later phases pin the exact immutable HEAD/TREE. */
export function inspectCanonicalGitSource(checkout,{fetchRemote=false}={}){
 if(typeof checkout!=='string'||!checkout.trim())fail('CHECKOUT_REQUIRED');
 const root=realpathSync(checkout);
 if(git(root,'status','--porcelain','--untracked-files=all'))fail('SOURCE_DIRTY');
 const branch=git(root,'symbolic-ref','--quiet','--short','HEAD');
 if(!BRANCH.test(branch))fail('BRANCH_INVALID');
 const remote=git(root,'remote','get-url','origin');
 if(!remote)fail('REMOTE_REQUIRED');
 const head=git(root,'rev-parse','HEAD'),tree=git(root,'rev-parse','HEAD^{tree}');
 if(!SHA.test(head)||!SHA.test(tree))fail('SOURCE_COMMIT_INVALID');
 if(fetchRemote){
   git(root,'fetch','--no-tags','origin','refs/heads/'+branch);
   if(git(root,'rev-parse','FETCH_HEAD')!==head||git(root,'rev-parse','FETCH_HEAD^{tree}')!==tree)
     fail('REMOTE_SUBJECT_MISMATCH');
 }
 const subject=Object.freeze({remote,branch,head,tree});
 return Object.freeze({subject,sourceSha256:fingerprint(subject)});
}
export function verifyCanonicalGitSource(checkout,subject,expectedSha256){
 if(canonicalGitSourceFingerprint(subject)!==expectedSha256)fail('SUBJECT_DIGEST_CHANGED');
 const observed=inspectCanonicalGitSource(checkout);
 for(const key of ['remote','branch','head','tree']){
   if(observed.subject[key]!==subject[key])fail('SOURCE_CHANGED:'+key);
 }
 return observed;
}

// A transformed domain is allowed to advance after intake, but the original
// remote/branch/commit/tree must remain in its published Git ancestry.
// This never grants source-truth or write authority.
export function verifyCanonicalGitDescendant(checkout,baselineSubject,baselineSha256,{fetchRemote=false}={}){
 if(canonicalGitSourceFingerprint(baselineSubject)!==baselineSha256)fail('SUBJECT_DIGEST_CHANGED');
 const current=inspectCanonicalGitSource(checkout,{fetchRemote});
 if(current.subject.remote!==baselineSubject.remote)fail('SOURCE_CHANGED:remote');
 if(current.subject.branch!==baselineSubject.branch)fail('SOURCE_CHANGED:branch');
 const root=realpathSync(checkout);
 if(git(root,'rev-parse',baselineSubject.head+'^{tree}')!==baselineSubject.tree)
   fail('BASELINE_TREE_CHANGED');
 const ancestry=spawnSync('git',['-C',root,'merge-base','--is-ancestor',baselineSubject.head,current.subject.head],
   {stdio:'ignore',timeout:30000});
 if(ancestry.error||ancestry.status!==0)fail('NON_FAST_FORWARD_HISTORY');
 return Object.freeze({baseline:baselineSubject,current:current.subject,sourceSha256:baselineSha256});
}
