// W04.26: qualification of an alternative to Event snapshots and
// revision objects. Use only original released K036 public T1/T2 API.
// One current Object + attached existing Assets, write-ahead of previous
// CURRENT revision. No new DB, Store, schema engine or production adoption.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const ws='qualification-c3-asset-history',target='qualification-c3-asset-copy';
const objectId='asset-history-current';
const marker='qualification-asset-private-';
const mime='application/json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const bytes=value=>new TextEncoder().encode(canonical(value));
function fail(message){throw Object.assign(new Error(message),{code:'ASSET_HISTORY_FIXTURE_INTEGRITY'});}
function invariant(ok,message){if(!ok)fail(message);}
const assetId=(scope,recordId)=>'c3-history-'+hash(bytes([scope,objectId,recordId]));
function currentRecord(revision,previous,tag='main',scope=ws){
  return {recordId:'asset-record-'+revision+'-'+tag,revision,originWorkspaceId:scope,
    previousSnapshot:previous,payload:tag==='release'?null:{privateFixture:marker+revision+'-'+tag}};
}
const packOptions=workspace_id=>({workspaces:[workspace_id],include_history:true,include_assets:true,include_relations:true,include_schemas:true});
async function current(client,scope){
  const row=await client.t1.getObject(scope,objectId);
  invariant(row?.object?.workspace_id===scope&&row.object.object_id===objectId&&!row.object.deleted
    &&row.object.revision===row.object.data?.revision,'current immutable revision identity mismatch');
  return row.object;
}
async function readSnapshot(client,scope,pointer){
  const value=await client.t1.getAsset(scope,pointer.assetId);
  invariant(value?.asset?.workspace_id===scope&&value.asset.asset_id===pointer.assetId
    &&value.asset.object_id===objectId&&value.asset.mime===mime&&value.asset.revision===1
    &&value.bytes instanceof Uint8Array&&hash(value.bytes)===pointer.sha256,'exact original historical Asset missing or changed');
  const row=JSON.parse(new TextDecoder().decode(value.bytes));
  invariant(row.recordId===pointer.recordId&&row.revision===pointer.revision&&hash(bytes(row))===pointer.sha256,
    'historical Asset content identity mismatch');
  return row;
}
async function stagePrior(client,scope,row){
  const data=row.data,raw=bytes(data);
  const pointer={assetId:assetId(scope,data.recordId),recordId:data.recordId,revision:data.revision,sha256:hash(raw)};
  let before=await client.t1.getAsset(scope,pointer.assetId);
  if(!before){
    try{
      await client.t1.putAsset({workspace_id:scope,object_id:objectId,asset_id:pointer.assetId,
        mime,bytes:raw,base_revision:0,event:{event_type:'qualification.c3.history.asset.staged',
          idempotency_key:'stage-'+pointer.assetId,payload:{recordId:data.recordId,revision:data.revision,sha256:pointer.sha256}}});
    }catch(error){
      // An uncertain response or concurrent identical staging may already
      // have saved the previous CURRENT revision; exact readback is required.
      if(!await client.t1.getAsset(scope,pointer.assetId))throw error;
    }
  }
  await readSnapshot(client,scope,pointer);
  return pointer;
}
function input(scope,data,schemaId,schemaVersion){
  return {workspace_id:scope,idempotency_key:'asset-head-'+data.recordId,
    object:{object_id:objectId,schema_id:schemaId,schema_version:schemaVersion,
      base_revision:data.revision-1,data},
    event:{event_type:'qualification.c3.history.current.committed',
      payload:{recordId:data.recordId,revision:data.revision,previousSnapshot:data.previousSnapshot}}};
}
async function chain(client,scope){
  const row=await current(client,scope);
  const records=[row.data],seen=new Set([row.data.recordId]);
  let value=row.data;
  while(value.previousSnapshot!==null){
    invariant(records.length<128&&value.revision>1,'invalid historical chain length');
    const previous=await readSnapshot(client,scope,value.previousSnapshot);
    invariant(previous.revision===value.revision-1&&!seen.has(previous.recordId),'historical Asset predecessor mismatch');
    records.push(previous);seen.add(previous.recordId);value=previous;
  }
  invariant(value.revision===1,'incomplete history');
  return records;
}
async function importArchive(client,artifact,plan){
  const preview=await client.t2.importPreview(artifact.bytes);
  return client.t2.importCommit({preview_token:preview.preview_token,package_digest:preview.package_digest,plan});
}
function hasPrivatePackageBytes(artifact){
  const temp=mkdtempSync(join(tmpdir(),'iwxa-c3-asset-package-'));
  try{
    const path=join(temp,'test.iwxa');writeFileSync(path,artifact.bytes);
    const unpacked=execFileSync('unzip',['-p',path],{maxBuffer:16*1024*1024});
    return unpacked.includes(Buffer.from(marker));
  }finally{rmSync(temp,{recursive:true,force:true});}
}
async function inspectChain(client,scope){
  try{return {state:'AVAILABLE',records:await chain(client,scope)};}
  catch(error){return {state:'UNAVAILABLE',code:error.code??null,message:error.message};}
}
export async function probeAttachedHistoryCandidate({writer,reader,limitedExporter,openEmpty,schemaId,schemaVersion,check,same,expectReject}){
  await writer.t1.createWorkspace({workspace_id:ws,profile:'personal'});
  await writer.t1.commitObjectGraph(input(ws,currentRecord(1,null),schemaId,schemaVersion));
  const first=await current(writer,ws);
  const staged=await stagePrior(writer,ws,first);
  // Deliberately interrupt between durable prior snapshot and next head.
  same('Asset history staging interruption leaves original current revision unchanged',(await current(writer,ws)).data,first.data);
  same('staged previous current revision is exact after lost acknowledgement retry',await stagePrior(writer,ws,first),staged);
  same('retry does not duplicate staged Asset',(await writer.t1.listAssets({workspace_id:ws,object_id:objectId})).length,1);
  await writer.t1.commitObjectGraph(input(ws,currentRecord(2,staged),schemaId,schemaVersion));
  for(let n=3;n<=64;n++){
    const previous=await stagePrior(writer,ws,await current(writer,ws));
    await writer.t1.commitObjectGraph(input(ws,currentRecord(n,previous),schemaId,schemaVersion));
  }
  const previousCurrent=await current(writer,ws);
  const stagedRace=await Promise.all([stagePrior(writer,ws,previousCurrent),stagePrior(writer,ws,previousCurrent)]);
  same('concurrent next revisions reuse exact same prior current Asset',stagedRace[0],stagedRace[1]);
  const race=await Promise.allSettled(['left','right'].map(tag=>writer.t1.commitObjectGraph(
    input(ws,currentRecord(65,stagedRace[0],tag),schemaId,schemaVersion))));
  same('Asset-history next current CAS accepts one concurrent revision',race.filter(r=>r.status==='fulfilled').length,1);
  same('one current Object after 65 revisions in Asset candidate',(await writer.t1.listObjects({workspace_id:ws})).length,1);
  same('exact 64 prior current snapshots in original Assets',(await writer.t1.listAssets({workspace_id:ws,object_id:objectId})).length,64);
  const history=await chain(writer,ws);
  same('original addressed Asset chain contains all 65 revisions',history.map(r=>r.revision),Array.from({length:65},(_,i)=>65-i));
  const prior=history[0].previousSnapshot;
  same('schema-restricted reader cannot read private attached historical Asset',await reader.t1.getAsset(ws,prior.assetId),null);
  same('schema-restricted reader cannot list private attached historical Assets',await reader.t1.listAssets({workspace_id:ws,object_id:objectId}),[]);
  check('generic original journal contains only metadata for Asset history',
    !JSON.stringify(await reader.t1.listEventsSince(ws,'')).includes(marker));
  let limitedExport;
  try{
    const archive=await limitedExporter.t2.exportPackage(packOptions(ws));
    limitedExport={status:'RETURNED',assetCount:archive.manifest.counts.assets,privatePayloadVisible:hasPrivatePackageBytes(archive)};
  }catch(error){limitedExport={status:'REJECTED',code:error.code??null};}
  const previous=await stagePrior(writer,ws,await current(writer,ws));
  await writer.t1.commitObjectGraph(input(ws,currentRecord(66,previous,'release'),schemaId,schemaVersion));
  const released=await chain(writer,ws);
  same('logical tombstone retains exact original Asset history',released.slice(1),history);
  same('logical tombstone current payload is null',released[0].payload,null);
  const archive=await writer.t2.exportPackage(packOptions(ws));
  const fresh=await openEmpty();
  await importArchive(fresh.writer,archive,{mode:'full'});
  same('same-ID original Exchange restores all Asset snapshot bytes',await chain(fresh.writer,ws),released);
  same('same-ID Asset history restore retains one catalog Object',(await fresh.writer.t1.listObjects({workspace_id:ws})).length,1);
  same('same-ID Asset history semantic digest is preserved',
    (await fresh.writer.t2.exportPackage(packOptions(ws))).manifest.semantic_digest,archive.manifest.semantic_digest);
  same('restored historical Asset still obeys object schema read permission',
    await fresh.reader.t1.getAsset(ws,prior.assetId),null);
  let copy;
  try{
    const receipt=await importArchive(fresh.writer,archive,{mode:'new-workspace',target_workspace:target,workspace_id_map:{[ws]:target}});
    copy={status:'RETURNED',applied:receipt?.applied??null};
  }catch(error){copy={status:'REJECTED',code:error.code??null,message:error.message};}
  const originalAfterCopy=await inspectChain(fresh.writer,ws),targetAfterCopy=await inspectChain(fresh.writer,target);
  copy.sourcePreserved=originalAfterCopy.state==='AVAILABLE'&&canonical(originalAfterCopy.records)===canonical(released);
  copy.targetHistoryExact=targetAfterCopy.state==='AVAILABLE'&&canonical(targetAfterCopy.records)===canonical(released);
  copy.targetReadState=targetAfterCopy.state;copy.targetReadCode=targetAfterCopy.code??null;
  // Import into an empty factory distinguishes ID collision with the live
  // source from general new-Workspace mapping. No assumption about outcome.
  const separate=await openEmpty();
  let independentCopy;
  try{
    await importArchive(separate.writer,archive,{mode:'new-workspace',target_workspace:target,workspace_id_map:{[ws]:target}});
    const observed=await inspectChain(separate.writer,target);
    independentCopy={status:'RETURNED',targetHistoryExact:observed.state==='AVAILABLE'&&canonical(observed.records)===canonical(released),
      targetReadState:observed.state,targetReadCode:observed.code??null};
  }catch(error){independentCopy={status:'REJECTED',code:error.code??null,message:error.message};}
  // The original Asset writer may still replace/delete its own snapshot.
  // Test separately, never damage the earlier original source or its copy.
  const tamper=await openEmpty();
  await importArchive(tamper.writer,archive,{mode:'full'});
  let mutation;
  try{
    await tamper.writer.t1.putAsset({workspace_id:ws,object_id:objectId,asset_id:prior.assetId,
      mime,bytes:bytes({different:true}),base_revision:1,event:{event_type:'qualification.c3.history.asset.tamper',
        idempotency_key:'tamper-old-asset',payload:{recordId:prior.recordId}}});
    mutation={status:'RETURNED',chain:(await inspectChain(tamper.writer,ws)).state};
  }catch(error){mutation={status:'REJECTED',code:error.code??null,chain:(await inspectChain(tamper.writer,ws)).state};}
  const clean=await openEmpty();
  same('Asset witness continues in one original DB',(await indexedDB.databases()).map(d=>d.name),['iwxa-local']);
  return {writer:clean.writer,observations:{status:'PRIMITIVES_ONLY_NOT_ADOPTED',catalogObjects:1,historyRevisions:66,historyAssets:65,
    stagedBeforeHead:true,originalSchemaRestrictedAssetRead:true,metadataOnlyJournal:true,limitedExport,copy,independentCopy,
    sameServiceAssetMutation:mutation,physicalBrowser:false,productionAdapterApproved:false}};
}
