// Option C witness: exact original K036 current-object + existing Event
// history primitives. NOT a production adapter. Full snapshot payloads in
// the existing unrestricted journal are deliberately tested as a BLOCKER.
// No Store/schema/contract change, raw IndexedDB access is fixture-only read.
import { execFileSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ws='qualification-c3-native-history',objectId='native-current-method';
const copyWs='qualification-c3-native-history-copy',thirdWs='qualification-c3-native-history-third';
const eventType='qualification.c3.native-history.snapshot';
const key=n=>'native-history-'+n;
const snapshot=(revision,tag='main',scope=ws)=>({recordId:'native-record-'+revision+'-'+tag,revision,
  previousRevision:revision===1?null:revision-1,refs:{workspaceId:scope},
  payload:{privateFixture:'qualification-native-history-'+revision+'-'+tag}});
function graphInput(revision,schemaId,schemaVersion,tag='main',scope=ws){
  const value=snapshot(revision,tag,scope);
  return {workspace_id:scope,idempotency_key:tag==='main'?key(revision):key(revision)+'-'+tag,
    object:{object_id:objectId,schema_id:schemaId,schema_version:schemaVersion,
      base_revision:revision-1,data:value},event:{event_type:eventType,payload:{snapshot:value}}};
}
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
async function readFixtureEventIndex(serviceId,idempotencyKey,scope=ws){
  // Original native successor DB already exists. Never create a DB or
  // mutate any row; this inspection establishes physical index feasibility,
  // not an authorised Runtime operation or a production API.
  const req=indexedDB.open('iwxa-local');
  req.onupgradeneeded=()=>req.transaction.abort();
  const db=await request(req);
  try{
    const tx=db.transaction('events','readonly'),store=tx.objectStore('events');
    const index=store.index('by_idempotency');
    const row=await request(index.get([scope,serviceId,idempotencyKey]));
    return {row,keyPath:index.keyPath,unique:index.unique,storeNames:Array.from(db.objectStoreNames),
      eventIndexes:Array.from(store.indexNames)};
  }finally{db.close();}
}
function containsPrivateSnapshot(archive){
  const directory=mkdtempSync(join(tmpdir(),'iwxa-k036-event-history-'));
  try{
    const path=join(directory,'fixture.iwxa');writeFileSync(path,archive.bytes);
    return execFileSync('unzip',['-p',path],{maxBuffer:16*1024*1024}).includes(Buffer.from('qualification-native-history-'));
  }finally{rmSync(directory,{recursive:true,force:true});}
}
export async function probeCurrentObjectHistoryCandidate({writer,reader,limitedExporter,openEmpty,schemaId,schemaVersion,serviceId,check,same,expectReject}){
  await writer.t1.createWorkspace({workspace_id:ws,profile:'personal'});
  for(let n=1;n<=64;n++)await writer.t1.commitObjectGraph(graphInput(n,schemaId,schemaVersion));
  const readCurrent=async (client,scope=ws)=>(await client.t1.getObject(scope,objectId))?.object??null;
  same('one physical current object for 64 revisions',(await writer.t1.listObjects({workspace_id:ws})).length,1);
  same('current physical revision equals 64',(await readCurrent(writer)).revision,64);
  const readHistory=async (client,scope=ws)=>(await client.t1.listEventsSince(scope,'')).filter(e=>e.event_type===eventType)
    .sort((a,b)=>a.payload.snapshot.revision-b.payload.snapshot.revision);
  const firstHistory=await readHistory(writer);
  same('64 exact revision snapshots use original Event history',firstHistory.map(e=>e.payload.snapshot),
    Array.from({length:64},(_,i)=>snapshot(i+1)));
  const competing=await Promise.allSettled(['left','right'].map(tag=>writer.t1.commitObjectGraph(graphInput(65,schemaId,schemaVersion,tag))));
  same('single current object revision CAS accepts one concurrent writer',competing.filter(r=>r.status==='fulfilled').length,1);
  const winner=competing.find(r=>r.status==='fulfilled').value;
  const current=await readCurrent(writer),history=await readHistory(writer);
  same('one current object after competing update',(await writer.t1.listObjects({workspace_id:ws})).length,1);
  same('only accepted concurrent revision appended to original journal',history.length,65);
  same('current record and exact last event agree',current.data,history.at(-1).payload.snapshot);
  same('current revision receipt matches original object',current.data,winner.object.data);
  let restrictedDenied=false;
  try{restrictedDenied=!(await reader.t1.getObject(ws,objectId));}
  catch(e){if(!['PERMISSION_DENIED','OBJECT_NOT_FOUND'].includes(e.code))throw e;restrictedDenied=true;}
  check('restricted reader cannot read current fixture schema',restrictedDenied);
  const restrictedEvents=await reader.t1.listEventsSince(ws,'');
  const leaked=restrictedEvents.some(e=>e.event_type===eventType&&e.payload?.snapshot?.payload?.privateFixture);
  // The exact released runtime does not apply object-schema permission to
  // its generic journal. Record this as an architectural limitation, not
  // as a successful permission test or an adopted Event snapshot mapping.
  const indexed=await readFixtureEventIndex(serviceId,key(1));
  same('original Event by_idempotency index addresses exact first snapshot',indexed.row?.payload?.snapshot,snapshot(1));
  same('original Event index is scoped by Workspace and service',indexed.keyPath,['workspace_id','service_id','idempotency_key']);
  check('original event identity index is unique',indexed.unique===true);
  check('original object-specific event index exists',indexed.eventIndexes.includes('by_object'));
  const opts={workspaces:[ws],include_history:true,include_relations:true,include_assets:true,include_schemas:true};
  const artifact=await writer.t2.exportPackage(opts);
  let limitedExport;
  try{
    const limited=await limitedExporter.t2.exportPackage(opts);
    limitedExport={status:'RETURNED',events:limited.manifest.counts.events,objects:limited.manifest.counts.objects,
      privatePayloadVisible:containsPrivateSnapshot(limited)};
  }catch(error){limitedExport={status:'REJECTED',code:error.code??null};}
  const fresh=await openEmpty();
  const p=await fresh.writer.t2.importPreview(artifact.bytes);
  await fresh.writer.t2.importCommit({preview_token:p.preview_token,package_digest:p.package_digest,plan:{mode:'full'}});
  same('same-ID Exchange restores current object without multiplying catalog',(await fresh.writer.t1.listObjects({workspace_id:ws})).length,1);
  same('same-ID Exchange restores current physical revision exactly',(await readCurrent(fresh.writer)).data,current.data);
  const restored=await readHistory(fresh.writer);
  same('same-ID Exchange restores all original Event snapshots exactly',restored.map(e=>e.payload.snapshot),history.map(e=>e.payload.snapshot));
  same('same-ID Exchange preserves original event IDs',restored.map(e=>e.event_id),history.map(e=>e.event_id));
  const reopenedIndex=await readFixtureEventIndex(serviceId,key(1));
  same('restored Event index still addresses exact first snapshot',reopenedIndex.row?.payload?.snapshot,snapshot(1));
  same('same-ID history semantic digest matches',(await fresh.writer.t2.exportPackage(opts)).manifest.semantic_digest,artifact.manifest.semantic_digest);
  await expectReject('restored exact old graph attempt is not a new current revision',
    ()=>fresh.writer.t1.commitObjectGraph(graphInput(1,schemaId,schemaVersion)),['CONFLICT']);
  same('old replay cannot add an extra history event',(await readHistory(fresh.writer)).length,65);
  same('old replay cannot roll current state back',(await readCurrent(fresh.writer)).data,current.data);
  // Original Exchange copy is a separate gate from same-ID restore.
  const importCopy=async (client,archive,from,to)=>{
    const preview=await client.t2.importPreview(archive.bytes);
    return client.t2.importCommit({preview_token:preview.preview_token,package_digest:preview.package_digest,
      plan:{mode:'new-workspace',target_workspace:to,workspace_id_map:{[from]:to}}});
  };
  const exact=values=>JSON.stringify(values.map(e=>e.payload.snapshot));
  const exactCurrent=value=>JSON.stringify(value?.data??null);
  const observeCopy=async (client,archive,from,to)=>{
    try{await importCopy(client,archive,from,to);}
    catch(error){return {status:'REJECTED',code:error.code??null,message:error.message};}
    const rows=await readHistory(client,to),head=await readCurrent(client,to);
    const index=await readFixtureEventIndex(serviceId,key(1),to);
    return {status:'RETURNED',snapshotCount:rows.length,
      exactOriginalSnapshots:exact(rows)===exact(history),currentBytesExact:exactCurrent(head)===exactCurrent(current),
      outerScopeMapped:rows.every(e=>e.workspace_id===to)&&head?.workspace_id===to,
      nestedOriginScopes:[...new Set(rows.map(e=>e.payload.snapshot.refs.workspaceId))],
      firstIndexExact:JSON.stringify(index.row?.payload?.snapshot)===JSON.stringify(snapshot(1)),
      eventIdsPreserved:rows.length===history.length&&rows.every((e,i)=>e.event_id===history[i].event_id)};
  };
  const copy=await observeCopy(fresh.writer,artifact,ws,copyWs);
  copy.sourcePreserved=exact(await readHistory(fresh.writer,ws))===exact(history)
    &&exactCurrent(await readCurrent(fresh.writer,ws))===exactCurrent(current);
  if(copy.status==='RETURNED'&&copy.exactOriginalSnapshots&&copy.currentBytesExact&&copy.sourcePreserved){
    // Try truly independent advances in the same original database. Do not
    // silently map nested typed source refs; new target snapshot has its own
    // target scope, inherited raw origin remains untouched.
    let advancementError=null;
    try{
      await fresh.writer.t1.commitObjectGraph(graphInput(66,schemaId,schemaVersion,'target',copyWs));
      await fresh.writer.t1.commitObjectGraph(graphInput(66,schemaId,schemaVersion,'source',ws));
    }catch(error){advancementError={code:error.code??null,message:error.message};}
    const a=await readHistory(fresh.writer,ws),b=await readHistory(fresh.writer,copyWs);
    copy.independentAdvances={error:advancementError,sourceCount:a.length,targetCount:b.length,
      sourceInheritedExact:exact(a.slice(0,65))===exact(history),targetInheritedExact:exact(b.slice(0,65))===exact(history),
      sourceCurrentExact:exactCurrent(await readCurrent(fresh.writer,ws))===JSON.stringify(snapshot(66,'source',ws)),
      targetCurrentExact:exactCurrent(await readCurrent(fresh.writer,copyWs))===JSON.stringify(snapshot(66,'target',copyWs))};
    if(!advancementError&&copy.independentAdvances.sourceCurrentExact&&copy.independentAdvances.targetCurrentExact){
      const targetArchive=await fresh.writer.t2.exportPackage({...opts,workspaces:[copyWs]});
      let recopyError=null;
      try{await importCopy(fresh.writer,targetArchive,copyWs,thirdWs);}
      catch(error){recopyError={code:error.code??null,message:error.message};}
      const c=recopyError?[]:await readHistory(fresh.writer,thirdWs);
      copy.recopy={error:recopyError,exact:!recopyError&&exact(c)===exact(b),
        sourcePreserved:exact(await readHistory(fresh.writer,ws))===exact(a),
        firstCopyPreserved:exact(await readHistory(fresh.writer,copyWs))===exact(b),
        nestedOriginScopes:[...new Set(c.map(e=>e.payload.snapshot.refs.workspaceId))]};
    }
  }
  const separate=await openEmpty();
  const independentCopy=await observeCopy(separate.writer,artifact,ws,copyWs);
  console.log('CURRENT_EVENT_HISTORY_COPY_OBSERVATIONS',JSON.stringify({limitedExport,copy,independentCopy}));
  same('current-object history witness uses only original DB',(await indexedDB.databases()).map(d=>d.name),['iwxa-local']);
  return {writer:separate.writer,observations:{status:'PRIMITIVES_ONLY_NOT_ADOPTED',catalogObjects:1,historySnapshots:65,
    originalEventIndex:{keyPath:indexed.keyPath,unique:indexed.unique,byObject:true},restrictedReaderSnapshotVisible:leaked,
    permissionGate:leaked?'BLOCKED_UNRESTRICTED_GENERIC_JOURNAL':'REQUIRES_EXACT_PRODUCTION_D1',
    addressedHistoryPublicApi:false,rawIndexInspectionFixtureOnly:true,physicalBrowser:false,
    sameIdRestore:true,limitedExport,copy,independentCopy,productionAdapterApproved:false}};
}
