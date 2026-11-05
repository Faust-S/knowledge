import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256, CONTRACT_VERSION, selectContext, revalidateProjection } from '../index.mjs';
import { fingerprintContextRequest } from '../request-binding.mjs';
import { createDocumentObservationPort } from '../adapters/document-source.mjs';

const native = value => createHash('sha256').update(value).digest('hex');
test('browser-portable hash equals Node SHA-256 for UTF-8 and bytes', () => {
  for(const text of ['', 'hello', 'Документ: версия 2', '🎯 Задача и контекст', '\0\n\t']) {
    assert.equal(sha256(text),native(text));
    assert.equal(sha256(new TextEncoder().encode(text)),native(text));
  }
  assert.equal(CONTRACT_VERSION,'0.2.9');
});
test('canonical request fingerprint remains unchanged by portable hash migration',()=>{
  const req={taskId:'task:fixed',terms:['goal','project'],allowedSources:['doc:one'],
    profile:'planning',allowInferred:false,maxTokens:300,scopeRevision:8};
  const encoded=JSON.stringify([req.taskId,req.terms,req.allowedSources,req.maxTokens,
    req.profile,req.allowInferred,req.scopeRevision]);
  assert.equal(fingerprintContextRequest(req),native('iwxa-k01-context-request-v3\0'+encoded));
});
test('selection and revalidation work when Buffer is unavailable',async()=>{
  const previous=globalThis.Buffer;
  const content='Задача: внедрение поддержки контекста';
  const sourceRef='synthetic:doc';
  const item={id:'one',sourceRef,type:'task',revision:'sha256:'+sha256(content),
    estimatedTokens:20,epistemic:'observed',keywords:['задача'],linePrefix:'Задача:'};
  const request={taskId:'task:browser',terms:['задача'],allowedSources:[sourceRef],
    maxTokens:100,scopeRevision:1};
  const port=createDocumentObservationPort({sourceRef,pinnedItems:[item],readSnapshot:async()=>content});
  try {
    globalThis.Buffer=undefined;
    const projection=await selectContext(request,port);
    assert.equal(projection.selected.length,1);
    assert.equal(projection.selected[0].excerpt,content);
    assert.equal((await revalidateProjection(projection,port,{...request,requireRequestMatch:true})).allCurrent,true);
  } finally {
    globalThis.Buffer=previous;
  }
});
