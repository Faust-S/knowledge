import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GitHubPublicRestProvider } from '../adapters/github-public-rest.mjs';
import { describeCapabilities, resolveRequirements, InteropError } from '../index.mjs';
import { GIT_INPUT, GIT_OUTPUT } from '../adapters/git-cli.mjs';

const sha = '6d04b82f1b0b614fa22c735075b66f20c1d85f92';
const path = 'solutions/meeting-followup/agent.json';
const bytes = Buffer.from('{"id":"meeting-followup-crewai"}\n', 'utf8');
const blobSha = createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes])).digest('hex');
const metadata = { type: 'file', encoding: 'base64', sha: blobSha, size: bytes.length, content: bytes.toString('base64') };
const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {'Content-Type':'application/json'} });
const error = (code) => e => e instanceof InteropError && e.code === code;
const adapter = (impl) => new GitHubPublicRestProvider({ owner:'Faust-S',repo:'knowledge',fetchImpl:impl });

test('external real HTTP contract adapter: pinned revision, blob validation and output', async () => {
  const calls = [];
  const provider = adapter((url, opts) => {
    calls.push([url,opts]);
    return Promise.resolve(url.endsWith('/knowledge') ? respond({private:false}) : respond(metadata));
  });
  const caps = await describeCapabilities(provider);
  assert.equal(caps.availability,'available');
  const r = resolveRequirements({solutionId:'public-source',requirements:[{
    requirementId:'source',kind:'tool',capabilityId:'source.git.show',inputSchema:GIT_INPUT,
    outputSchema:GIT_OUTPUT,effectClass:'HOST_AUTHORIZED_READ',required:true
  }]},[caps]);
  assert.equal(r.status,'SUPPORTED');
  const result = await provider.invoke('source.git.show',{revision:sha,path},{hostApproved:true});
  assert.equal(result.output.content,bytes.toString('utf8'));
  assert.equal(result.observation.gitBlobSha1,blobSha);
  assert.equal(result.output.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.observation.actualProviderFeeUsd,0);
  assert.match(calls[1][0],new RegExp('/contents/solutions/meeting-followup/agent.json\\?ref='+sha+'$'));
  assert.equal(calls[1][1].redirect,'error');
  assert.equal(calls[1][1].method,'GET');
});

test('negative: inaccessible API, content tampering, invalid revision and authorization',async()=>{
  const denied = adapter(async()=>respond({message:'not found'},404));
  assert.equal((await describeCapabilities(denied)).availability,'unavailable');
  await assert.rejects(denied.invoke('source.git.show',{revision:sha,path},{hostApproved:true}),error('PROVIDER_UNAVAILABLE'));
  const tampered = adapter(async()=>respond({...metadata,content:Buffer.from('edited').toString('base64')}));
  await assert.rejects(tampered.invoke('source.git.show',{revision:sha,path},{hostApproved:true}),error('INVALID_PROVIDER_OUTPUT'));
  const good = adapter(async()=>respond(metadata));
  await assert.rejects(good.invoke('source.git.show',{revision:'main',path},{hostApproved:true}),error('INVALID_SOURCE_REF'));
  await assert.rejects(good.invoke('source.git.show',{revision:sha,path}),error('HOST_APPROVAL_REQUIRED'));
  await assert.rejects(good.invoke('source.git.show',{revision:sha,path:'../AGENTS.md'},{hostApproved:true}),error('INVALID_SOURCE_REF'));
});
test('negative: non-utf8 bytes and invalid base64',async()=>{
  const nonUtf = Buffer.from([0xff]);
  const raw = { type:'file',encoding:'base64',sha:createHash('sha1').update(Buffer.concat([Buffer.from('blob 1\0'),nonUtf])).digest('hex'),size:1,content:nonUtf.toString('base64') };
  await assert.rejects(adapter(async()=>respond(raw)).invoke('source.git.show',{revision:sha,path},{hostApproved:true}),error('INVALID_PROVIDER_OUTPUT'));
  await assert.rejects(adapter(async()=>respond({...metadata,content:'!!'})).invoke('source.git.show',{revision:sha,path},{hostApproved:true}),error('INVALID_PROVIDER_OUTPUT'));
});
