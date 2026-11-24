// Trusted Host composition only. Use the existing T2/T3 scoped subject
// operations; do not write ZIP, invent a grant, or create an execution owner.
// A source-local preview cannot be passed as a release decision.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {TECHNOLOGY_SCHEMA,TECHNOLOGY_VERSION,validateTechnologyProduct} from './technology-product.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(v);
const options=workspace=>({workspaces:[workspace],include_history:false,include_assets:false,include_relations:false,include_schemas:true});
const countKeys=['workspaces','objects','events','relations','assets','schemas'];
const zero=c=>c&&countKeys.every(k=>c[k]===0);
const one=c=>c&&c.workspaces===1&&c.objects===1&&c.events===0&&c.relations===0&&c.assets===0&&c.schemas===1;
const sameOptions=(o,w)=>o&&Array.isArray(o.workspaces)&&o.workspaces.length===1&&o.workspaces[0]===w&&
 o.include_history===false&&o.include_assets===false&&o.include_relations===false&&o.include_schemas===true;
async function checkReadback(subject,workspace,objectId,digest){
 const read=await subject.getObject(workspace,objectId);
 const o=read?.object;
 need(o?.workspace_id===workspace&&o.object_id===objectId&&o.schema_id===TECHNOLOGY_SCHEMA&&
  o.schema_version===TECHNOLOGY_VERSION&&o.revision===1&&o.deleted!==true&&o.deleted_at==null&&
  o.extensions&&typeof o.extensions==='object'&&!Array.isArray(o.extensions)&&Object.keys(o.extensions).length===0&&
  Array.isArray(read.relations?.incoming)&&!read.relations.incoming.length&&Array.isArray(read.relations?.outgoing)&&!read.relations.outgoing.length,
  'TECHNOLOGY_NATIVE_READBACK_REQUIRED');
 const data=validateTechnologyProduct(o.data);
 need(await sha256Canonical(data)===digest,'TECHNOLOGY_NATIVE_PRODUCT_CHANGED');
 return data;
}
/** Provide the existing original scoped SubjectKernelBinding to this Host
 * function. readAcceptedProduct is supplied by the original accepted Task or
 * original owner UI, never a renderer-authored approval flag. Its contract:
 * resolve the exact accepted revision and current disclosure decision, then
 * return only the approved subject data. It must enforce the source owner
 * and rights in the original runtime. Activity creates no new authority.
 *
 * The release Workspace is created/selected by the original Workspace owner
 * for this one product. inspectWholeWorkspace is the trusted original owner
 * inventory, not a restricted product service list pretending to be all data.
 */
export async function exportAcceptedTechnology({
 subject,workspace_id,product_sha256,readAcceptedProduct,inspectWholeWorkspace,isCurrent,
}={}){
 need(id(workspace_id)&&hex(product_sha256)&&typeof readAcceptedProduct==='function'&&
  typeof inspectWholeWorkspace==='function'&&typeof isCurrent==='function'&&
  ['getWorkspace','getObject','listObjects','putObject','exportPreview','exportPackage'].every(k=>typeof subject?.[k]==='function'),
  'TECHNOLOGY_NATIVE_OWNER_REQUIRED');
 const current=()=>need(isCurrent()===true,'TECHNOLOGY_NATIVE_CONTEXT_CHANGED');
 current();
 const product=validateTechnologyProduct(await readAcceptedProduct(product_sha256));
 current();
 need(await sha256Canonical(product)===product_sha256,'TECHNOLOGY_NATIVE_ACCEPTED_PRODUCT_CHANGED');
 const objectId='technology:'+product_sha256;
 const workspace=await subject.getWorkspace(workspace_id);
 current();
 need(workspace?.workspace_id===workspace_id&&workspace.deleted_at==null,'TECHNOLOGY_NATIVE_RELEASE_WORKSPACE');
 const checkWhole=async expected=>{
  const all=await inspectWholeWorkspace(workspace_id);
  current();
  need(all&&Array.isArray(all.objects)&&Array.isArray(all.assets)&&Array.isArray(all.relations)&&
   all.objects.length===expected&&all.assets.length===0&&all.relations.length===0&&
   (expected===0||all.objects[0]?.object_id===objectId&&all.objects[0]?.schema_id===TECHNOLOGY_SCHEMA),
   'TECHNOLOGY_NATIVE_RELEASE_WORKSPACE_NOT_ISOLATED');
 };
 const rows=await subject.listObjects({workspace_id,include_deleted:true});
 current();
 need(Array.isArray(rows)&&rows.length<=1&&(rows.length===0||rows[0].object_id===objectId),'TECHNOLOGY_NATIVE_RELEASE_WORKSPACE_NOT_ISOLATED');
 await checkWhole(rows.length);
 if(!rows.length){
  current();
  const saved=await subject.putObject({workspace_id,object_id:objectId,schema_id:TECHNOLOGY_SCHEMA,
   schema_version:TECHNOLOGY_VERSION,base_revision:0,data:product,extensions:{},
   event:{event_type:'iwxa.activity.technology.prepared',payload:{target:product.target}}});
  current();
  need(saved?.object?.object_id===objectId&&saved.object.revision===1,'TECHNOLOGY_NATIVE_WRITE_RECEIPT');
 }
 // Lost acknowledgement recovery is a read of the same immutable content,
 // never a second write. Reconfirm acceptance before invoking Exchange.
 await checkReadback(subject,workspace_id,objectId,product_sha256);current();await checkWhole(1);
 const approvedAgain=validateTechnologyProduct(await readAcceptedProduct(product_sha256));current();
 need(await sha256Canonical(approvedAgain)===product_sha256,'TECHNOLOGY_NATIVE_ACCEPTED_PRODUCT_CHANGED');
 const opt=options(workspace_id),preview=await subject.exportPreview(opt);current();
 need(preview?.workspaces?.length===1&&preview.workspaces[0]===workspace_id&&one(preview.counts)&&
  one(preview.summary?.included)&&zero(preview.summary?.excluded_by_permission)&&
  Array.isArray(preview.unsupported)&&!preview.unsupported.length&&Array.isArray(preview.conflicts)&&!preview.conflicts.length,
  'TECHNOLOGY_NATIVE_EXPORT_SCOPE');
 const artifact=await subject.exportPackage(opt);current();
 const manifest=artifact?.manifest;
 need(artifact?.bytes instanceof Uint8Array&&artifact.bytes.length>0&&artifact.bytes.length<=8*1024*1024&&
  hex(artifact.package_digest)&&manifest?.format==='iwxa.package'&&manifest.format_version==='1.0'&&
  manifest.package_digest===artifact.package_digest&&manifest.workspaces?.length===1&&manifest.workspaces[0]===workspace_id&&
  manifest.options?.include_history===false&&manifest.options?.include_assets===false&&manifest.options?.include_relations===false&&
  manifest.options?.include_schemas===true&&one(manifest.counts)&&artifact.validation?.ok===true,
  'TECHNOLOGY_NATIVE_EXPORT_ARTIFACT');
 await checkReadback(subject,workspace_id,objectId,product_sha256);current();await checkWhole(1);
 // No invented confirmation: original Exchange confirms after actual save.
 return {status:'ORIGINAL_TECHNOLOGY_ARCHIVE_READY',object_id:objectId,product_sha256,artifact,
  confirmation_required_after_save:true};
}
/** Complete the original owner publication, including the real physical file.
 * saveAndReadback is an EXISTING trusted native Host file operation. It owns
 * the save dialog and reads the final file from disk, not from the supplied
 * ArrayBuffer. A browser download initiation alone is not a save receipt.
 * The local review renderer never receives archive bytes or approval rights.
 *
 * A failed/cancelled save is not publication. After dispatch, a failure is
 * explicitly an uncertain file/confirmation state, never automatically retried.
 */
export async function releaseAcceptedTechnology(input={}){
 const {subject,workspace_id,product_sha256,readAcceptedProduct,inspectWholeWorkspace,isCurrent,saveAndReadback}=input;
 need(typeof saveAndReadback==='function'&&typeof subject?.confirmExport==='function',
  'TECHNOLOGY_NATIVE_SAVE_OWNER_REQUIRED');
 const current=()=>need(isCurrent()===true,'TECHNOLOGY_NATIVE_CONTEXT_CHANGED');
 const accepted=async()=>{
  current();
  const data=validateTechnologyProduct(await readAcceptedProduct(product_sha256));
  current();
  need(await sha256Canonical(data)===product_sha256,'TECHNOLOGY_NATIVE_ACCEPTED_PRODUCT_CHANGED');
  current();
 };
 const prepared=await exportAcceptedTechnology(input);
 const {artifact,object_id}=prepared;
 const expected=artifact.bytes.slice();
 // A native save can be irreversible. Revalidate right before giving it
 // bytes, rather than relying on a prior screen or export preview.
 await accepted();
 const filename=artifact.filename;
 need(typeof filename==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.iwxa$/i.test(filename)&&
  artifact.size===expected.byteLength,'TECHNOLOGY_NATIVE_SAVE_FILENAME');
 let saved;
 try{
  saved=await saveAndReadback({filename,bytes:expected.slice(),package_digest:artifact.package_digest,
   product_sha256});
 }catch{
  return {status:'TECHNOLOGY_SAVE_OUTCOME_UNKNOWN',object_id,product_sha256,package_digest:artifact.package_digest,
   file_saved:null,confirmation_required:true,export_confirmed:false};
 }
 if(saved?.status==='CANCELLED'){
  return {status:'TECHNOLOGY_RELEASE_CANCELLED',object_id,product_sha256,package_digest:artifact.package_digest,
   file_saved:false,confirmation_required:false,export_confirmed:false};
 }
 // Never accept a boolean or caller-supplied hash in place of a real readback.
 const same=saved?.status==='SAVED'&&saved.bytes instanceof Uint8Array&&saved.bytes.byteLength===expected.byteLength&&
  expected.every((v,i)=>v===saved.bytes[i]);
 if(!same)return {status:'TECHNOLOGY_SAVE_READBACK_FAILED',object_id,product_sha256,package_digest:artifact.package_digest,
  file_saved:saved?.status==='SAVED'?true:null,confirmation_required:true,export_confirmed:false};
 try{
  await accepted();
  await checkReadback(subject,workspace_id,object_id,product_sha256);current();
  const all=await inspectWholeWorkspace(workspace_id);current();
  need(all?.objects?.length===1&&all.objects[0]?.object_id===object_id&&
   all.objects[0]?.schema_id===TECHNOLOGY_SCHEMA&&Array.isArray(all.assets)&&!all.assets.length&&
   Array.isArray(all.relations)&&!all.relations.length,'TECHNOLOGY_NATIVE_RELEASE_WORKSPACE_NOT_ISOLATED');
  const receipt=await subject.confirmExport({package_digest:artifact.package_digest,workspace_ids:[workspace_id]});
  current();
  need(receipt?.package_digest===artifact.package_digest&&Array.isArray(receipt.workspace_ids)&&
   receipt.workspace_ids.length===1&&receipt.workspace_ids[0]===workspace_id&&
   receipt.confirmations===1&&Number.isFinite(Date.parse(receipt.confirmed_at)),
   'TECHNOLOGY_NATIVE_CONFIRM_RECEIPT');
  return {status:'ORIGINAL_TECHNOLOGY_RELEASED',object_id,product_sha256,package_digest:artifact.package_digest,
   file_saved:true,confirmation_required:false,export_confirmed:true,manifest:structuredClone(artifact.manifest),receipt};
 }catch{
  // File bytes exist; a lost Kernel response could also have committed.
  // Do not repeat confirmation, retract the file, or claim a successful release.
  return {status:'TECHNOLOGY_SAVED_CONFIRMATION_UNCERTAIN',object_id,product_sha256,
   package_digest:artifact.package_digest,file_saved:true,confirmation_required:true,export_confirmed:false};
 }
}
/** Recipient independently imports exactly one product through the original
 * scoped Exchange into a chosen empty Workspace. The caller is the original
 * owner, not a product-supplied grant. Activation is a separate domain action.
 */
export async function importTechnologyArchive({
 subject,workspace_id,bytes,confirmOriginalImport,isCurrent,expected_product_sha256,
}={}){
 need(id(workspace_id)&&bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=8*1024*1024&&
  typeof confirmOriginalImport==='function'&&typeof isCurrent==='function'&&
  (expected_product_sha256===undefined||hex(expected_product_sha256))&&
  ['getWorkspace','listObjects','getObject','importPreview','importCommit','importCancel'].every(k=>typeof subject?.[k]==='function'),
  'TECHNOLOGY_NATIVE_RECIPIENT_OWNER_REQUIRED');
 const current=()=>need(isCurrent()===true,'TECHNOLOGY_NATIVE_CONTEXT_CHANGED');
 const input=bytes.slice();current();
 const ws=await subject.getWorkspace(workspace_id);current();
 need(ws?.workspace_id===workspace_id&&ws.deleted_at==null,'TECHNOLOGY_NATIVE_RECIPIENT_WORKSPACE');
 const existing=await subject.listObjects({workspace_id,include_deleted:true});current();
 need(Array.isArray(existing)&&existing.length===0,'TECHNOLOGY_NATIVE_RECIPIENT_WORKSPACE_NOT_EMPTY');
 const handle=await subject.importPreview(input);
 const token=handle?.preview_token;
 let dispatch=false;
 try{
  current();
  const p=handle?.preview,m=p?.manifest;
  need(hex(handle?.package_digest)&&m?.format==='iwxa.package'&&m.format_version==='1.0'&&
   m.package_digest===handle.package_digest&&Array.isArray(m.workspaces)&&m.workspaces.length===1&&id(m.workspaces[0])&&
   m.options?.include_history===false&&m.options?.include_assets===false&&m.options?.include_relations===false&&
   m.options?.include_schemas===true&&one(m.counts)&&
   Array.isArray(p.objects)&&p.objects.length===1&&p.objects[0].schema_id===TECHNOLOGY_SCHEMA&&
   (p.objects[0].schema_version===undefined||p.objects[0].schema_version===TECHNOLOGY_VERSION)&&
   p.objects[0].workspace_id===m.workspaces[0]&&/^technology:[a-f0-9]{64}$/.test(p.objects[0].object_id)&&
   handle.allowed_modes?.includes('merge')&&m.workspaces[0]!==workspace_id&&
   Array.isArray(p.workspaces)&&p.workspaces.some(w=>w.workspace_id===m.workspaces[0]&&w.incoming_objects===1)&&
   one(p.included)&&zero(p.excluded_by_permission)&&
   Object.values(p.invalid??{missing:1}).every(v=>v===0)&&
   Array.isArray(p.conflicts)&&!p.conflicts.length&&Array.isArray(p.unsupported)&&!p.unsupported.length,'TECHNOLOGY_NATIVE_IMPORT_SCOPE');
  const oid=p.objects[0].object_id,digest=oid.slice('technology:'.length);
  need(expected_product_sha256===undefined||digest===expected_product_sha256,'TECHNOLOGY_NATIVE_IMPORT_PRODUCT_CHANGED');
  // Original recipient UI must display and confirm the actual preview.
  const sourceWorkspace=m.workspaces[0],packageDigest=handle.package_digest;
  need(await confirmOriginalImport(structuredClone(handle))===true,'TECHNOLOGY_NATIVE_IMPORT_NOT_CONFIRMED');current();
  dispatch=true;
  const receipt=await subject.importCommit({preview_token:token,package_digest:packageDigest,
   plan:{mode:'merge',include_workspaces:[sourceWorkspace],target_workspace:workspace_id,
    include_history:false,include_assets:false,include_relations:false,conflict:'skip'}});
  current();
  need(receipt?.package_digest===packageDigest&&receipt.mode==='merge'&&receipt.cancelled!==true&&
   receipt.workspace_id_map?.[sourceWorkspace]===workspace_id&&receipt.applied?.objects_inserted===1&&
   receipt.applied.objects_updated===0&&receipt.applied.objects_skipped===0&&receipt.applied.events===0&&
   receipt.applied.relations===0&&receipt.applied.assets===0&&
   Array.isArray(receipt.skipped_conflicts)&&receipt.skipped_conflicts.length===0,'TECHNOLOGY_NATIVE_IMPORT_RECEIPT');
  const product=await checkReadback(subject,workspace_id,oid,digest);current();
  return {status:'ORIGINAL_TECHNOLOGY_IMPORTED',workspace_id,object_id:oid,product_sha256:digest,product,receipt,activated:false};
 }finally{
  // Consume the ORIGINAL preview on a refusal, never replay an uncertain write.
  if(!dispatch&&token)try{await subject.importCancel(token);}catch{}
 }
}
