// Option C witness: exact original K036 current-object + existing Event
// history primitives. NOT a production adapter. Full snapshot payloads in
// the existing unrestricted journal are deliberately tested as a BLOCKER.
// No Store/schema/contract change, raw IndexedDB access is fixture-only read.
const ws='qualification-c3-native-history',objectId='native-current-method';
const eventType='qualification.c3.native-history.snapshot';
const key=n=>'native-history-'+n;
const snapshot=(revision,tag='main')=>({recordId:'native-record-'+revision+'-'+tag,revision,
  previousRevision:revision===1?null:revision-1,refs:{workspaceId:ws},
  payload:{privateFixture:'qualification-native-history-'+revision+'-'+tag}});
function graphInput(revision,schemaId,schemaVersion,tag='main'){
  const value=snapshot(revision,tag);
  return {workspace_id:ws,idempotency_key:tag==='main'?key(revision):key(revision)+'-'+tag,
    object:{object_id:objectId,schema_id:schemaId,schema_version:schemaVersion,
      base_revision:revision-1,data:value},event:{event_type:eventType,payload:{snapshot:value}}};
}
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
async function readFixtureEventIndex(serviceId,idempotencyKey){
  // Original native successor DB already exists. Never create a DB or
  // mutate any row; this inspection establishes physical index feasibility,
  // not an authorised Runtime operation or a production API.
  const req=indexedDB.open('iwxa-local');
  req.onupgradeneeded=()=>req.transaction.abort();
  const db=await request(req);
  try{
    const tx=db.transaction('events','readonly'),store=tx.objectStore('events');
    const index=store.index('by_idempotency');
    const row=await request(index.get([ws,serviceId,idempotencyKey]));
    return {row,keyPath:index.keyPath,unique:index.unique,storeNames:Array.from(db.objectStoreNames),
      eventIndexes:Array.from(store.indexNames)};
  }finally{db.close();}
}
export async function probeCurrentObjectHistoryCandidate({writer,reader,openEmpty,schemaId,schemaVersion,serviceId,check,same,expectReject}){
  await writer.t1.createWorkspace({workspace_id:ws,profile:'personal'});
  for(let n=1;n<=64;n++)await writer.t1.commitObjectGraph(graphInput(n,schemaId,schemaVersion));
  const readCurrent=async client=>(await client.t1.getObject(ws,objectId)).object;
  same('one physical current object for 64 revisions',(await writer.t1.listObjects({workspace_id:ws})).length,1);
  same('current physical revision equals 64',(await readCurrent(writer)).revision,64);
  const readHistory=async client=>(await client.t1.listEventsSince(ws,'')).filter(e=>e.event_type===eventType)
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
  same('current-object history witness uses only original DB',(await indexedDB.databases()).map(d=>d.name),['iwxa-local']);
  return {writer:fresh.writer,observations:{status:'PRIMITIVES_ONLY_NOT_ADOPTED',catalogObjects:1,historySnapshots:65,
    originalEventIndex:{keyPath:indexed.keyPath,unique:indexed.unique,byObject:true},restrictedReaderSnapshotVisible:leaked,
    permissionGate:leaked?'BLOCKED_UNRESTRICTED_GENERIC_JOURNAL':'REQUIRES_EXACT_PRODUCTION_D1',
    addressedHistoryPublicApi:false,rawIndexInspectionFixtureOnly:true,physicalBrowser:false,
    sameIdRestore:true,productionAdapterApproved:false}};
}
