import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {sha256} from '../index.mjs';
import {prepareProjectContinuation,revalidateProjectContinuation,refreshProjectContinuation,PROJECT_CONTINUATION_VERSION,PROJECT_REFRESH_VERSION} from '../integrations/project-continuation.mjs';
import {makeCommercialCase,expectedInitial,expectedUpdated,fields} from './fixtures/commercial-project.mjs';
const value=(p,key)=>p.projection.selected.find(c=>c.id==='field:'+key)?.excerpt??'';
const matching=(p,map)=>Object.entries(map).filter(([key,expected])=>value(p,key).includes(expected)).length;

test('commercial continuation: 18 current fields from history, prices, correspondence and accepted Result',async()=>{
 const host=makeCommercialCase(),p=await prepareProjectContinuation(host.request,host.sourcePort);
 assert.equal(PROJECT_CONTINUATION_VERSION,'0.1.1');
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

test('two matching labels in one correctly pinned document are ambiguous',async()=>{
 const host=makeCommercialCase();
 const base=host.sourcePort;
 let revised;
 const port={
  async listSources(args){
   const catalog=await base.listSources(args);
   const original=catalog.sources.find(s=>s.sourceRef==='doc:meeting');
   const snapshot=await base.readSource({sourceRef:original.sourceRef,
    requestedRevision:original.revision,workspaceRef:host.request.workspaceRef});
   revised={content:snapshot.content+'\nГарантия: 18 месяцев.',
    revision:'sha256:'+sha256(snapshot.content+'\nГарантия: 18 месяцев.')};
   return {scopeRevision:'workspace:4',sources:catalog.sources.map(x=>
    x.sourceRef==='doc:meeting'?{...x,revision:revised.revision}:x)};
  },
  async readSource(args){
   return args.sourceRef==='doc:meeting'
    ? {complete:true,...revised}:base.readSource(args);
  }
 };
 const p=await prepareProjectContinuation({...host.request,scopeRevision:'workspace:4'},port);
 assert.equal(value(p,'warranty'),'');
 assert.equal(p.requiredComplete,false);
 assert.ok(p.issues.some(i=>i.type==='ambiguous_lines'&&i.fieldKey==='warranty'));
});

test('consumer can prepare the updated commercial arithmetic from selected current facts',async()=>{
 const host=makeCommercialCase({updated:true});
 const p=await prepareProjectContinuation(host.request,host.sourcePort);
 const amount=key=>Number(value(p,key).match(/:\s*(\d+)\s*руб\./)?.[1]);
 const percentage=key=>Number(value(p,key).match(/:\s*(\d+)%/)?.[1]);
 const parts=['cabinet','sensors','installation','commissioning','freight'].map(amount);
 const net=parts.reduce((sum,x)=>sum+x,0);
 const vat=percentage('vat');
 const gross=net*(100+vat)/100;
 const advance=Math.round(gross*percentage('advance')/100);
 const balance=Math.round(gross*percentage('balance')/100);
 assert.deepEqual({net,gross,advance,balance,vat},
  {net:812000,gross:990640,advance:346724,balance:643916,vat:22});
 assert.equal(net,amount('net'));
 assert.equal(gross,amount('gross'));
 assert.equal(advance+balance,gross);
 assert.ok(p.projection.selected.some(x=>x.sourceRef==='result:engineering-review'));
 assert.equal(JSON.stringify(p.projection).includes('337330'),false);
 assert.equal(p.projection.selected.length,18);
});

test('two-cell Markdown price tables retain exact line provenance',async()=>{
 const host=makeCommercialCase(),original=host.sourcePort;
 const port={
  async listSources(args){
   const catalog=await original.listSources(args);
   const quote=await original.readSource({sourceRef:'doc:quote-approved'});
   const content=quote.content.replace('Шкафы управления: 398000 руб.',
    '| Шкафы управления | 398000 руб. |');
   const revision='sha256:'+sha256(content);
   return {scopeRevision:'workspace:tables',sources:catalog.sources.map(x=>
    x.sourceRef==='doc:quote-approved'?{...x,revision}:x)};
  },
  async readSource(args){
   const result=await original.readSource(args);
   return args.sourceRef==='doc:quote-approved'
    ? {complete:true,content:result.content.replace('Шкафы управления: 398000 руб.',
       '| Шкафы управления | 398000 руб. |'),
       revision:'sha256:'+sha256(result.content.replace('Шкафы управления: 398000 руб.',
        '| Шкафы управления | 398000 руб. |'))}:result;
  }
 };
 const p=await prepareProjectContinuation({...host.request,scopeRevision:'workspace:tables'},port);
 assert.equal(p.requiredComplete,true);
 const selected=p.projection.selected.find(x=>x.id==='field:cabinet');
 assert.equal(selected.excerpt,'| Шкафы управления | 398000 руб. |');
 assert.equal(selected.evidenceRef,'line:2');
 assert.equal(selected.sha256,sha256(selected.excerpt));
});

test('source revision change is caught even if host omitted scope advance',async()=>{
 const host=makeCommercialCase(),previous=await prepareProjectContinuation(host.request,host.sourcePort);
 const original=host.sourcePort;
 const patched='Шкафы управления: 400000 руб.';
 const port={
  async listSources(args){
   const catalog=await original.listSources(args);
   const quote=await original.readSource({sourceRef:'doc:quote-approved'});
   const content=quote.content.replace('Шкафы управления: 398000 руб.',patched);
   return {...catalog,sources:catalog.sources.map(x=>x.sourceRef==='doc:quote-approved'
    ? {...x,revision:'sha256:'+sha256(content)}:x)};
  },
  async readSource(args){
   const result=await original.readSource(args);
   if(args.sourceRef!=='doc:quote-approved')return result;
   const content=result.content.replace('Шкафы управления: 398000 руб.',patched);
   return {complete:true,content,revision:'sha256:'+sha256(content)};
  }
 };
 const checked=await revalidateProjectContinuation(previous,host.request,port);
 assert.equal(checked.allCurrent,false);
 assert.deepEqual(checked.failures.map(x=>x.reason),['catalog_changed']);
});


test('field-label and required-flag changes reject saved context before any host IO',async()=>{
 const host=makeCommercialCase();
 const saved=await prepareProjectContinuation(host.request,host.sourcePort);
 assert.match(saved.catalogBinding,/^[a-f0-9]{64}$/);
 const fields=host.request.fields.map(f=>f.key==='cabinet'?
  {...f,labels:[...f.labels,'Альтернативное название шкафа'],required:false}:f);
 const before=host.getMetrics();
 const check=await revalidateProjectContinuation(saved,{...host.request,fields},host.sourcePort);
 assert.equal(check.allCurrent,false);
 assert.deepEqual(check.failures.map(f=>f.reason),['request_mismatch']);
 assert.deepEqual(host.getMetrics(),before,'no host reads on changed Task field intent');
});

test('source permission changes reject saved context without reading documents',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const before=host.getMetrics();
 const allowedSources=host.request.allowedSources.filter(x=>x!=='doc:procurement');
 const result=await revalidateProjectContinuation(saved,{...host.request,allowedSources},host.sourcePort);
 assert.deepEqual(result.failures.map(f=>f.reason),['request_mismatch']);
 assert.deepEqual(host.getMetrics(),before);
});

test('updated unapproved correspondence invalidates catalog even when accepted facts stay identical',async()=>{
 const host=makeCommercialCase();
 const saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const original=host.sourcePort;
 const sourceRef='mail:proposed-discount';
 const first=await original.readSource({sourceRef});
 const changed=first.content.replace('102000 руб.','110000 руб.');
 assert.notEqual(changed,first.content);
 const revision='sha256:'+sha256(changed);
 const port={
  async listSources(args){
   const current=await original.listSources(args);
   return {...current,sources:current.sources.map(x=>x.sourceRef===sourceRef?{...x,revision}:x)};
  },
  async readSource(args){
   if(args.sourceRef===sourceRef)return {complete:true,revision,content:changed};
   return original.readSource(args);
  }
 };
 const fresh=await prepareProjectContinuation(host.request,port);
 assert.deepEqual(fresh.projection.selected,saved.projection.selected);
 assert.deepEqual(fresh.issues,saved.issues);
 assert.notEqual(fresh.catalogBinding,saved.catalogBinding);
 const check=await revalidateProjectContinuation(saved,host.request,port);
 assert.equal(check.allCurrent,false);
 assert.deepEqual(check.failures.map(f=>f.reason),['catalog_changed']);
});

test('mutating a nested signed decision relation during read must not rewrite the first catalog',async()=>{
 const host=makeCommercialCase(),original=host.sourcePort;
 let mutated=false;
 const port={
  async listSources(args){return original.listSources(args);},
  async readSource(args){
   if(!mutated){
    mutated=true;
    const catalog=await original.listSources({});
    const signed=catalog.sources.find(x=>x.sourceRef==='doc:payment-decision');
    assert.deepEqual(signed.supersedes[0].fields,['advance','balance']);
    signed.supersedes[0].fields.pop();
   }
   return original.readSource(args);
  }
 };
 await assert.rejects(prepareProjectContinuation(host.request,port),
  /K01_CONTINUATION_CATALOG_CHANGED_DURING_SELECTION/);
});

test('legacy or stripped continuation evidence cannot be revalidated as the new contract',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const before=host.getMetrics();
 const missing={...saved};delete missing.catalogBinding;
 await assert.rejects(revalidateProjectContinuation(missing,host.request,host.sourcePort),
  /K01_CONTINUATION_PREVIOUS_INVALID/);
 assert.deepEqual(host.getMetrics(),before);
});

test('canonical source ordering and supersedes list ordering do not create false drift',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const original=host.sourcePort;
 const shuffled={
  async listSources(args){
   const item=await original.listSources(args);
   return {...item,sources:item.sources.reverse().map(row=>({...row,
    supersedes:[...row.supersedes].reverse(),topics:[...row.topics].reverse()}))};
  },
  async readSource(args){return original.readSource(args);}
 };
 const result=await revalidateProjectContinuation(saved,host.request,shuffled);
 assert.equal(result.allCurrent,true);
 assert.deepEqual(result.failures,[]);
});


test('unavailable unapproved offer does not erase a confirmed signed installation price',async()=>{
 const host=makeCommercialCase({unavailable:['mail:proposed-discount']});
 const p=await prepareProjectContinuation(host.request,host.sourcePort);
 assert.equal(p.requiredComplete,true);
 assert.equal(p.covered.length,18);
 assert.match(value(p,'installation'),/105000 руб/);
 assert.match(value(p,'advance'),/35%/);
 assert.ok(p.issues.some(i=>i.type==='proposal_unavailable'&&i.fieldKey==='installation'&&
  i.sources.includes('mail:proposed-discount')));
 assert.ok(p.issues.some(i=>i.type==='proposal_unavailable'&&i.fieldKey==='advance'));
 assert.equal(p.issues.some(i=>i.type==='source_unavailable'),false);
});

test('loss of a previously seen proposed source invalidates the saved context without stale substitution',async()=>{
 const base=makeCommercialCase(),prior=await prepareProjectContinuation(base.request,base.sourcePort);
 const now=makeCommercialCase({unavailable:['mail:proposed-discount']});
 const result=await revalidateProjectContinuation(prior,now.request,now.sourcePort);
 assert.equal(result.allCurrent,false);
 assert.deepEqual(result.failures.map(f=>f.reason),['context_changed']);
 const fresh=await prepareProjectContinuation(now.request,now.sourcePort);
 assert.equal(fresh.requiredComplete,true);
 assert.equal(fresh.issues.some(i=>i.type==='proposal_unavailable'),true);
 assert.equal(JSON.stringify(fresh.projection).includes('30%'),false);
});


test('test projects never share writable nested supersedes metadata',async()=>{
 const one=makeCommercialCase(),two=makeCommercialCase();
 const oneMeta=await one.sourcePort.listSources({});
 const relation=oneMeta.sources.find(x=>x.sourceRef==='doc:payment-decision').supersedes[0];
 assert.deepEqual(relation.fields,['advance','balance']);
 relation.fields.pop();
 const twoMeta=await two.sourcePort.listSources({});
 assert.deepEqual(twoMeta.sources.find(x=>x.sourceRef==='doc:payment-decision').supersedes[0].fields,
  ['advance','balance']);
});


test('published K01 package subpath resolves the continuation API for independent consumers',async()=>{
 const api=await import('@iwxa/k01-context/project-continuation');
 assert.equal(api.PROJECT_CONTINUATION_VERSION,PROJECT_CONTINUATION_VERSION);
 assert.equal(api.prepareProjectContinuation,prepareProjectContinuation);
 assert.equal(api.revalidateProjectContinuation,revalidateProjectContinuation);
});


test('refresh reopens revised commercial project, reports exactly changed fields in one read pass',async()=>{
 const original=makeCommercialCase(),saved=await prepareProjectContinuation(original.request,original.sourcePort);
 const next=makeCommercialCase({updated:true});
 const r=await refreshProjectContinuation(JSON.parse(JSON.stringify(saved)),next.request,next.sourcePort);
 assert.equal(PROJECT_REFRESH_VERSION,'0.1.0');
 assert.equal(r.contractVersion,'0.1.0');
 assert.equal(r.status,'UPDATED');
 assert.equal(r.reusable,false);
 assert.equal(r.requiresReview,true);
 assert.equal(r.reason,null);
 assert.equal(r.latest.requiredComplete,true);
 assert.equal(r.latest.covered.length,18);
 assert.deepEqual(r.fieldChanges.map(x=>x.fieldKey).sort(),['cabinet','freight','gross','lead','net','sensors','validity']);
 assert.ok(r.fieldChanges.every(x=>x.kinds.includes('VALUE_CHANGED')&&x.kinds.includes('SOURCE_CHANGED')));
 assert.ok(r.sourceChanges.some(x=>x.sourceRef==='doc:quote-revised'&&x.kind==='SOURCE_ADDED'));
 assert.match(r.latest.projection.selected.find(x=>x.id==='field:gross').excerpt,/990640/);
 assert.match(r.latest.projection.selected.find(x=>x.id==='field:advance').excerpt,/35%/);
 assert.equal(next.getMetrics().reads,r.latest.metrics.readCount);
 assert.equal(next.getMetrics().lists,2,'no duplicate read for a separate revalidation');
 assert.equal(JSON.stringify(r.fieldChanges).includes('963800 руб'),false,
  'change summary references revisions; no duplicate source excerpt payload');
});

test('refresh of unchanged accepted project is reusable but does not grant Task authority',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const repeat=makeCommercialCase();
 const result=await refreshProjectContinuation(saved,repeat.request,repeat.sourcePort);
 assert.equal(result.status,'CURRENT');
 assert.equal(result.reusable,true);
 assert.equal(result.requiresReview,false);
 assert.equal(result.catalogChanged,false);
 assert.deepEqual(result.fieldChanges,[]);
 assert.deepEqual(result.sourceChanges,[]);
 assert.deepEqual(result.issueChanges,{appeared:[],resolved:[]});
 assert.equal(result.latest.requiredComplete,true);
 assert.equal(repeat.getMetrics().lists,2);
});

test('changed unapproved correspondence is shown even if accepted facts stay identical',async()=>{
 const host=makeCommercialCase(),original=host.sourcePort;
 const saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const sourceRef='mail:proposed-discount';
 const first=await original.readSource({sourceRef});
 const modified=first.content.replace('102000 руб.','108000 руб.');
 const revision='sha256:'+sha256(modified);
 const current={
  async listSources(args){
   const roster=await original.listSources(args);
   return {...roster,sources:roster.sources.map(s=>s.sourceRef===sourceRef?{...s,revision}:s)};
  },
  async readSource(args){
   return args.sourceRef===sourceRef?{revision,complete:true,content:modified}:original.readSource(args);
  }
 };
 const r=await refreshProjectContinuation(saved,host.request,current);
 assert.equal(r.status,'UPDATED');
 assert.equal(r.catalogChanged,true);
 assert.deepEqual(r.fieldChanges,[]);
 assert.deepEqual(r.sourceChanges.filter(s=>s.sourceRef===sourceRef).map(s=>s.kind),['SOURCE_REVISED']);
 assert.equal(r.latest.requiredComplete,true);
 assert.equal(r.reusable,false);
});

test('contradictory accepted decision becomes review-blocking while retaining 17 other facts',async()=>{
 const original=makeCommercialCase(),prior=await prepareProjectContinuation(original.request,original.sourcePort);
 const now=makeCommercialCase({addConflict:true});
 const result=await refreshProjectContinuation(prior,now.request,now.sourcePort);
 assert.equal(result.status,'INCOMPLETE');
 assert.equal(result.reusable,false);
 assert.equal(result.requiresReview,true);
 assert.equal(result.latest.requiredComplete,false);
 assert.equal(result.latest.projection.selected.length,17);
 assert.deepEqual(result.fieldChanges.filter(x=>x.fieldKey==='advance').map(x=>x.kinds),[['UNAVAILABLE']]);
 assert.ok(result.issueChanges.appeared.some(x=>x.type==='contradiction'&&x.fieldKey==='advance'));
 assert.equal(result.latest.projection.selected.some(x=>x.id==='field:advance'),false);
});

test('unavailable accepted source never falls back to a superseded historical price',async()=>{
 const host=makeCommercialCase(),old=await prepareProjectContinuation(host.request,host.sourcePort);
 const now=makeCommercialCase({unavailable:['doc:quote-approved']});
 const r=await refreshProjectContinuation(old,now.request,now.sourcePort);
 assert.equal(r.status,'INCOMPLETE');
 assert.equal(r.latest.requiredComplete,false);
 assert.ok(r.fieldChanges.some(x=>x.fieldKey==='cabinet'&&x.kinds.includes('UNAVAILABLE')));
 assert.ok(r.latest.issues.some(x=>x.fieldKey==='cabinet'&&x.type==='source_unavailable'));
 assert.equal(JSON.stringify(r.latest.projection).includes('360000 руб'),false);
 assert.equal(JSON.stringify(r.fieldChanges).includes('398000 руб'),false);
});

test('unavailable proposal retains signed terms but explicitly changes issue list',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const later=makeCommercialCase({unavailable:['mail:proposed-discount']});
 const r=await refreshProjectContinuation(saved,later.request,later.sourcePort);
 assert.equal(r.status,'UPDATED');
 assert.equal(r.latest.requiredComplete,true);
 assert.deepEqual(r.fieldChanges,[]);
 assert.ok(r.issueChanges.appeared.some(x=>x.type==='proposal_unavailable'));
 assert.ok(r.issueChanges.resolved.some(x=>x.type==='pending_change'));
});

test('permission revoked blocks comparison before any source or roster read',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const now=makeCommercialCase();
 const before=now.getMetrics();
 const restricted={...now.request,allowedSources:now.request.allowedSources.filter(x=>x!=='doc:quote-approved')};
 const r=await refreshProjectContinuation(saved,restricted,now.sourcePort);
 assert.equal(r.status,'REJECTED');
 assert.equal(r.reason,'permissions_changed');
 assert.equal(r.latest,null);
 assert.deepEqual(r.fieldChanges,[]);
 assert.deepEqual(now.getMetrics(),before);
});

test('changed field semantics cannot reuse old project evidence or read the host',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const next=makeCommercialCase(),before=next.getMetrics();
 const fields=next.request.fields.map(x=>x.key==='cabinet'?{...x,required:false}:x);
 const r=await refreshProjectContinuation(saved,{...next.request,fields},next.sourcePort);
 assert.equal(r.status,'REJECTED');assert.equal(r.reason,'request_mismatch');
 assert.deepEqual(next.getMetrics(),before);
});

test('a new Task or changed Workspace cannot disclose old project conditions',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 for(const kind of ['task','workspace']){
  const now=makeCommercialCase({workspace:kind==='workspace'?'different-workspace':undefined});
  const request=kind==='task'?{...now.request,taskId:'task:another'}:now.request;
  const before=now.getMetrics();
  const r=await refreshProjectContinuation(saved,request,now.sourcePort);
  assert.equal(r.status,'REJECTED');
  assert.equal(r.reason,kind==='task'?'task_changed':'workspace_changed');
  assert.equal(r.latest,null);assert.deepEqual(now.getMetrics(),before);
 }
});

test('modified old excerpt is refused before reading new project sources',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const tampered=structuredClone(saved);
 tampered.projection.selected[0].excerpt='forged claim from user';
 const next=makeCommercialCase(),before=next.getMetrics();
 await assert.rejects(refreshProjectContinuation(tampered,next.request,next.sourcePort),
  /K01_CONTINUATION_PREVIOUS_INVALID/);
 assert.deepEqual(next.getMetrics(),before);
});

test('restored old project refresh remains deterministic across independent host doubles',async()=>{
 const old=makeCommercialCase(),saved=await prepareProjectContinuation(old.request,old.sourcePort);
 const serialized=JSON.parse(JSON.stringify(saved));
 const first=makeCommercialCase({updated:true}),second=makeCommercialCase({updated:true});
 const via={async listSources(args){const r=await second.sourcePort.listSources(args);
  return {...r,sources:[...r.sources].reverse().map(x=>structuredClone(x))};},
  async readSource(args){return structuredClone(await second.sourcePort.readSource(args))}};
 const a=await refreshProjectContinuation(serialized,first.request,first.sourcePort);
 const b=await refreshProjectContinuation(serialized,second.request,via);
 assert.deepEqual(a,b);
 assert.equal(JSON.stringify(a),JSON.stringify(b));
});

test('original 0.1.1 projection without source manifest still refreshes by catalog digest',async()=>{
 const old=makeCommercialCase(),saved=await prepareProjectContinuation(old.request,old.sourcePort);
 const legacy=structuredClone(saved);delete legacy.sourceRevisions;
 const now=makeCommercialCase({updated:true}),r=await refreshProjectContinuation(legacy,now.request,now.sourcePort);
 assert.equal(r.status,'UPDATED');
 assert.equal(r.catalogChanged,true);
 assert.equal(r.fieldChanges.length,7);
 assert.deepEqual(r.sourceChanges,[]);
});

test('refresh uses one document pass rather than revalidate followed by re-prepare',async()=>{
 const host=makeCommercialCase(),saved=await prepareProjectContinuation(host.request,host.sourcePort);
 const direct=makeCommercialCase(),r=await refreshProjectContinuation(saved,direct.request,direct.sourcePort);
 assert.equal(r.status,'CURRENT');
 const two=makeCommercialCase();
 const legacy=await revalidateProjectContinuation(saved,two.request,two.sourcePort);
 assert.equal(legacy.allCurrent,true);
 await prepareProjectContinuation(two.request,two.sourcePort);
 assert.equal(direct.getMetrics().lists,2);
 assert.equal(two.getMetrics().lists,4);
 assert.equal(two.getMetrics().reads,2*direct.getMetrics().reads);
});

test('refresh API is available through the declared public package subpath',async()=>{
 const api=await import('@iwxa/k01-context/project-continuation');
 assert.equal(api.refreshProjectContinuation,refreshProjectContinuation);
 assert.equal(api.PROJECT_REFRESH_VERSION,PROJECT_REFRESH_VERSION);
});


test('disappearing accepted source blocks fallback to obsolete approved quote',async()=>{
 const host=makeCommercialCase(),prior=await prepareProjectContinuation(host.request,host.sourcePort);
 const next=makeCommercialCase(),owner=next.sourcePort;
 const port={
  async listSources(args){
   const roster=await owner.listSources(args);
   return {...roster,sources:roster.sources.filter(s=>s.sourceRef!=='doc:quote-approved')};
  },
  async readSource(args){return owner.readSource(args);}
 };
 const check=await refreshProjectContinuation(prior,next.request,port);
 assert.equal(check.status,'REJECTED');
 assert.equal(check.reason,'selected_source_missing');
 assert.equal(check.latest,null,'obsolete v1 prices must not be returned as ready');
 assert.equal(check.reusable,false);
 assert.equal(check.requiresReview,true);
 assert.ok(check.sourceChanges.some(s=>
  s.sourceRef==='doc:quote-approved'&&s.kind==='SOURCE_REMOVED'));
 assert.equal(JSON.stringify(check).includes('360000 руб'),false);
 assert.equal(JSON.stringify(check).includes('398000 руб'),false);
});

test('removing an unselected proposed source does not reject valid accepted source context',async()=>{
 const host=makeCommercialCase(),prior=await prepareProjectContinuation(host.request,host.sourcePort);
 const now=makeCommercialCase(),owner=now.sourcePort;
 const port={
  async listSources(args){
   const catalog=await owner.listSources(args);
   return {...catalog,sources:catalog.sources.filter(s=>s.sourceRef!=='mail:proposed-discount')};
  },
  async readSource(args){return owner.readSource(args);}
 };
 const refreshed=await refreshProjectContinuation(prior,now.request,port);
 assert.equal(refreshed.status,'UPDATED');
 assert.equal(refreshed.latest.requiredComplete,true);
 assert.equal(refreshed.fieldChanges.length,0);
 assert.ok(refreshed.sourceChanges.some(s=>
  s.sourceRef==='mail:proposed-discount'&&s.kind==='SOURCE_REMOVED'));
 assert.equal(refreshed.reusable,false);
});


// The catalog is host-owned and can contain imported/partly migrated metadata.
// A malformed revision link must never make a newer accepted document disappear.
function catalogPort(host,edit){
 const owner=host.sourcePort;
 return {
  async listSources(args){
   const snapshot=structuredClone(await owner.listSources(args));
   edit(snapshot.sources);
   return snapshot;
  },
  async readSource(args){return owner.readSource(args);}
 };
}

test('an older accepted quote cannot supersede a newer signed quote',async()=>{
 const host=makeCommercialCase();
 const port=catalogPort(host,sources=>{
  const old=sources.find(x=>x.sourceRef==='doc:quote-old');
  const current=sources.find(x=>x.sourceRef==='doc:quote-approved');
  old.supersedes=['doc:quote-approved'];
  current.supersedes=[];
 });
 await assert.rejects(prepareProjectContinuation(host.request,port),
  /K01_CONTINUATION_SUPERSESSION_ORDER_INVALID/);
 assert.equal(host.getMetrics().reads,0);
});

test('supersession respects actual timezones, not string date order',async()=>{
 const host=makeCommercialCase();
 const validPort=catalogPort(host,sources=>{
  sources.find(x=>x.sourceRef==='doc:quote-old').issuedAt='2026-11-04T12:00:00+02:00';
  sources.find(x=>x.sourceRef==='doc:quote-approved').issuedAt='2026-11-04T10:30:00Z';
 });
 const good=await prepareProjectContinuation(host.request,validPort);
 assert.equal(good.requiredComplete,true);
 assert.match(good.projection.selected.find(x=>x.id==='field:cabinet').excerpt,/398000/);

 const newerHost=makeCommercialCase();
 const wrong=catalogPort(newerHost,sources=>{
  sources.find(x=>x.sourceRef==='doc:quote-old').issuedAt='2026-11-04T10:30:00Z';
  sources.find(x=>x.sourceRef==='doc:quote-approved').issuedAt='2026-11-04T12:00:00+02:00';
 });
 await assert.rejects(prepareProjectContinuation(newerHost.request,wrong),
  /K01_CONTINUATION_SUPERSESSION_ORDER_INVALID/);
 assert.equal(newerHost.getMetrics().reads,0);
});

test('equal instants cannot prove that one accepted revision replaced another',async()=>{
 const host=makeCommercialCase(),port=catalogPort(host,sources=>{
  sources.find(x=>x.sourceRef==='doc:quote-old').issuedAt='2026-11-04T11:00:00Z';
  sources.find(x=>x.sourceRef==='doc:quote-approved').issuedAt='2026-11-04T14:00:00+03:00';
 });
 await assert.rejects(prepareProjectContinuation(host.request,port),
  /K01_CONTINUATION_SUPERSESSION_ORDER_INVALID/);
 assert.equal(host.getMetrics().reads,0);
});

test('document may only supersede facts it actually declares as current',async()=>{
 const host=makeCommercialCase(),port=catalogPort(host,sources=>{
  const decision=sources.find(x=>x.sourceRef==='doc:payment-decision');
  decision.supersedes=[{sourceRef:'doc:quote-approved',fields:['cabinet']}];
 });
 await assert.rejects(prepareProjectContinuation(host.request,port),
  /K01_CONTINUATION_SUPERSESSION_SCOPE_INVALID/);
 assert.equal(host.getMetrics().reads,0);
});

test('whole-document supersession cannot silently remove unrepresented fields',async()=>{
 const host=makeCommercialCase(),port=catalogPort(host,sources=>{
  const next=sources.find(x=>x.sourceRef==='doc:quote-approved');
  next.topics=['cabinet'];
 });
 await assert.rejects(prepareProjectContinuation(host.request,port),
  /K01_CONTINUATION_SUPERSESSION_SCOPE_INVALID/);
 assert.equal(host.getMetrics().reads,0);
});

test('proposed correspondence cannot claim an authoritative replacement',async()=>{
 const host=makeCommercialCase(),port=catalogPort(host,sources=>{
  const proposed=sources.find(x=>x.sourceRef==='mail:proposed-discount');
  proposed.supersedes=[{sourceRef:'doc:quote-approved',fields:['advance']}];
 });
 await assert.rejects(prepareProjectContinuation(host.request,port),
  /K01_CONTINUATION_SUPERSESSION_NOT_ACCEPTED/);
 assert.equal(host.getMetrics().reads,0);
});

test('ambiguous local dates and calendar-overflow events are refused',async()=>{
 for(const invalid of ['11/04/2026','2026-02-30T14:00:00Z','2026-11-04T25:30:00Z',
  '2026-11-04T14:00:00+15:00']){
  const host=makeCommercialCase(),port=catalogPort(host,sources=>{
   sources.find(x=>x.sourceRef==='doc:quote-old').issuedAt=invalid;
  });
  await assert.rejects(prepareProjectContinuation(host.request,port),
   /K01_CONTINUATION_SOURCE_INVALID/);
  assert.equal(host.getMetrics().reads,0);
 }
});

test('catalog ignores malformed non-authorized sources without reading their bytes',async()=>{
 const baseline=makeCommercialCase();
 const original=await prepareProjectContinuation(baseline.request,baseline.sourcePort);
 const host=makeCommercialCase(),port=catalogPort(host,sources=>{
  sources.unshift({sourceRef:'foreign:unrelated',workspaceRef:'foreign-workspace',
   issuedAt:'invalid',revision:'not-a-sha',state:'invalid',supersedes:'invalid',
   topics:'invalid',kind:'untrusted'});
 });
 const selected=await prepareProjectContinuation(host.request,port);
 assert.deepEqual(selected,original);
 assert.equal(host.getMetrics().reads,selected.metrics.readCount);
});

test('invalid relation does not refresh a saved approved project into false currency',async()=>{
 const original=makeCommercialCase();
 const saved=await prepareProjectContinuation(original.request,original.sourcePort);
 const later=makeCommercialCase(),port=catalogPort(later,sources=>{
  sources.find(x=>x.sourceRef==='doc:quote-old').supersedes=['doc:quote-approved'];
  sources.find(x=>x.sourceRef==='doc:quote-approved').supersedes=[];
 });
 await assert.rejects(refreshProjectContinuation(saved,later.request,port),
  /K01_CONTINUATION_SUPERSESSION_ORDER_INVALID/);
 assert.equal(later.getMetrics().reads,0);
});
