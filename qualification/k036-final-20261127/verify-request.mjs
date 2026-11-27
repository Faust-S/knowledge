import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const pins=JSON.parse(readFileSync(new URL('./pins.json',import.meta.url)));
const file='.github/ci-requests/k036-final-20261127.json';
const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
const request=JSON.parse(readFileSync(file,'utf8'));
assert.equal(process.env.GITHUB_REPOSITORY,'Faust-S/knowledge');
assert.equal(process.env.GITHUB_REF,'refs/heads/work/2026-11-25-k036-corporate-event-qualification');
assert.equal(process.env.GITHUB_ACTIONS,'true');
assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
const {prepared,...body}=request;
assert.deepEqual(body,pins);
assert.match(prepared,/^[0-9a-f]{40}$/);
const head=git('rev-parse','HEAD');
assert.equal(head,process.env.GITHUB_SHA);
assert.equal(git('rev-list','--parents','-n','1','HEAD'),head+' '+prepared);
assert.equal(git('diff-tree','--no-commit-id','--name-status','-r','HEAD'),'M\t'+file);
// The earlier core matrix job passed; only the existing native UI job is
// requested again, with the same immutable candidate and owner pins.
const previous=JSON.parse(git('show',prepared+':'+file));
assert.equal(previous.prepared,'636d5dd5be2ee36d170094f4b073d4231bff1f6b');
const {prepared:previousPrepared,...previousBody}=previous;
assert.deepEqual(previousBody,pins);
const event=JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
if(process.env.GITHUB_EVENT_NAME==='push'){
  assert.equal(event.created,false);assert.equal(event.deleted,false);assert.equal(event.forced,false);
  assert.equal(event.before,prepared);assert.equal(event.after,head);assert.equal(event.ref,process.env.GITHUB_REF);
}else assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch');
console.log('K036_EXACT_ONE_SHOT_REQUEST=PASS');
