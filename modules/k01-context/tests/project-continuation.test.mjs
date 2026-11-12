import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {prepareProjectContinuation,revalidateProjectContinuation,PROJECT_CONTINUATION_VERSION} from '../integrations/project-continuation.mjs';
import {makeCommercialCase,expectedInitial,expectedUpdated,fields} from './fixtures/commercial-project.mjs';
const value=(p,key)=>p.projection.selected.find(c=>c.id==='field:'+key)?.excerpt??'';
const matching=(p,map)=>Object.entries(map).filter(([key,expected])=>value(p,key).includes(expected)).length;

test('commercial continuation: 18 current fields from history, prices, correspondence and accepted Result',async()=>{
 const host=makeCommercialCase(),p=await prepareProjectContinuation(host.request,host.sourcePort);
 assert.equal(PROJECT_CONTINUATION_VERSION,'0.1.0');
 assert.equal(p.projection.contractVersion,'0.2.9');
 assert.equal(p.covered.length,18);
 assert.equal(p.projection.selected.length,18);
 assert.equal(p.requiredComplete,true);
 assert.equal(matching(p,expectedInitial),Object.keys(expectedInitial).length);
 assert.ok(p.metrics.readCount<host.documents.length);
 assert.equal(p.metrics.relevantSources,7);
 const chosen=p.projection.selected.find(c=>c.id==='field:advance');
 assert.equal(chosen.sourceRef,'doc:payment-decision');
 assert.equal(chosen.evidenceRef,'line:2');
 assert.match(chosen.revision,/^sha256:[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(p.projection).includes('360000 руб.'),false);
 assert.equal(JSON.stringify(p.projection).includes('30%'),false);
 assert.equal(JSON.stringify(p.projection).includes('337330'),false);
 assert.ok(p.issues.some(i=>i.type==='superseded'&&i.fieldKey==='cabinet'));
 assert.ok(p.issues.some(i=>i.type==='pending_change'&&i.fieldKey==='installation'));
});

test('two independent host adapters read the same authorized project reproducibly',async()=>{
 const one=makeCommercialCase(),two=makeCommercialCase();
 const original=two.sourcePort;
 const other={async listSources(args){const item=await original.listSources(args);
  return {scopeRevision:item.scopeRevision,sources:[...item.sources].reverse().map(x=>structuredClone(x))};},
  async readSource(args){return structuredClone(await original.readSource(args));}};
 const a=await prepareProjectContinuation(one.request,one.sourcePort);
 const b=await prepareProjectContinuation(two.request,other);
 assert.deepEqual(a,b);
});

test('same pinned input and host-owned JSON readback reproduce projection byte for byte',async()=>{
 const host=makeCommercialCase();
 const p=await prepareProjectContinuation(host.request,host.sourcePort);
 const q=await prepareProjectContinuation(host.request,host.sourcePort);
 assert.equal(JSON.stringify(p),JSON.stringify(q));
 assert.equal((await revalidateProjectContinuation(JSON.parse(JSON.stringify(p)),
  host.request,host.sourcePort)).allCurrent,true);
});

test('revised accepted quote updates prices but keeps accepted payment percentages',async()=>{
 const oldHost=makeCommercialCase();
 const old=await prepareProjectContinuation(oldHost.request,oldHost.sourcePort);
 const revised=makeCommercialCase({updated:true});
 const change=await revalidateProjectContinuation(old,revised.request,revised.sourcePort);
 assert.equal(change.allCurrent,false);
 assert.deepEqual(change.failures.map(x=>x.reason),['scope_changed']);
 assert.equal(revised.getMetrics().reads,0);
 const latest=await prepareProjectContinuation(revised.request,revised.sourcePort);
 assert.equal(latest.requiredComplete,true);
 assert.equal(matching(latest,expectedUpdated),Object.keys(expectedUpdated).length);
 assert.equal(value(latest,'advance').includes('35%'),true);
 assert.equal(value(latest,'advance').includes('337330'),false);
 assert.equal(value(latest,'net').includes('790000'),false);
 assert.equal(JSON.stringify(latest.projection).includes('337330'),false);
 assert.equal((await revalidateProjectContinuation(latest,revised.request,revised.sourcePort)).allCurrent,true);
});

test('unrelated accepted decisions with conflicting payment terms cause abstention',async()=>{
 const host=makeCommercialCase({addConflict:true});
 const p=await prepareProjectContinuation(host.request,host.sourcePort);
 assert.equal(p.requiredComplete,false);
 assert.equal(value(p,'advance'),'');
 assert.equal(p.projection.selected.length,17);
 assert.ok(p.issues.some(i=>i.fieldKey==='advance'&&i.type==='contradiction'));
 assert.equal(value(p,'cabinet').includes('398000'),true);
});

test('unavailable current quote never permits fallback to obsolete terms',async()=>{
 const host=makeCommercialCase({unavailable:['doc:quote-approved']});
 const p=await prepareProjectContinuation(host.request,host.sourcePort);
 assert.equal(p.requiredComplete,false);
 assert.equal(value(p,'cabinet'),'');
 assert.equal(JSON.stringify(p.projection).includes('360000'),false);
 assert.ok(p.issues.some(i=>i.fieldKey==='cabinet'&&i.type==='source_unavailable'));
});

test('an unreadable fully superseded source does not invalidate newer accepted terms',async()=>{
 const host=makeCommercialCase({unavailable:['doc:quote-old']});
 const p=await prepareProjectContinuation(host.request,host.sourcePort);
 assert.equal(p.requiredComplete,true);
 assert.equal(value(p,'cabinet').includes('398000'),true);
});

test('Workspace change is refused without source reads',async()=>{
 const host=makeCommercialCase(),p=await prepareProjectContinuation(host.request,host.sourcePort);
 const another=makeCommercialCase({workspace:'commercial:unrelated'});
 const before=another.getMetrics();
 const r=await revalidateProjectContinuation(p,another.request,another.sourcePort);
 assert.deepEqual(r.failures.map(x=>x.reason),['workspace_changed']);
 assert.deepEqual(another.getMetrics(),before);
});

test('Task change cannot reuse previous context',async()=>{
 const host=makeCommercialCase(),p=await prepareProjectContinuation(host.request,host.sourcePort);
 const r=await revalidateProjectContinuation(p,
  {...host.request,taskId:'task:another'},host.sourcePort);
 assert.deepEqual(r.failures.map(x=>x.reason),['task_changed']);
});

test('scope revision mismatch rejects selection before private bytes',async()=>{
 const host=makeCommercialCase();
 await assert.rejects(prepareProjectContinuation(
  {...host.request,scopeRevision:'workspace:unexpected'},host.sourcePort),
  /WORKSPACE_REVISION_CHANGED/);
 assert.equal(host.getMetrics().reads,0);
});

test('source roster drift during selection is detected by the second catalog read',async()=>{
 const host=makeCommercialCase();let listNumber=0;
 const port={...host.sourcePort,async listSources(args){
  const result=await host.sourcePort.listSources(args);listNumber++;
  return listNumber===2?{...result,sources:result.sources.slice(1)}:result;}};
 await assert.rejects(prepareProjectContinuation(host.request,port),
  /CATALOG_CHANGED_DURING_SELECTION/);
});

test('unapproved and unrelated historical Results are never read',async()=>{
 const host=makeCommercialCase();
 const narrowed={...host.request,allowedSources:['doc:request','doc:meeting','result:engineering-review']};
 const p=await prepareProjectContinuation(narrowed,host.sourcePort);
 assert.equal(p.requiredComplete,false);
 assert.equal(p.projection.selected.length,6);
 assert.equal(p.metrics.readCount,3);
 assert.equal(JSON.stringify(p).includes('Исторический аванс'),false);
});

test('small token budget reports omissions without truncating or inventing facts',async()=>{
 const host=makeCommercialCase();
 const p=await prepareProjectContinuation({...host.request,maxTokens:65},host.sourcePort);
 assert.equal(p.requiredComplete,false);
 assert.ok(p.projection.omissions.some(i=>i.reason==='budget_exceeded'));
 assert.ok(p.issues.some(i=>i.type==='budget_exceeded'));
 assert.ok(p.projection.estimatedTokens<=65);
});

test('content modified under pinned revision cannot be admitted',async()=>{
 const host=makeCommercialCase(),source=host.sourcePort;
 const changed={...source,async readSource(args){const item=await source.readSource(args);
  return args.sourceRef==='doc:quote-approved'?{...item,content:item.content.replace('398000','777777')}:item;}};
 const p=await prepareProjectContinuation(host.request,changed);
 assert.equal(value(p,'cabinet'),'');
 assert.ok(p.issues.some(i=>i.fieldKey==='cabinet'&&i.type==='source_unavailable'));
});

test('ambiguous document content is rejected instead of using the first match',async()=>{
 const host=makeCommercialCase(),source=host.sourcePort;
 const damaged={...source,async readSource(args){const item=await source.readSource(args);
  return args.sourceRef==='doc:meeting'?{...item,content:item.content+'\nГарантия: 18 месяцев.'}:item;}};
 const p=await prepareProjectContinuation(host.request,damaged);
 assert.equal(value(p,'warranty'),'');
 assert.ok(p.issues.some(i=>i.fieldKey==='warranty'&&i.type==='source_unavailable'));
});

test('fair full-read and direct-search baselines measure actual host reads and stale lines',async()=>{
 const baseline=makeCommercialCase();
 const t0=performance.now();
 const catalog=await baseline.sourcePort.listSources({
  taskId:baseline.request.taskId,workspaceRef:baseline.request.workspaceRef,
  allowedSources:baseline.request.allowedSources
 });
 const contents=[];
 for(const item of catalog.sources) {
  const snapshot=await baseline.sourcePort.readSource({sourceRef:item.sourceRef,
   requestedRevision:item.revision,workspaceRef:baseline.request.workspaceRef});
  assert.equal(snapshot.complete,true);
  contents.push(snapshot.content);
 }
 const fullReadMs=performance.now()-t0;
 const raw=contents.join('\n'),baselineBytes=Buffer.byteLength(raw);
 const t1=performance.now(),lines=raw.split(/\r?\n/);
 const naive=fields.map(field=>({key:field.key,
  lines:lines.filter(line=>field.labels.some(label=>
   line.toLocaleLowerCase('ru-RU').includes(label.toLocaleLowerCase('ru-RU')+':')))}));
 const searchMs=performance.now()-t1;
 const host=makeCommercialCase(),t2=performance.now();
 const p=await prepareProjectContinuation(host.request,host.sourcePort);
 const k01Ms=performance.now()-t2;
 const selectedBytes=Buffer.byteLength(p.projection.selected.map(e=>e.excerpt).join('\n'));
 const stats={case:'commercial-conditions-change',fields:fields.length,
  baselineFullReadBytes:baselineBytes,baselineReads:baseline.getMetrics().reads,
  baselineFullReadMs:Number(fullReadMs.toFixed(3)),
  baselineDirectSearchMs:Number(searchMs.toFixed(3)),
  baselineExtraVersions:naive.reduce((sum,r)=>sum+Math.max(0,r.lines.length-1),0),
  k01ReadBytes:p.metrics.readBytes,k01Reads:p.metrics.readCount,
  k01ProjectionPayloadBytes:selectedBytes,
  k01SerializedProjectionBytes:p.metrics.projectionBytes,
  k01ElapsedMs:Number(k01Ms.toFixed(3)),k01Coverage:p.covered.length,
  k01StaleSelected:p.projection.selected.filter(e=>e.sourceRef==='doc:quote-old').length};
 console.log('K01_CONTINUATION_BENCH '+JSON.stringify(stats));
 assert.equal(stats.k01Coverage,18);
 assert.ok(stats.baselineExtraVersions>=6);
 assert.equal(stats.k01StaleSelected,0);
 assert.ok(stats.k01Reads<stats.baselineReads);
 assert.ok(stats.k01ReadBytes<stats.baselineFullReadBytes);
 assert.ok(stats.k01ProjectionPayloadBytes<stats.baselineFullReadBytes);
 assert.ok(Number.isFinite(k01Ms));
});
