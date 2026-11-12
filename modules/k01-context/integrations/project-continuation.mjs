// Stateless host-owned continuation over the existing K01 ContextProjection.
import {selectContext,revalidateProjection,sha256} from '../index.mjs';
import {fingerprintContextRequest} from '../request-binding.mjs';
export const PROJECT_CONTINUATION_VERSION='0.1.1';
const MAX_SOURCES=96,MAX_FIELDS=64,MAX_SOURCE_BYTES=1048576,MAX_TOTAL_BYTES=4194304,MAX_LINE_BYTES=4096;
const valid=(s,max=512)=>typeof s==='string'&&s.trim()===s&&s.length>0&&s.length<=max&&!/[\x00-\x1f\x7f]/.test(s);
const hexRevision=s=>typeof s==='string'&&/^sha256:[a-f0-9]{64}$/.test(s);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const fail=code=>{throw new TypeError('K01_CONTINUATION_'+code);};
const bytes=s=>new TextEncoder().encode(s).length;
const states=new Set(['accepted','reference','proposed']);
const kinds=new Set(['document','correspondence','decision','result']);
const epistemic=new Set(['observed','reported','inferred','target']);

function validateRequest(request){
 if(!request||!valid(request.taskId)||!valid(request.workspaceRef)||!valid(request.scopeRevision)||
  !Number.isSafeInteger(request.maxTokens)||request.maxTokens<1||request.maxTokens>20000||
  !Array.isArray(request.allowedSources)||request.allowedSources.length>MAX_SOURCES||
  !Array.isArray(request.fields)||request.fields.length<1||request.fields.length>MAX_FIELDS||
  request.allowedSources.some(s=>!valid(s))||new Set(request.allowedSources).size!==request.allowedSources.length)
  fail('REQUEST_INVALID');
 const seen=new Set();
 const fields=request.fields.map(f=>{
  if(!f||!valid(f.key,80)||!/^[a-z][a-z0-9_.-]*$/.test(f.key)||
   typeof f.required!=='boolean'||!Array.isArray(f.labels)||
   f.labels.length<1||f.labels.length>12||
   f.labels.some(v=>!valid(v,100)||v.includes(':'))||seen.has(f.key))fail('FIELD_INVALID');
  seen.add(f.key);
  return {key:f.key,required:f.required,labels:[...new Set(f.labels)].sort(cmp)};
 });
 return {...request,allowedSources:[...request.allowedSources].sort(cmp),
  fields:fields.sort((a,b)=>cmp(a.key,b.key))};
}

function validateCatalog(catalog,request){
 if(!catalog||catalog.scopeRevision!==request.scopeRevision)fail('WORKSPACE_REVISION_CHANGED');
 if(!Array.isArray(catalog.sources)||catalog.sources.length>MAX_SOURCES)fail('CATALOG_INVALID');
 const seen=new Set(),authorized=new Set(request.allowedSources),sources=[];
 for(const s of catalog.sources){
  if(!s||!valid(s.sourceRef)||!hexRevision(s.revision)||
   !valid(s.workspaceRef)||s.workspaceRef!==request.workspaceRef||
   !kinds.has(s.kind)||!states.has(s.state)||!epistemic.has(s.epistemic)||
   !valid(s.issuedAt,32)||Number.isNaN(Date.parse(s.issuedAt))||
   !Array.isArray(s.topics)||s.topics.length>MAX_FIELDS||
   s.topics.some(v=>!valid(v,80))||!Array.isArray(s.supersedes)||
   s.supersedes.length>MAX_SOURCES||
   s.supersedes.some(v=>!(valid(v)||(v&&valid(v.sourceRef)&&Array.isArray(v.fields)&&
    v.fields.length>=1&&v.fields.length<=MAX_FIELDS&&v.fields.every(f=>valid(f,80)))))||
   s.supersedes.some(v=>(typeof v==='string'?v:v.sourceRef)===s.sourceRef)||
   seen.has(s.sourceRef))fail('SOURCE_INVALID');
  seen.add(s.sourceRef);
  // Snapshot nested relations before any asynchronous source read. The host may
  // reuse mutable objects; a later metadata change must not rewrite the before-image.
  if(authorized.has(s.sourceRef))sources.push({...s,topics:[...s.topics].sort(cmp),
   supersedes:s.supersedes.map(relation=>typeof relation==='string'?relation:
    {sourceRef:relation.sourceRef,fields:[...relation.fields].sort(cmp)})
    .sort((a,b)=>cmp(JSON.stringify(a),JSON.stringify(b)))});
 }
 return sources.sort((a,b)=>cmp(a.sourceRef,b.sourceRef));
}

function indexDocument(content){
 const index=new Map();
 const lines=content.split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const exact=lines[i];
  if(bytes(exact)>MAX_LINE_BYTES)continue;
  const cleaned=exact.trim().replace(/^(?:[-*+]\s+|\d+\.\s+)/,'');
  let rawLabel,value;
  if(cleaned.startsWith('|')&&cleaned.endsWith('|')){
   const cells=cleaned.slice(1,-1).split('|').map(c=>c.trim());
   if(cells.length!==2)continue;
   [rawLabel,value]=cells;
  }else{
   const pos=cleaned.indexOf(':');
   if(pos<=0)continue;
   rawLabel=cleaned.slice(0,pos).trim();
   value=cleaned.slice(pos+1).trim();
  }
  const label=rawLabel.replace(/\*\*/g,'').toLocaleLowerCase('ru-RU');
  if(!value||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))continue;
  const row={value,excerpt:exact,evidenceRef:'line:'+(i+1),sha256:sha256(exact)};
  const rows=index.get(label)||[];rows.push(row);index.set(label,rows);
 }
 return index;
}
function extract(index,field){
 const found=[];
 for(const label of new Set(field.labels.map(l=>l.toLocaleLowerCase('ru-RU'))))
  found.push(...(index.get(label)||[]));
 return found;
}
const issue=(type,fieldKey,sources=[])=>({type,fieldKey,sources:[...new Set(sources)].sort(cmp)});
function supersededRefs(sources,fieldKey){
 const eligible=new Set(sources.map(s=>s.sourceRef)),gone=new Set();
 for(const src of sources){
  if(src.state!=='accepted')continue;
  for(const relation of src.supersedes){
   const old=typeof relation==='string'?relation:relation.sourceRef;
   if(eligible.has(old)&&(typeof relation==='string'||relation.fields.includes(fieldKey)))gone.add(old);
  }
 }
 return gone;
}
function decide(field,claims,sources,unavailable,issues){
 const key=field.key,gone=supersededRefs(sources,key);
 // Missing unapproved correspondence cannot cancel a still-accepted term.
 // Retain a visible warning, but do not replace proven conditions with a gap.
 const proposalUnavailable=unavailable.filter(ref=>!gone.has(ref)&&
  sources.some(s=>s.sourceRef===ref&&s.state==='proposed'));
 if(proposalUnavailable.length)issues.push(issue('proposal_unavailable',key,proposalUnavailable));
 const blocking=unavailable.filter(ref=>!gone.has(ref)&&!proposalUnavailable.includes(ref));
 if(blocking.length){issues.push(issue('source_unavailable',key,blocking));return null;}
 const candidates=claims.filter(c=>!gone.has(c.sourceRef));
 for(const old of [...gone].sort(cmp))issues.push(issue('superseded',key,[old]));
 const approved=candidates.filter(c=>c.state!=='proposed');
 const proposals=candidates.filter(c=>c.state==='proposed');
 if(!approved.length){
  if(proposals.length)issues.push(issue('approval_required',key,proposals.map(c=>c.sourceRef)));
  else issues.push(issue('missing',key));
  return null;
 }
 if(new Set(approved.map(c=>c.value)).size>1){
  issues.push(issue('contradiction',key,approved.map(c=>c.sourceRef)));
  return null;
 }
 const chosen=approved.sort((a,b)=>
  (b.state==='accepted'?1:0)-(a.state==='accepted'?1:0)||
  cmp(b.issuedAt,a.issuedAt)||cmp(a.sourceRef,b.sourceRef))[0];
 const pending=proposals.filter(p=>p.value!==chosen.value&&cmp(p.issuedAt,chosen.issuedAt)>0);
 if(pending.length)issues.push(issue('pending_change',key,pending.map(c=>c.sourceRef)));
 return chosen;
}
function asObservationPort(winners){
 const map=new Map(winners.map(c=>[c.id,c]));
 return {
  async query({allowedSources}){
   const allow=new Set(allowedSources);
   return winners.filter(c=>allow.has(c.sourceRef)).map(c=>({id:c.id,
    type:'project-continuation-fact',sourceRef:c.sourceRef,revision:c.revision,
    epistemic:c.epistemic,estimatedTokens:Math.max(1,Math.ceil(bytes(c.excerpt)/4)),
    keywords:[c.fieldKey,...(c.required?['mandatory']:[])]}));
  },
  async observe({sourceRef,itemId,requestedRevision}){
   const item=map.get(itemId);
   if(!item||item.sourceRef!==sourceRef||item.revision!==requestedRevision)
    return {sourceRef,currentRevision:'unavailable',complete:false};
   return {sourceRef,currentRevision:item.revision,complete:true,
    excerpt:item.excerpt,evidenceRef:item.evidenceRef,sha256:item.sha256};
  }
 };
}

function continuationRequest(request){
 return {taskId:request.taskId,
  terms:[...request.fields.map(f=>f.key),'mandatory'],allowedSources:request.allowedSources,
  maxTokens:request.maxTokens,allowInferred:false,
  // A changed label, mandatory flag or field mapping is a different Task intent,
  // even if the selected excerpts happen to be byte-for-byte identical.
  profile:'project-continuation:'+sha256(JSON.stringify([
   PROJECT_CONTINUATION_VERSION,request.workspaceRef,request.fields])),
  scopeRevision:request.scopeRevision};
}
/** Host-owned listSources/readSource. Only labeled, source-bound facts are extracted.
 * No index, account, persistence, autonomous approval, or generated facts.
 */
export async function prepareProjectContinuation(rawRequest,sourcePort){
 const request=validateRequest(rawRequest);
 if(!sourcePort||typeof sourcePort.listSources!=='function'||
  typeof sourcePort.readSource!=='function')fail('SOURCE_PORT_INVALID');
 const catalog=await sourcePort.listSources({taskId:request.taskId,
  workspaceRef:request.workspaceRef,allowedSources:[...request.allowedSources]});
 const allSources=validateCatalog(catalog,request);
 const fieldMap=new Map(request.fields.map(f=>[f.key,f]));
 const relevant=allSources.filter(s=>s.topics.some(k=>fieldMap.has(k)));
 // The context is bound to the *relevant roster*, not just selected evidence.
 // Changed pending proposals and approval metadata invalidate a saved projection.
 const catalogBinding=sha256(JSON.stringify(relevant));
 const replaced=new Map(request.fields.map(f=>[f.key,supersededRefs(relevant,f.key)]));
 const extracted=new Map(),issues=[],failed=new Map();
 let readCount=0,readBytes=0;
 for(const source of relevant){
  const topics=source.topics.filter(k=>fieldMap.has(k)&&!replaced.get(k).has(source.sourceRef));
  if(!topics.length)continue;
  let snapshot;
  try{
   if(readBytes>=MAX_TOTAL_BYTES)throw Error('context_byte_limit');
   readCount++;
   snapshot=await sourcePort.readSource({sourceRef:source.sourceRef,
    requestedRevision:source.revision,workspaceRef:request.workspaceRef});
   if(!snapshot||snapshot.complete!==true||snapshot.revision!==source.revision||
    typeof snapshot.content!=='string'||bytes(snapshot.content)>MAX_SOURCE_BYTES||
    bytes(snapshot.content)>MAX_TOTAL_BYTES-readBytes||
    'sha256:'+sha256(snapshot.content)!==source.revision)throw Error('snapshot_not_current');
  }catch{
   for(const key of topics){const missing=failed.get(key)||[];
    missing.push(source.sourceRef);failed.set(key,missing);}
   continue;
  }
  readBytes+=bytes(snapshot.content);
  const lineIndex=indexDocument(snapshot.content);
  for(const key of topics){
   const facts=extract(lineIndex,fieldMap.get(key));
   if(facts.length>1){
    const missing=failed.get(key)||[];missing.push(source.sourceRef);failed.set(key,missing);
    issues.push(issue('ambiguous_lines',key,[source.sourceRef]));continue;
   }
   if(!facts.length)continue;
   const fact={...facts[0],id:'field:'+key,fieldKey:key,
    required:fieldMap.get(key).required,sourceRef:source.sourceRef,
    revision:source.revision,kind:source.kind,state:source.state,
    issuedAt:source.issuedAt,epistemic:source.epistemic};
   const rows=extracted.get(key)||[];rows.push(fact);extracted.set(key,rows);
  }
 }
 const winners=[];
 for(const field of request.fields){
  const claims=extracted.get(field.key)||[];
  const sources=relevant.filter(s=>s.topics.includes(field.key));
  const chosen=decide(field,claims,sources,failed.get(field.key)||[],issues);
  if(chosen)winners.push(chosen);
 }
 // Detect a new source or Workspace revision during source retrieval.
 const endCatalog=await sourcePort.listSources({taskId:request.taskId,
  workspaceRef:request.workspaceRef,allowedSources:[...request.allowedSources]});
 const endSources=validateCatalog(endCatalog,request);
 if(JSON.stringify(endSources)!==JSON.stringify(allSources))fail('CATALOG_CHANGED_DURING_SELECTION');
 const coreRequest=continuationRequest(request);
 const projection=await selectContext(coreRequest,asObservationPort(winners));
 const selectedIds=new Set(projection.selected.map(s=>s.id)),covered=[];
 for(const field of request.fields){
  if(selectedIds.has('field:'+field.key))covered.push(field.key);
  else if(!issues.some(i=>i.fieldKey===field.key&&i.type==='missing')){
   const budget=projection.omissions.some(x=>x.id==='field:'+field.key&&x.reason==='budget_exceeded');
   if(budget)issues.push(issue('budget_exceeded',field.key));
   else if(!issues.some(i=>i.fieldKey===field.key))issues.push(issue('missing',field.key));
  }
 }
 issues.sort((a,b)=>cmp(a.fieldKey,b.fieldKey)||cmp(a.type,b.type)||
  cmp(a.sources.join('|'),b.sources.join('|')));
 return {contractVersion:PROJECT_CONTINUATION_VERSION,workspaceRef:request.workspaceRef,
  scopeRevision:request.scopeRevision,catalogBinding,request:coreRequest,projection,covered,
  requiredComplete:request.fields.filter(x=>x.required).every(x=>covered.includes(x.key)),
  issues,metrics:{readCount,readBytes,sourceCount:allSources.length,
   relevantSources:relevant.length,projectionBytes:bytes(JSON.stringify(projection))}};
}

/** Explicit re-check against the *full* current catalog, including new sources. */
export async function revalidateProjectContinuation(previous,rawRequest,sourcePort){
 if(!previous||previous.contractVersion!==PROJECT_CONTINUATION_VERSION||
  !previous.projection||!previous.request||!valid(previous.workspaceRef)||
  typeof previous.catalogBinding!=='string'||!/^[a-f0-9]{64}$/.test(previous.catalogBinding))
  fail('PREVIOUS_INVALID');
 const request=validateRequest(rawRequest);
 if(request.workspaceRef!==previous.workspaceRef)
  return {allCurrent:false,checked:0,failures:[{reason:'workspace_changed'}]};
 if(request.taskId!==previous.request.taskId)
  return {allCurrent:false,checked:0,failures:[{reason:'task_changed'}]};
 if(request.scopeRevision!==previous.scopeRevision)
  return {allCurrent:false,checked:0,failures:[{reason:'scope_changed'}]};
 // Avoid any private-document read when Task intent/field schema/permissions
 // already differ from the saved projection.
 if(fingerprintContextRequest(continuationRequest(request))!==previous.projection.requestBinding)
  return {allCurrent:false,checked:0,failures:[{reason:'request_mismatch'}]};
 let fresh;
 try{fresh=await prepareProjectContinuation(request,sourcePort);}
 catch(e){if(e?.message==='K01_CONTINUATION_WORKSPACE_REVISION_CHANGED')
  return {allCurrent:false,checked:0,failures:[{reason:'scope_changed'}]};
  throw e;}
 const initial=previous.projection,next=fresh.projection;
 if(initial.requestBinding!==next.requestBinding)
  return {allCurrent:false,checked:0,failures:[{reason:'request_mismatch'}]};
 if(previous.catalogBinding!==fresh.catalogBinding)
  return {allCurrent:false,checked:0,failures:[{reason:'catalog_changed'}]};
 if(JSON.stringify(initial.selected)!==JSON.stringify(next.selected)||
  JSON.stringify(previous.issues)!==JSON.stringify(fresh.issues)||
  previous.requiredComplete!==fresh.requiredComplete)
  return {allCurrent:false,checked:0,failures:[{reason:'context_changed'}]};
 const observations=new Map(next.selected.map(e=>[e.id,e]));
 const result=await revalidateProjection(initial,{
  async observe({itemId,sourceRef,requestedRevision}){
   const e=observations.get(itemId);
   return e&&e.sourceRef===sourceRef&&e.revision===requestedRevision
    ? {sourceRef,currentRevision:e.revision,complete:true,
       excerpt:e.excerpt,evidenceRef:e.evidenceRef,sha256:e.sha256}
    : {sourceRef,currentRevision:'unavailable',complete:false};
  }
 },{...fresh.request,requireRequestMatch:true});
 return {allCurrent:result.allCurrent,checked:result.checked,failures:result.failures};
}
