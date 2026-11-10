import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {inspectCanonicalGitSource,verifyCanonicalGitSource,verifyCanonicalGitDescendant,canonicalGitSourceFingerprint} from '../scripts/factory2-canonical-git-source.mjs';
import {initFactory2SiteRun,evaluateFactory2DomainRun} from '../scripts/factory2-domain-run-cli.mjs';
const run=(cwd,...cmd)=>execFileSync('git',cmd,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function fixture(){
 const base=mkdtempSync(join(tmpdir(),'factory2-git-')),remote=join(base,'remote.git'),working=join(base,'domain');
 mkdirSync(working);
 run(base,'init','--bare','-q',remote);
 run(working,'init','-q');run(working,'checkout','-b','work/d11');
 run(working,'config','user.name','Test');run(working,'config','user.email','test@example.invalid');
 writeFileSync(join(working,'subject.txt'),'source');
 run(working,'add','.');run(working,'commit','-qm','source');
 run(working,'remote','add','origin',remote);run(working,'push','-q','-u','origin','work/d11');
 return {base,remote,working};
}
test('exact Git checkout is accepted without ZIP and does not grant authority',()=>{
 const f=fixture();const one=inspectCanonicalGitSource(f.working,{fetchRemote:true});
 assert.equal(one.subject.branch,'work/d11');assert.equal(one.sourceSha256.length,64);
 assert.deepEqual(verifyCanonicalGitSource(f.working,one.subject,one.sourceSha256),one);
 assert.equal(canonicalGitSourceFingerprint(one.subject),one.sourceSha256);
});
test('rejects modified working tree before or after source selection',()=>{
 const f=fixture(),s=inspectCanonicalGitSource(f.working);
 writeFileSync(join(f.working,'subject.txt'),'changed');
 assert.throws(()=>inspectCanonicalGitSource(f.working),/SOURCE_DIRTY/);
 assert.throws(()=>verifyCanonicalGitSource(f.working,s.subject,s.sourceSha256),/SOURCE_DIRTY/);
});
test('rejects commit mismatch and corrupted subject digest',()=>{
 const f=fixture(),s=inspectCanonicalGitSource(f.working);
 assert.throws(()=>verifyCanonicalGitSource(f.working,{...s.subject,tree:'0'.repeat(40)},s.sourceSha256),/SUBJECT_DIGEST_CHANGED/);
 assert.throws(()=>verifyCanonicalGitSource(f.working,s.subject,'0'.repeat(64)),/SUBJECT_DIGEST_CHANGED/);
 writeFileSync(join(f.working,'new.txt'),'new');run(f.working,'add','.');run(f.working,'commit','-qm','changed');
 assert.throws(()=>verifyCanonicalGitSource(f.working,s.subject,s.sourceSha256),/SOURCE_CHANGED:head/);
});
test('fetch-based init rejects non-published working HEAD',()=>{
 const f=fixture();writeFileSync(join(f.working,'new.txt'),'new');run(f.working,'add','.');run(f.working,'commit','-qm','not pushed');
 assert.throws(()=>inspectCanonicalGitSource(f.working,{fetchRemote:true}),/REMOTE_SUBJECT_MISMATCH/);
});

test('Factory intake uses only site Git and rejects dirty site changes',()=>{
 const site=fixture(),out=join(site.base,'t2-run');
 const state=initFactory2SiteRun({siteCheckout:site.working,domainId:'D13',out});
 assert.equal(state.sourceGit,null);
 assert.equal(state.siteGit.subject.head,run(site.working,'rev-parse','HEAD'));
 writeFileSync(join(site.working,'unpublished.txt'),'changed');
 assert.throws(()=>evaluateFactory2DomainRun(out),/SOURCE_DIRTY/);
});

test('published fast-forward successors keep initial Git provenance',()=>{
 const f=fixture(),base=inspectCanonicalGitSource(f.working,{fetchRemote:true});
 writeFileSync(join(f.working,'product.txt'),'implemented');
 run(f.working,'add','.');run(f.working,'commit','-qm','implement product');
 run(f.working,'push','-q','origin','work/d11');
 const next=verifyCanonicalGitDescendant(f.working,base.subject,base.sourceSha256,{fetchRemote:true});
 assert.notEqual(next.current.head,base.subject.head);
 assert.equal(next.baseline.head,base.subject.head);
});
test('unpublished successor cannot qualify and branch replacement is rejected',()=>{
 const f=fixture(),base=inspectCanonicalGitSource(f.working,{fetchRemote:true});
 writeFileSync(join(f.working,'change.txt'),'unpublished');
 run(f.working,'add','.');run(f.working,'commit','-qm','unpublished');
 assert.throws(()=>verifyCanonicalGitDescendant(f.working,base.subject,base.sourceSha256,{fetchRemote:true}),/REMOTE_SUBJECT_MISMATCH/);
 run(f.working,'checkout','--orphan','replacement');
 writeFileSync(join(f.working,'replacement.txt'),'replacement');
 run(f.working,'add','.');run(f.working,'commit','-qm','replacement');
 run(f.working,'branch','-D','work/d11');
 run(f.working,'branch','-m','work/d11');
 assert.throws(()=>verifyCanonicalGitDescendant(f.working,base.subject,base.sourceSha256),/NON_FAST_FORWARD_HISTORY/);
});

test('site-only intake rejects unpublished successor before engineering',()=>{
 const site=fixture(),out=join(site.base,'site-run');
 initFactory2SiteRun({siteCheckout:site.working,domainId:'D13',out});
 writeFileSync(join(site.working,'development.txt'),'local development');
 run(site.working,'add','.');run(site.working,'commit','-qm','not published');
 assert.throws(()=>evaluateFactory2DomainRun(out),/REMOTE_SUBJECT_MISMATCH/);
 run(site.working,'push','-q','origin','work/d11');
 assert.throws(()=>evaluateFactory2DomainRun(out),{code:'ENOENT'});
});
test('site-only intake rejects run output inside site',()=>{
 const site=fixture();
 assert.throws(()=>initFactory2SiteRun({siteCheckout:site.working,domainId:'D13',
   out:join(site.working,'nested','run')}),/OUTPUT_INSIDE_SOURCE/);
 assert.equal(run(site.working,'status','--porcelain'),'');
});
