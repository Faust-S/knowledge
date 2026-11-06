import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compareU02VerifiedReads} from '../k05_u02_verified_reads.mjs';

const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const ownerRoot=process.env.K05_U02_OWNER_ROOT;
async function owner(){
 assert.ok(ownerRoot,'K05_U02_OWNER_ROOT must be a pinned public U02 checkout');
 return import(pathToFileURL(join(resolve(ownerRoot),'u02-source-connectors/port.mjs')).href);
}
async function make(body,{path='notes/meeting.md',provider='OBSIDIAN_V1',
 binding='a'.repeat(64)}={}){
 const api=await owner();
 const identity=sha(JSON.stringify([provider,binding,path]));
 const descriptor=api.sourceDescriptor({providerId:'personal.knowledge',
  sourceRef:'hkw://iwxa-personal-agent/'+identity});
 const checksum=sha(body);
 const observation=api.sourceObservation(descriptor,{
  status:'OK',observedAt:'2026-11-06T12:00:00Z',revision:'sha256:'+checksum,
  contentRef:'sha256:'+checksum,bytes:Buffer.byteLength(body,'utf8'),
  provenance:{provider,bindingDigest:binding,sourcePath:path,
   admission:'SOURCE_ONLY',authority:'OBSERVATION_ONLY'}
 });
 return {
  source:{path,provider_id:provider,sha256:checksum,content:body,
   binding_ref:{provider_id:provider,binding_digest:binding},
   admission_status:'SOURCE_ONLY'},
  observation,pin:api.pinSource(descriptor,observation)
 };
}
test('same pinned host source, unchanged Unicode bytes, zero new reads',async()=>{
 const a=await make('Счёт №6\nСтоимость 9000 🚀');
 const b=await make('Счёт №6\nСтоимость 9000 🚀');
 const api=await owner();
 const result=compareU02VerifiedReads(a,b,api.sourceChange);
 assert.equal(result.status,'CONFIRMED');
 assert.equal(result.sourceRelation,'UNCHANGED');
 assert.equal(result.cost.sourceReadsByK05,0);
 assert.equal(result.cost.bytesRehashed,2*Buffer.byteLength(a.source.content));
 assert.equal(result.cost.humanReviewSeconds,null);
 assert.equal(result.semanticAccuracy,null);
 assert.equal(result.claim,null);
 assert.equal(result.resultReadback,'NOT_TESTED');
 assert.equal(result.taskAccepted,false);
 assert.equal(result.observations[0].revision,'sha256:'+sha(a.source.content));
 assert.ok(!JSON.stringify(result).includes('Счёт'));
});
test('actual source revisions changed within same existing binding',async()=>{
 const first=await make('Price: 9000');
 const second=await make('Price: 9500');
 const api=await owner();
 const result=compareU02VerifiedReads(first,second,api.sourceChange);
 assert.equal(result.status,'CONFIRMED');
 assert.equal(result.sourceRelation,'CHANGED');
 assert.equal(result.observations[1].sha256,sha('Price: 9500'));
 assert.equal(result.cost.sourceReadLatencyMs,null);
});
test('different source path, binding or provider cannot be merged',async()=>{
 const a=await make('same');
 const api=await owner();
 for(const other of [
  await make('same',{path:'notes/other.md'}),
  await make('same',{binding:'b'.repeat(64)}),
  await make('same',{provider:'JOPLIN_V1'})
 ]){
  const result=compareU02VerifiedReads(a,other,api.sourceChange);
  assert.equal(result.status,'NOT_COMPARABLE');
  assert.equal(result.sourceRelation,null);
  assert.equal(result.taskAccepted,false);
 }
});
test('stale content, claimed revision and forged identity fail closed',async()=>{
 const first=await make('A'),api=await owner();
 const altered=structuredClone(first);
 altered.source.content='modified';
 assert.throws(()=>compareU02VerifiedReads(first,altered,api.sourceChange),
  /CONTENT_REVISION_MISMATCH/);
 const forged=structuredClone(first);
 forged.observation.revision='sha256:'+'0'.repeat(64);
 assert.throws(()=>compareU02VerifiedReads(first,forged,api.sourceChange),
  /IDENTITY_MISMATCH/);
 const bound=structuredClone(first);
 bound.source.binding_ref.binding_digest='b'.repeat(64);
 assert.throws(()=>compareU02VerifiedReads(first,bound,api.sourceChange),
  /IDENTITY_MISMATCH/);
});
test('no inferred claim or review from U02 sourceChange; disagreement rejected',async()=>{
 const a=await make('enabled: true'),b=await make('enabled: false');
 const api=await owner();
 const ok=compareU02VerifiedReads(a,b,api.sourceChange);
 assert.equal(ok.semanticAccuracy,null);
 assert.equal(ok.claim,null);
 assert.throws(()=>compareU02VerifiedReads(a,b,()=>({
  status:'UNCHANGED',basis:'SOURCE_REVISION',
  previousRevision:a.observation.revision,currentRevision:b.observation.revision
 })),/OWNER_RELATION_DISAGREEMENT/);
 assert.throws(()=>compareU02VerifiedReads(a,b,undefined),
  /OWNER_SOURCE_CHANGE_REQUIRED/);
});
test('no source access is initiated by K05 and missing snapshot is rejected',async()=>{
 const a=await make('A');
 const api=await owner();
 assert.throws(()=>compareU02VerifiedReads(a,{},api.sourceChange),
  /READ_MISSING/);
});
