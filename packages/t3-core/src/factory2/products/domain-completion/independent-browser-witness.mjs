import {createHash,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {serveRealKernelHost} from '../../../../scripts/real-kernel-e2e.mjs';
import {mkdtempSync,rmSync,existsSync,lstatSync,cpSync,writeFileSync} from 'node:fs';
import {resolve,join,relative,isAbsolute} from 'node:path';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
const qualifiedArtifacts=JSON.parse(readFileSync(new URL('./qualified-kernel-artifact.json',import.meta.url),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const fault=s=>{throw new Error('FACTORY2_WITNESS_'+s);};
function assertSafeSelector(v){if(typeof v!=='string'||v.length<2||v.length>250)fault('SELECTOR_INVALID');return v;}
const READER_ID='iwxa.t2.qualification.reader';
function assertReaderPassport(a){
 const p=a?.permissions;
 if(!p||p.workspace?.read!==true||p.workspace?.list!==true||p.workspace?.create!==false||
 p.workspace?.soft_delete!==false||p.workspace?.restore!==false||p.workspace?.purge!==false||
 !p.objects?.read?.includes('*')||p.objects?.write?.length||p.objects?.delete?.length||
 p.packages?.export!==false||p.packages?.import!==false||
 p.packages?.export_scope!=='readable_objects'||p.packages?.import_scope!=='writable_objects'||
 p.events?.read_scope!=='workspace')fault('INDEPENDENT_FULL_READ_ONLY_AUDITOR_REQUIRED');
}
export function stageQualificationReader(buildRoot,witness){
 if(witness.auditorMode===undefined)return {root:buildRoot,cleanup:()=>{}};
 if(witness.auditorMode!=='ISOLATED_READ_ONLY'||witness.journeys.some(j=>j.readServiceId!==READER_ID||j.denyServiceId!==READER_ID))fault('AUDITOR_BINDING_INVALID');
 const domain=JSON.parse(readFileSync(join(buildRoot,'_iwxa/domain.json'),'utf8'));
 if(domain.status==='production'||domain.modules?.some(x=>x.service_id===READER_ID))fault('AUDITOR_SOURCE_FORBIDDEN');
 const workspace=JSON.parse(readFileSync(join(buildRoot,'workspace/workspace.config.json'),'utf8'));
 const serviceId=workspace.workspace_service_id;
 const source=JSON.parse(readFileSync(join(buildRoot,'_iwxa/services',serviceId+'.json'),'utf8'));
 const catalog=JSON.parse(readFileSync(join(buildRoot,'_iwxa/service-catalog.json'),'utf8'));
 const control=JSON.parse(readFileSync(join(buildRoot,'_iwxa/security/capability-control-plane.json'),'utf8'));
 if(!Array.isArray(catalog.entries)||catalog.count!==catalog.entries.length||!Array.isArray(control.services))fault('AUDITOR_CATALOG_INVALID');
 const entry=catalog.entries.find(x=>x.service_id===serviceId);
 if(!entry||control.services.some(x=>x.service_id===READER_ID))fault('AUDITOR_CATALOG_INVALID');
 const temp=mkdtempSync(join(tmpdir(),'iwxa-t2-auditor-')),root=join(temp,'dist');
 try{
  cpSync(buildRoot,root,{recursive:true,filter:path=>{if(lstatSync(path).isSymbolicLink())fault('AUDITOR_SYMLINK');return true;}});
  const reader={...source,service_id:READER_ID,permissions:{
   workspace:{list:true,read:true,create:false,soft_delete:false,restore:false,purge:false},
   objects:{read:['*'],write:[],delete:[]},events:{read_scope:'workspace'},
   packages:{export:false,import:false,export_scope:'readable_objects',import_scope:'writable_objects'}}};
  assertReaderPassport(reader);
  const file='_iwxa/services/'+READER_ID+'.json',bytes=JSON.stringify(reader,null,2)+'\n';
  writeFileSync(join(root,file),bytes,{flag:'wx'});
  writeFileSync(join(root,'_iwxa/domain.json'),JSON.stringify({...domain,modules:[...domain.modules,{service_id:READER_ID,base_path:source.base_path}]}));
  writeFileSync(join(root,'_iwxa/security/capability-control-plane.json'),JSON.stringify({...control,services:[...control.services,
   {schema_version:'0.3.1',service_id:READER_ID,capability_control:'NONE',capability_ceiling:[],activation_any_of:[],operation_guards:[]}]}));
  writeFileSync(join(root,'_iwxa/service-catalog.json'),JSON.stringify({...catalog,count:catalog.entries.length+1,entries:[...catalog.entries,
   {...entry,service_id:READER_ID,service_version:reader.service_version,file,sha256:sha(Buffer.from(bytes))}]}));
  return {root,cleanup:()=>rmSync(temp,{recursive:true,force:true})};
 }catch(e){rmSync(temp,{recursive:true,force:true});throw e;}
}
export function assertSanctionedSiteHost(buildRoot,contract,inventory){
 const hostRef=contract.runtime.hostConfiguration;
 if(!hostRef||typeof hostRef.path!=='string'||!/^[a-f0-9]{64}$/.test(hostRef.sha256??''))fault('HOST_CONFIGURATION_REQUIRED');
 const path=resolve(buildRoot,hostRef.path),rel=relative(buildRoot,path);
 if(!rel||rel.startsWith('..')||isAbsolute(rel)||lstatSync(path).isSymbolicLink())fault('HOST_CONFIGURATION_PATH');
 const bytes=readFileSync(path);if(sha(bytes)!==hostRef.sha256)fault('HOST_CONFIGURATION_CHANGED');
 const host=JSON.parse(bytes),domain=JSON.parse(readFileSync(resolve(buildRoot,'_iwxa/domain.json')));
 if(host.host?.required_runtime_version!==contract.runtime.kernel||host.host?.required_contract_version!==contract.runtime.contract||host.domain_id!==domain.domain_id||host.host?.local_store_name!==domain.local_store_name||host.host?.direct_indexeddb!==false||!inventory.serviceIds.includes(host.workspace_service_id)||!domain.modules.some(m=>m.service_id===host.workspace_service_id))fault('SANCTIONED_HOST_MISMATCH');
 for(const journey of contract.witness.journeys){
  if(!/^[A-Za-z0-9._-]+$/.test(journey.readServiceId))fault('AUDITOR_SERVICE_ID');
  const auditor=JSON.parse(readFileSync(resolve(buildRoot,'_iwxa/services/'+journey.readServiceId+'.json')));
  if(auditor.service_id!==journey.readServiceId)fault('INDEPENDENT_FULL_READ_ONLY_AUDITOR_REQUIRED');
   if(contract.witness.auditorMode==='ISOLATED_READ_ONLY')assertReaderPassport(auditor);
   else if(auditor.permissions?.workspace?.read!==true||auditor.permissions?.workspace?.list!==true||!auditor.permissions?.objects?.read?.includes('*')||auditor.permissions?.objects?.write?.length)fault('INDEPENDENT_FULL_READ_ONLY_AUDITOR_REQUIRED');
 }
 return {path:hostRef.path,sha256:hostRef.sha256,serviceId:host.workspace_service_id};
}
/**
 * Release selection is explicit whenever the same internal Kernel version has
 * independently qualified bytes. Missing artifactId keeps the old qualified
 * pin; it never silently selects a successor with different checksums.
 */
export function selectQualifiedKernelRelease(runtime) {
  if(!runtime||typeof runtime!=='object'||typeof runtime.kernel!=='string'||typeof runtime.contract!=='string')
    fault('QUALIFIED_RELEASE_SELECTOR_INVALID');
  const selected=Object.prototype.hasOwnProperty.call(runtime,'artifactId');
  if(selected&&(typeof runtime.artifactId!=='string'||!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(runtime.artifactId)))
    fault('QUALIFIED_RELEASE_ID_INVALID');
  const matches=qualifiedArtifacts.artifacts.filter(a=>a.kernel===runtime.kernel&&a.contract===runtime.contract&&
    (selected ? a.artifactId===runtime.artifactId : !Object.prototype.hasOwnProperty.call(a,'artifactId')));
  if(matches.length!==1)fault('QUALIFIED_ARTIFACT_UNAVAILABLE');
  const artifact=matches[0];
  if(selected&&(artifact.releaseAccepted!==true||artifact.productionActivation!==false||!artifact.archiveSha256||
    !/^[0-9a-f]{64}$/.test(artifact.archiveSha256)))fault('QUALIFIED_RELEASE_NOT_ACCEPTED');
  return artifact;
}
export function assertQualifiedKernelArtifact(buildRoot, runtime) {
  const qualifiedArtifact=selectQualifiedKernelRelease(runtime);
  for(const file of qualifiedArtifact.files){
    const path=resolve(buildRoot,file.path);
    if(!existsSync(path)||lstatSync(path).isSymbolicLink()||sha(readFileSync(path))!==file.sha256)fault('KERNEL_ARTIFACT_MISMATCH:'+file.path);
  }
  return {
    kernel:qualifiedArtifact.kernel,contract:qualifiedArtifact.contract,
    ...(qualifiedArtifact.artifactId?{artifactId:qualifiedArtifact.artifactId,archiveSha256:qualifiedArtifact.archiveSha256}:{}),
    sourceSubjectSha256:qualifiedArtifact.sourceTreeSha256??qualifiedArtifact.baseSourceTreeSha256??qualifiedArtifact.sourcePackageSha256,
    artifactSha256:sha(Buffer.from(JSON.stringify(qualifiedArtifact.files))),files:qualifiedArtifact.files
  };
}
export function validateWitnessContract(x,inventory){
  const w=x.witness;
  if(w?.auditorMode!==undefined&&w.auditorMode!=='ISOLATED_READ_ONLY')fault('AUDITOR_MODE_INVALID');
  if(w?.fileFixtures!==undefined&&(!Array.isArray(w.fileFixtures)||w.fileFixtures.length>32||new Set(w.fileFixtures.map(f=>f?.id)).size!==w.fileFixtures.length))fault('FILE_FIXTURE_MANIFEST_INVALID');
  if(!w||w.previewOrigin!=='LOOPBACK_TLS'||w.runner!=='T2_PLAYWRIGHT_KERNEL_READBACK'||!Array.isArray(w.journeys)||w.journeys.length===0)fault('CONTRACT_MISSING');
  const expectedFamilies=new Set(inventory.persistentFamilies);
  const recorded=new Set();
  for(const j of w.journeys){
    if(!j||typeof j.serviceId!=='string'||!inventory.serviceIds.includes(j.serviceId)||!inventory.routes.includes(j.route)||!Array.isArray(j.actions)||j.actions.length===0)fault('JOURNEY_INVALID');
    for(const a of j.actions){
      if(!a||!['click','fill','select','check','waitFor','setInputFiles','expectConfirm'].includes(a.type))fault('ACTION_UNSUPPORTED');
      if(a.type!=='expectConfirm')assertSafeSelector(a.selector);
      if(a.type==='fill'&&typeof a.value!=='string')fault('ACTION_VALUE_INVALID');
      if(a.type==='select'){
        const byValue=Object.prototype.hasOwnProperty.call(a,'value');
        const byIndex=Object.prototype.hasOwnProperty.call(a,'index');
        const byCreated=Object.prototype.hasOwnProperty.call(a,'createdWorkspace');
        if(byValue&&typeof a.value!=='string')fault('ACTION_VALUE_INVALID');
        if(byValue&&!a.value.trim())fault('SELECT_TARGET_INVALID');
        if(Number(byValue)+Number(byIndex)+Number(byCreated)!==1||
           byIndex&&(!Number.isSafeInteger(a.index)||a.index<1)||
           byCreated&&a.createdWorkspace!==true)fault('SELECT_TARGET_INVALID');
      }
      if(a.type==='setInputFiles'&&(typeof a.fixtureId!=='string'||!w.fileFixtures?.some(f=>f.id===a.fixtureId)))fault('FILE_FIXTURE_UNDECLARED');
      if(a.type==='expectConfirm'&&(typeof a.message!=='string'||!a.message||!['accept','dismiss'].includes(a.decision)))fault('DIALOG_CONTRACT_INVALID');
    }
    if(expectedFamilies.size>0){
      if(!expectedFamilies.has(j.family)||recorded.has(j.family)||typeof j.readServiceId!=='string'||typeof j.denyServiceId!=='string'||typeof j.schemaId!=='string')fault('FAMILY_WITNESS_INVALID');
      assertSafeSelector(j.resultSelector);
      if(!j.actions.some(a=>a.type==='fill'&&a.value.includes('{{T2_CHALLENGE}}')))fault('FRESH_UI_CHALLENGE_REQUIRED');
      recorded.add(j.family);
    }else if(j.family!==null||typeof j.readServiceId!=='string')fault('READ_ONLY_WITNESS_INVALID');
  }
  if(recorded.size!==expectedFamilies.size)fault('FAMILY_WITNESS_COVERAGE_MISSING');
  return w;
}
export function verifiedInputFixture(qualificationRoot,siteRoot,witness,id){
 const files=witness.fileFixtures;
 if(!Array.isArray(files)||files.length>32||!files.every(x=>x&&/^[a-z][a-z0-9_-]{1,79}$/.test(x.id)&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(x.name)&&!x.name.includes('..')&&/^[a-f0-9]{64}$/.test(x.sha256))||new Set(files.map(x=>x.id)).size!==files.length)fault('FILE_FIXTURE_MANIFEST_INVALID');
 const item=files.find(x=>x.id===id);
 if(!item||typeof qualificationRoot!=='string'||!qualificationRoot)fault('FILE_FIXTURE_UNDECLARED');
 const site=realpathSync(siteRoot),directory=resolve(qualificationRoot,'WITNESS_FIXTURES');
 const relativeSite=relative(site,realpathSync(resolve(qualificationRoot)));
 if(!relativeSite||(!relativeSite.startsWith('..')&&!isAbsolute(relativeSite)))fault('FILE_FIXTURE_ROOT_IN_SITE');
 if(!existsSync(directory)||lstatSync(directory).isSymbolicLink()||!lstatSync(directory).isDirectory())fault('FILE_FIXTURE_DIRECTORY_INVALID');
 const rootReal=realpathSync(resolve(qualificationRoot)),directoryReal=realpathSync(directory);
 if(relative(rootReal,directoryReal)!=='WITNESS_FIXTURES')fault('FILE_FIXTURE_DIRECTORY_INVALID');
 const candidate=resolve(directory,id);
 if(relative(directory,candidate)!==id||lstatSync(candidate).isSymbolicLink())fault('FILE_FIXTURE_PATH_INVALID');
 const data=readFileSync(candidate);
 if(data.length===0||data.length>200*1024*1024)fault('FILE_FIXTURE_SIZE_INVALID');
 if(sha(data)!==item.sha256)fault('FILE_FIXTURE_HASH_MISMATCH');
 return {name:item.name,mimeType:'application/octet-stream',buffer:data};
}
/**
 * Only a successful scoped Kernel createWorkspace observed within this journey
 * may supply a dynamic ID. A mere DOM option is never proof of creation.
 */
export function witnessedNewWorkspaceIds(records,knownIds=[]){
 const known=new Set(knownIds),ids=new Set();
 for(const m of records){
  if(m?.type!=='commit'||m.operation!=='createWorkspace')continue;
  const inputId=m.input?.[0]?.workspace_id,receiptId=m.receipt?.workspace_id;
  if(typeof inputId!=='string'||!inputId.trim()||receiptId!==inputId||known.has(inputId))continue;
  ids.add(inputId);
 }
 return [...ids];
}
/**
 * An indexed target is allowed only when exactly one nonempty enabled option
 * exists. To select a newly created Workspace among older Workspaces, use
 * createdWorkspace:true; its value is taken from an observed Kernel receipt.
 * Both paths exercise a real native select and await controlled UI settlement.
 */
export async function selectWitnessOption(loc,a,{confirmationTimeoutMs=15000,getCreatedWorkspaces=()=>[]}={}){
 const byValue=Object.prototype.hasOwnProperty.call(a,'value');
 const byIndex=Object.prototype.hasOwnProperty.call(a,'index');
 const byCreated=Object.prototype.hasOwnProperty.call(a,'createdWorkspace');
 if(byValue&&typeof a.value!=='string')fault('ACTION_VALUE_INVALID');
 if(Number(byValue)+Number(byIndex)+Number(byCreated)!==1||
    byValue&&!a.value.trim()||
    byIndex&&(!Number.isSafeInteger(a.index)||a.index<1)||
    byCreated&&a.createdWorkspace!==true)fault('SELECT_TARGET_INVALID');
 if(!Number.isSafeInteger(confirmationTimeoutMs)||confirmationTimeoutMs<100||confirmationTimeoutMs>120000)fault('SELECT_TIMEOUT_INVALID');
 const deadline=Date.now()+confirmationTimeoutMs;
 const sleep=()=>new Promise(resolve=>setTimeout(resolve,50));
 if(byIndex)await loc.locator('option').nth(a.index).waitFor({state:'attached',timeout:confirmationTimeoutMs});
 const inspect=(select,target)=>{
  if(select.tagName!=='SELECT'||select.multiple)return {error:'CONTROL_INVALID'};
  const options=Array.from(select.options);
  const usable=o=>typeof o?.value==='string'&&!!o.value.trim()&&!o.disabled&&!(o.parentElement?.tagName==='OPTGROUP'&&o.parentElement.disabled);
  let option,index;
  if(target.index!==undefined){
   index=target.index;option=options[index];
   if(!usable(option))return {error:'OPTION_INVALID'};
   const candidates=options.filter(usable);
   if(candidates.length!==1||candidates[0]!==option)return {error:'AMBIGUOUS'};
  }else{
   const matches=options.filter(o=>o.value===target.value);
   if(!matches.length)return {error:'OPTION_MISSING'};
   if(matches.length!==1)return {error:'AMBIGUOUS'};
   option=matches[0];index=options.indexOf(option);
   if(!usable(option))return {error:'OPTION_INVALID'};
  }
  return {value:option.value,index,selectedIndex:select.selectedIndex,
   selectedValue:options[select.selectedIndex]?.value??'',pending:!!select.disabled};
 };
 let target,initial;
 for(;;){
  if(byCreated){
   const ids=getCreatedWorkspaces();
   if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!id.trim()))fault('SELECT_CREATED_WORKSPACE_INVALID');
   if(ids.length>1)fault('SELECT_CREATED_WORKSPACE_AMBIGUOUS');
   if(ids.length===1)target={value:ids[0]};
  }else target=byIndex?{index:a.index}:{value:a.value};
  if(target){
   const check=await loc.evaluate(inspect,target);
   if(check.error&&check.error!=='OPTION_MISSING')fault('SELECT_'+(byIndex?'INDEX_':byCreated?'CREATED_WORKSPACE_':'VALUE_')+check.error);
   if(!check.error&&!check.pending){initial=check;break;}
  }
  if(Date.now()>=deadline)fault('SELECT_TARGET_NOT_READY');
  await sleep();
 }
 const selected=await loc.selectOption(byIndex?{index:a.index}:{value:initial.value},{timeout:confirmationTimeoutMs});
 if(selected.length!==1||selected[0]!==initial.value)fault('SELECT_TARGET_MISMATCH');
 // Controlled React selects can become disabled while Host resolves focus.
 // Do not advance to a protected write until the ordinary UI settles.
 await sleep();
 for(;;){
  if(byCreated){
   const ids=getCreatedWorkspaces();
   if(ids.length!==1||ids[0]!==initial.value)fault('SELECT_CREATED_WORKSPACE_CHANGED');
  }
  const after=await loc.evaluate(inspect,target);
  if(after.error&&after.error!=='OPTION_MISSING')fault('SELECT_TARGET_'+after.error);
  if(!after.error&&after.value!==initial.value)fault('SELECT_TARGET_MISMATCH');
  if(!after.error&&!after.pending&&after.selectedIndex===initial.index&&after.selectedValue===initial.value)return;
  if(Date.now()>=deadline)fault('SELECT_CONFIRMATION_TIMEOUT');
  await sleep();
 }
}
async function actions(page,values,challenge,options){
 const expected=[];let badDialog=false;
 page.on('dialog',async dialog=>{const d=expected.shift();if(!d||dialog.type()!=='confirm'||dialog.message()!==d.message){badDialog=true;await dialog.dismiss();return;}if(d.decision==='accept')await dialog.accept();else await dialog.dismiss();});
  for(const a of values){const loc=a.type==='expectConfirm'?null:page.locator(a.selector).first();
    if(a.type==='click')await loc.click();
    else if(a.type==='fill')await loc.fill(a.value.replaceAll('{{T2_CHALLENGE}}',challenge));
    else if(a.type==='select')await selectWitnessOption(loc,a,{
      getCreatedWorkspaces:()=>witnessedNewWorkspaceIds(options.observedMutations(),options.beforeWorkspaceIds)
     });
    else if(a.type==='check')await loc.check();
    else if(a.type==='waitFor')await loc.waitFor({state:'visible'});
    else if(a.type==='setInputFiles')await loc.setInputFiles(verifiedInputFixture(options.qualificationRoot,options.siteRoot,options.witness,a.fixtureId));
    else if(a.type==='expectConfirm')expected.push({message:a.message,decision:a.decision});
  }
 if(badDialog||expected.length)fault('DIALOG_UNEXPECTED_OR_MISSING');
}
async function nativeRead(page,{serviceId,workspaceId,objectId,expectedContract}){
  return page.evaluate(async({serviceId,workspaceId,objectId,expectedContract})=>{
    const boot=globalThis.IWXA;
    if(!boot||typeof boot.connect!=='function')throw new Error('IWXA_KERNEL_BOOTSTRAP_MISSING');
    const session=await boot.connect({service_id:serviceId});
    if(serviceId==='iwxa.t2.qualification.reader'&&(!Array.isArray(session.granted_operations)||session.granted_operations.some(op=>!['t0.validate','t1.listWorkspaces','t1.getWorkspace','t1.listObjects','t1.getObject','t1.listAssets','t1.getAsset','t1.listEventsSince'].includes(op))||!['t0.validate','t1.listWorkspaces','t1.getWorkspace','t1.listObjects','t1.getObject','t1.listAssets','t1.getAsset','t1.listEventsSince'].every(op=>session.granted_operations.includes(op))))throw new Error('AUDITOR_RUNTIME_AUTHORITY_INVALID');
    if(session.contract_version!==expectedContract)throw new Error('KERNEL_CONTRACT_MISMATCH');
    if(session.service?.service_id!==serviceId)throw new Error('KERNEL_SERVICE_ID_MISMATCH');
    if(!session.granted_operations?.includes('t1.getObject'))throw new Error('KERNEL_OBJECT_READ_NOT_GRANTED');
    const found=await session.t1.getObject(workspaceId,objectId);
    if(!found?.object||found.object.workspace_id!==workspaceId||found.object.object_id!==objectId)throw new Error('KERNEL_OBJECT_READBACK_MISSING');
    if(!session.granted_operations?.includes('t1.listEventsSince'))throw new Error('KERNEL_HISTORY_READ_NOT_GRANTED');
    const history=(await session.t1.listEventsSince(workspaceId)).filter(e=>e.object_id===objectId);
    return {history,contract:session.contract_version,objectId:found.object.object_id,schemaId:found.object.schema_id,workspaceId:found.object.workspace_id,revision:found.object.revision,data:found.object.data};
  },{serviceId,workspaceId,objectId,expectedContract});
}
async function nativeSnapshot(page,serviceId){
 return page.evaluate(async serviceId=>{
  const session=await globalThis.IWXA.connect({service_id:serviceId});
  if(serviceId==='iwxa.t2.qualification.reader'&&(!Array.isArray(session.granted_operations)||session.granted_operations.some(op=>!['t0.validate','t1.listWorkspaces','t1.getWorkspace','t1.listObjects','t1.getObject','t1.listAssets','t1.getAsset','t1.listEventsSince'].includes(op))||!['t0.validate','t1.listWorkspaces','t1.getWorkspace','t1.listObjects','t1.getObject','t1.listAssets','t1.getAsset','t1.listEventsSince'].every(op=>session.granted_operations.includes(op))))throw new Error('AUDITOR_RUNTIME_AUTHORITY_INVALID');
   const workspaces=await session.t1.listWorkspaces();const rows=[],relations=[],events=[];
  for(const workspace of workspaces){
   const objects=await session.t1.listObjects({workspace_id:workspace.workspace_id});
   for(const object of objects){const found=await session.t1.getObject(workspace.workspace_id,object.object_id);rows.push({workspaceId:workspace.workspace_id,objectId:object.object_id,object:found.object});for(const relation of found.relations?.outgoing??[])relations.push({workspaceId:workspace.workspace_id,relation});}
  }
  for(const workspace of workspaces)for(const event of await session.t1.listEventsSince(workspace.workspace_id))events.push({workspaceId:workspace.workspace_id,event});
  return {workspaceIds:workspaces.map(w=>w.workspace_id).sort(),rows,relations,events};
 },serviceId);
}
export function assertNoUnrelatedMutation(before,after,identity,declared,mutations,serviceId){
 const key=(workspace,id)=>workspace+'\\0'+id;
 const indexed=(rows,id)=>{const result=new Map();for(const row of rows){const k=id(row);if(result.has(k))fault('SNAPSHOT_DUPLICATE');result.set(k,row);}return result;};
 const isObject=row=>key(row.workspaceId,row.objectId);
 const isRelation=row=>key(row.workspaceId,row.relation.relation_id);
 const isEvent=row=>key(row.workspaceId,row.event.event_id);
 const initial=indexed(before.rows,isObject),final=indexed(after.rows,isObject);
 const priorRelations=indexed(before.relations??[],isRelation),nextRelations=indexed(after.relations??[],isRelation);
 const priorEvents=indexed(before.events??[],isEvent),nextEvents=indexed(after.events??[],isEvent);
 const effects=declared??{objects:[],relations:[]};
 if(!Array.isArray(effects.objects)||!Array.isArray(effects.relations)||
    effects.objects.length>32||effects.relations.length>32||
    effects.objects.some(e=>!e||!['create','update'].includes(e.change)||typeof e.schemaId!=='string'||!e.schemaId||!Number.isSafeInteger(e.count)||e.count<1||e.count>32)||
    effects.relations.some(e=>!e||e.change!=='create'||typeof e.kind!=='string'||!e.kind||!Number.isSafeInteger(e.count)||e.count<1||e.count>32))fault('EFFECTS_CONTRACT_INVALID');
 for(const id of before.workspaceIds)if(!after.workspaceIds.includes(id))fault('WORKSPACE_DATA_LOSS');
 const addedWorkspaces=after.workspaceIds.filter(id=>!before.workspaceIds.includes(id));
 if(addedWorkspaces.length>1||addedWorkspaces.some(id=>id!==identity.workspaceId))fault('UNDECLARED_WORKSPACE_WRITE');
 const observed=mutations.filter(x=>x.serviceId===serviceId);
 const observedObjects=new Set(),observedRelations=new Set(),observedEvents=new Set();
 for(const m of observed){
   if(['deleteObject','deleteRelation','deleteAsset','putAsset','softDeleteWorkspace','restoreWorkspace','purgeCommit'].includes(m.operation))fault('DESTRUCTIVE_OR_UNDECLARED_OPERATION');
   if(['putObject','commitObjectGraph'].includes(m.operation)){
     if(!m.receipt?.event?.event_id||!m.receipt?.object?.object_id)fault('OBJECT_RECEIPT_MISSING');
     observedObjects.add(key(m.receipt.object.workspace_id,m.receipt.object.object_id));
     observedEvents.add(key(m.receipt.event.workspace_id,m.receipt.event.event_id));
     for(const r of m.receipt.relations_put??[])observedRelations.add(key(r.workspace_id,r.relation_id));
   }
   if(m.operation==='putRelation'){
     if(!m.receipt?.event?.event_id||!m.receipt?.relation?.relation_id)fault('RELATION_RECEIPT_MISSING');
     observedRelations.add(key(m.receipt.relation.workspace_id,m.receipt.relation.relation_id));
     observedEvents.add(key(m.receipt.event.workspace_id,m.receipt.event.event_id));
   }
 }
 if(!observedObjects.has(key(identity.workspaceId,identity.objectId)))fault('REAL_UI_KERNEL_COMMIT_MISSING');
 if(addedWorkspaces.length&&!observed.some(x=>x.operation==='createWorkspace'&&x.input?.[0]?.workspace_id===identity.workspaceId))fault('WORKSPACE_NOT_CREATED_BY_UI');
 const counts=new Map(),count=(tag)=>counts.set(tag,(counts.get(tag)??0)+1);
 for(const id of initial.keys())if(!final.has(id))fault('UNRELATED_OBJECT_CHANGED_OR_LOST');
 for(const [id,row] of final){
  const old=initial.get(id),change=!old?'create':JSON.stringify(old)===JSON.stringify(row)?'none':'update';
  if(change==='none')continue;
  if(!observedObjects.has(id))fault('UNOBSERVED_OBJECT_WRITE');
  if(id===key(identity.workspaceId,identity.objectId))continue;
  if(!effects.objects.some(e=>e.schemaId===row.object.schema_id&&e.change===change))fault('UNDECLARED_OBJECT_WRITE');
  count('object:'+change+':'+row.object.schema_id);
 }
 for(const e of effects.objects)if(counts.get('object:'+e.change+':'+e.schemaId)!==e.count)fault('RELATED_OBJECT_COUNT_MISMATCH');
 for(const [id,row] of priorRelations)if(JSON.stringify(nextRelations.get(id))!==JSON.stringify(row))fault('RELATION_CHANGED_OR_LOST');
 for(const [id,row] of nextRelations){
  if(priorRelations.has(id))continue;
  if(!observedRelations.has(id))fault('UNOBSERVED_RELATION_WRITE');
  if(!effects.relations.some(e=>e.kind===row.relation.kind))fault('UNDECLARED_RELATION_WRITE');
  count('relation:'+row.relation.kind);
 }
 for(const e of effects.relations)if(counts.get('relation:'+e.kind)!==e.count)fault('RELATED_RELATION_COUNT_MISMATCH');
 for(const [id,row] of priorEvents)if(JSON.stringify(nextEvents.get(id))!==JSON.stringify(row))fault('HISTORY_CHANGED_OR_LOST');
 const createdWorkspaces=new Set(observed.filter(x=>x.operation==='createWorkspace'&&typeof x.input?.[0]?.workspace_id==='string').map(x=>x.input[0].workspace_id));
 const creationEvents=new Set();
 for(const [id,row] of nextEvents)if(!priorEvents.has(id)&&!observedEvents.has(id)){
  const e=row.event;
  if(!createdWorkspaces.has(row.workspaceId)||e?.workspace_id!==row.workspaceId||e?.service_id!==serviceId||
     e?.object_id||typeof e?.event_type!=='string'||!/^workspace[.:-].*creat/i.test(e.event_type)||
     creationEvents.has(row.workspaceId))fault('UNOBSERVED_HISTORY_EVENT');
  creationEvents.add(row.workspaceId);
 }
}
export async function denyWrite(page,{serviceId,workspaceId,schemaId}){
  return page.evaluate(async({serviceId,workspaceId,schemaId})=>{
    const boot=globalThis.IWXA;
    if(!boot||typeof boot.connect!=='function')throw new Error('IWXA_KERNEL_BOOTSTRAP_MISSING');
    const session=await boot.connect({service_id:serviceId});
    if(!session?.t1||!Array.isArray(session.granted_operations)||session.granted_operations.includes('t1.putObject'))throw new Error('DENY_SERVICE_HAS_WRITE_OR_NO_KERNEL');
    if(typeof session.t1.putObject!=='function')throw new Error('DENY_OPERATION_SURFACE_MISSING');
    let rejected=null;
    try{
      await session.t1.putObject({workspace_id:workspaceId,object_id:'t2-denied-'+crypto.randomUUID(),schema_id:schemaId,schema_version:'1.0.0',data:{probe_only:true},event:{event_type:'test.unauthorized',payload:{}}});
    }catch(e){rejected=e;}
    if(rejected===null)throw new Error('UNAUTHORIZED_WRITE_SUCCEEDED');
    const code=String(rejected?.code??'').toUpperCase();
    const message=String(rejected?.message??'');
    if(!['PERMISSION_DENIED','OPERATION_NOT_GRANTED','NOT_GRANTED','AUTHORIZATION_DENIED','ACCESS_DENIED'].includes(code)&&
       !/operation not granted|permission denied|authorization denied|access denied/i.test(message)){
      throw new Error('DENIED_WRITE_WRONG_FAILURE:'+code);
    }
    return true;
  },{serviceId,workspaceId,schemaId});
}
export async function runIndependentSiteWitness({siteRoot,contract,inventory,buildDirectory,qualificationRoot}){
  const w=validateWitnessContract(contract,inventory);
  const staged=stageQualificationReader(resolve(siteRoot,buildDirectory),w);
  let host,artifact,loader;
  try{
    host=assertSanctionedSiteHost(staged.root,contract,inventory);
    artifact=assertQualifiedKernelArtifact(staged.root,contract.runtime);
    loader=readFileSync(join(staged.root,'_iwxa/loader.js'),'utf8');
  }catch(error){staged.cleanup();throw error;}
  const challenge=randomBytes(32).toString('hex'),secret=randomBytes(32).toString('hex'),binding='t2Witness'+randomBytes(16).toString('hex');
  const mutations=[],tampering=[];
  async function instrument(ctx){
    await ctx.exposeBinding(binding,(_source,token,record)=>{if(token!==secret)fault('OBSERVER_FORGERY');if(record.type==='tamper')tampering.push(record);else mutations.push(record);});
    await ctx.addInitScript({content:loader+'\n;('+installObserver.toString()+')('+JSON.stringify({binding,secret})+');'});
    await ctx.route('**/_iwxa/loader.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* pinned loader installed before site scripts by T2 witness */'}));
  }
  async function reader(ctx,origin){const p=await ctx.newPage();await p.goto(origin+'/__t2_independent_readback__');return p;}
  let browserModule;
  try{browserModule=await import('playwright')}catch{staged.cleanup();fault('PLAYWRIGHT_REQUIRED');}
  let dataDir;
  try{dataDir=mkdtempSync(join(tmpdir(),'iwxa-t2-witness-'));}catch(error){staged.cleanup();throw error;}
  let server=null,context=null;
  const observations=[],errors=[];
  try{
    const live=await serveRealKernelHost(staged.root,{independentWitness:true,previewOrigin:true});server=live.server;
    for(const j of w.journeys){
      context=await browserModule.chromium.launchPersistentContext(dataDir,{headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block'});
      await instrument(context);
      let page=context.pages()[0]||await context.newPage();
      page.on('pageerror',e=>errors.push(String(e?.message||e)));
      page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
      page.on('request',request=>{if(new URL(request.url()).origin!==live.origin)errors.push('EXTERNAL_REQUEST:'+request.url());});
      const baselineReader=await reader(context,live.origin);
      const baseline=await nativeSnapshot(baselineReader,j.readServiceId);
      await page.goto(new URL(j.route,live.origin).href,{waitUntil:'load'});
      if(tampering.length||errors.length)fault('PAGE_ERRORS_OR_IWXA_SUBSTITUTION');
      const mutationStart=mutations.length;
      await actions(page,j.actions,challenge,{qualificationRoot,siteRoot,witness:w,observedMutations:()=>mutations.slice(mutationStart),beforeWorkspaceIds:baseline.workspaceIds});
      if(inventory.persistentFamilies.length===0){
        const independent=await reader(context,live.origin);
        const read=await independent.evaluate(async serviceId=>{
          if(!globalThis.IWXA?.connect)throw new Error('KERNEL_BOOTSTRAP_MISSING');
          const s=await globalThis.IWXA.connect({service_id:serviceId});
          if(!s.granted_operations?.includes('t1.listWorkspaces'))throw new Error('WORKSPACE_READ_UNAUTHORIZED');
          const workspaces=await s.t1.listWorkspaces();if(!Array.isArray(workspaces))throw new Error('WORKSPACE_READ_INVALID');
          return {contract:s.contract_version,count:workspaces.length};
        },j.readServiceId);
        if(read.contract!==contract.runtime.contract)fault('READ_ONLY_RUNTIME_MISMATCH');
        if(tampering.length||mutations.length!==mutationStart)fault('READ_ONLY_MUTATION_OR_SUBSTITUTION');
        observations.push({serviceId:j.serviceId,route:j.route,readOnly:true,nativeRead:true,workspaceCount:read.count});
        await context.close();context=null;continue;
      }
      const node=page.locator(j.resultSelector).first();await node.waitFor({state:'visible'});
      const workspaceId=await node.getAttribute('data-t2-workspace-id'),objectId=await node.getAttribute('data-t2-object-id');
      if(!workspaceId||!objectId)fault('RESULT_LOCATOR_MISSING');
      const identity={serviceId:j.readServiceId,workspaceId,objectId,expectedContract:contract.runtime.contract};
      const independent=await reader(context,live.origin);
      const before=await nativeRead(independent,identity);
      const commits=mutations.slice(mutationStart).filter(x=>['putObject','commitObjectGraph'].includes(x.operation)&&x.serviceId===j.serviceId);
      if(tampering.length)fault('IWXA_SUBSTITUTION');
      const commit=commits.find(x=>JSON.stringify(x.input).includes(challenge)&&JSON.stringify(x.input).includes(objectId));
      if(!commit||!JSON.stringify(before.data).includes(challenge))fault('REAL_UI_KERNEL_COMMIT_MISSING');
      const afterSnapshot=await nativeSnapshot(independent,j.readServiceId);
      assertNoUnrelatedMutation(baseline,afterSnapshot,identity,j.expectedEffects,mutations.slice(mutationStart),j.serviceId);
      if(before.schemaId!==j.schemaId)fault('RESULT_SCHEMA_MISMATCH');
      if(!before.history.length)fault('KERNEL_HISTORY_MISSING');
      const historyDigest=sha(Buffer.from(JSON.stringify(before.history)));
      const beforeDigest=sha(Buffer.from(JSON.stringify(before.data)));
      await page.reload({waitUntil:'load'});
      const refreshed=await nativeRead(independent,identity);
      if(JSON.stringify(refreshed)!==JSON.stringify(before))fault('PAGE_RELOAD_READBACK_MISMATCH');
      await denyWrite(independent,{serviceId:j.denyServiceId,workspaceId,schemaId:j.schemaId});
      const afterDenied=await nativeSnapshot(independent,j.readServiceId);
      if(JSON.stringify(afterDenied)!==JSON.stringify(afterSnapshot))fault('DENIED_WRITE_MUTATED_STORE');
      await context.close();context=null;
      context=await browserModule.chromium.launchPersistentContext(dataDir,{headless:true,ignoreHTTPSErrors:true,serviceWorkers:'block'});
      await instrument(context);
      page=context.pages()[0]||await context.newPage();
      await page.goto(new URL(j.route,live.origin).href,{waitUntil:'load'});
      const independentAfter=await reader(context,live.origin);
      const after=await nativeRead(independentAfter,identity);
      const afterDigest=sha(Buffer.from(JSON.stringify(after.data)));
      const restartedSnapshot=await nativeSnapshot(independentAfter,j.readServiceId);
      if(JSON.stringify(restartedSnapshot)!==JSON.stringify(afterSnapshot))fault('RESTART_DATA_LOSS_OR_EXTRA_WRITE');
      if(sha(Buffer.from(JSON.stringify(after.history)))!==historyDigest)fault('KERNEL_RESTART_HISTORY_MISMATCH');
      if(afterDigest!==beforeDigest||after.revision!==before.revision)fault('KERNEL_RESTART_READBACK_MISMATCH');
      observations.push({serviceId:j.serviceId,family:j.family,route:j.route,objectId,workspaceId,revision:after.revision,payloadSha256:afterDigest,afterKernelRestart:true,afterPageReload:true,historyPreserved:true,historySha256:historyDigest,deniedWriteRejected:true,independentReader:true,freshUiChallenge:true,unrelatedObjectsPreserved:true,noUndeclaredObjects:true,nativeOperation:commit.operation,receiptSha256:sha(Buffer.from(JSON.stringify(commit.receipt)))});
      await context.close();context=null;
    }
    if(errors.length)fault('PAGE_ERRORS');
    return {schema:'IWXA_T2_INDEPENDENT_BROWSER_WITNESS_V1',status:'PASS',runner:'T2_OWNED_PLAYWRIGHT',kernelArtifact:artifact,sanctionedHost:host,uiChallenge:challenge,isolatedReader:true,contractVersion:contract.runtime.contract,observations,pageErrors:errors,productionActivation:false};
  } finally {
    if(context)await context.close().catch(()=>{});
    if(server)await new Promise(resolveClose=>server.close(resolveClose));
    rmSync(dataDir,{recursive:true,force:true});
    staged.cleanup();
  }
}

function installObserver({binding,secret}) {
  const trusted=globalThis.IWXA;
  const connect=trusted.connect.bind(trusted);
  const notify=globalThis[binding];
  const api=Object.freeze({...trusted,connect:async request=>{
    const session=await connect(request);
    if(request?.service_id==='iwxa.t2.qualification.reader'&&location.pathname!=='/__t2_independent_readback__')throw new Error('T2_WITNESS_AUDITOR_SITE_ACCESS_FORBIDDEN');
    const watch=(surface,operations)=>surface&&new Proxy({...surface},{get(target,key){
      const value=target[key];
      if(typeof value!=='function')return value;
      return async(...args)=>{
        const result=await value.apply(target,args);
        if(operations.includes(key))await notify(secret,{type:'commit',serviceId:session.service.service_id,
          operation:key,input:JSON.parse(JSON.stringify(args)),receipt:JSON.parse(JSON.stringify(result))});
        return result;
      };
    }});
    const t1=watch(session.t1,['putObject','commitObjectGraph','putRelation','deleteRelation',
      'deleteObject','createWorkspace','putAsset','deleteAsset','softDeleteWorkspace','restoreWorkspace','purgeCommit']);
    const t2=watch(session.t2,['importCommit']);
    return Object.freeze({...session,t1,...(t2?{t2}:{})});
  }});
  Object.defineProperty(globalThis,'IWXA',{configurable:false,get:()=>api,set:()=>{void notify(secret,{type:'tamper'});throw new Error('T2_WITNESS_IWXA_SUBSTITUTION');}});
}
