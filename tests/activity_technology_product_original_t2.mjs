// Extend the already-existing actual T2 Kernel witness. Create REAL original
// .iwxa bytes in one profile and independently import in another; not a fake
// archive writer, private native Agent or fabricated business execution.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {preparePersonalTechnologyProduct,prepareD05TechnologyProduct} from '../modules/activity-base-anonymizer/technology-product.mjs';
import {personalRows,personalProposal,personalBinding,d05Candidate,d05Binding} from './activity_technology_product_fixture.mjs';
export async function qualifyOriginalTechnologyProducts({browser,open,chromium,tmp,origin,writer,service}){
 const personal=await preparePersonalTechnologyProduct(personalRows(),'routine_001',personalProposal());
 const d05=await prepareD05TechnologyProduct(d05Candidate(),'Sheet part route');
 const entries=[{product:personal,binding:personalBinding(),source:'activity-product-personal-'+randomUUID(),recipient:'activity-recipient-personal-'+randomUUID()},
  {product:d05,binding:d05Binding(d05.object_data),source:'activity-product-d05-'+randomUUID(),recipient:'activity-recipient-d05-'+randomUUID()}];
 const outputDir=join(tmp,'activity-physically-saved-technology');
 mkdirSync(outputDir,{recursive:true});
 let saves=0;
 // The fixture owner supplies a real physical save/readback, not a browser
 // download initiation or a boolean. All files here are synthetic products.
 await browser.page.exposeFunction('activityQualificationSaveAndReadback',input=>{
  const path=join(outputDir,'saved-'+(++saves)+'.iwxa');
  writeFileSync(path,Buffer.from(input.bytes),{flag:'wx'});
  return {status:'SAVED',bytes:Array.from(readFileSync(path))};
 });
 const archives=await browser.page.evaluate(async args=>{
  const {exportAcceptedTechnology}=await import('/_activity/technology-product-exchange.mjs');
  const {createTechnologyReleaseHost}=await import('/_activity/technology-release-host.mjs');
  const owner=await globalThis.IWXA.connect({service_id:args.writer});
  const client=await globalThis.IWXA.connect({service_id:args.service});
  const subject={getWorkspace:w=>client.t1.getWorkspace(w),getObject:(w,o)=>client.t1.getObject(w,o),
   listObjects:q=>client.t1.listObjects(q),putObject:v=>client.t1.putObject(v),
   exportPreview:o=>client.t2.exportPreview(o),exportPackage:o=>client.t2.exportPackage(o),confirmExport:v=>client.t2.confirmExport(v)};
  const output=[];
  for(const e of args.entries){
   await owner.t1.createWorkspace({workspace_id:e.source,profile:'generic'});
   // The disposable source is a known new, single-type Workspace. The
   // fixture owner reads the original service objects; no source history
   // is copied here. Production must supply the original full owner.
   const inspect=async workspace=>({objects:await client.t1.listObjects({workspace_id:workspace,include_deleted:true}),
    assets:[],relations:[]});
   let savedBytes=null,approvedManifest=null,ownerDecisions=0;
   const releaseSubject={...subject,exportPackage:async options=>{
    const artifact=await subject.exportPackage(options);
    approvedManifest=structuredClone(artifact.manifest);return artifact;
   }};
   const host=createTechnologyReleaseHost({subscribeInvalidation:()=>()=>{},
    resolveOriginalRelease:async (request,current)=>{
     ownerDecisions++;
     if(request.product_sha256!==e.product.product_sha256||!current())return null;
     return {subject:releaseSubject,workspace_id:e.source,
      readAcceptedProduct:async()=>e.product.object_data,
      inspectWholeWorkspace:inspect,isCurrent:current,saveAndReadback:async input=>{
       const result=await globalThis.activityQualificationSaveAndReadback({...input,bytes:Array.from(input.bytes)});
       savedBytes=new Uint8Array(result.bytes);
       return {status:result.status,bytes:savedBytes};
      }};
    }});
   let published;
   try{
    const request={product_sha256:e.product.product_sha256,object_data:e.product.object_data};
    published=await host.port.reviewAndRelease(request);
    if(published.status!=='ORIGINAL_TECHNOLOGY_RELEASED'||published.export_confirmed!==true||!savedBytes)
     throw Error('TECHNOLOGY_NATIVE_EXPORT_CONFIRM');
    if(Object.keys(published).sort().join(',')!=='export_confirmed,file_saved,package_digest,product_sha256,status')
     throw Error('TECHNOLOGY_NATIVE_HOST_RECEIPT_SCOPE');
    const replay=await host.port.reviewAndRelease(request);
    if(JSON.stringify(replay)!==JSON.stringify(published)||ownerDecisions!==1)
     throw Error('TECHNOLOGY_NATIVE_HOST_DUPLICATE_DISPATCH');
   }finally{host.dispose();}
   // Independent recovery must find the same immutable product revision.
   const recovered=await exportAcceptedTechnology({subject,workspace_id:e.source,
    product_sha256:e.product.product_sha256,readAcceptedProduct:async()=>e.product.object_data,
    inspectWholeWorkspace:inspect,isCurrent:()=>true});
   const object_id='technology:'+e.product.product_sha256;
   const saved=await client.t1.getObject(e.source,object_id);
   if(saved.object.revision!==1||recovered.object_id!==object_id||approvedManifest?.package_digest!==published.package_digest)
    throw Error('TECHNOLOGY_NATIVE_EXPORT_REPEATED_WRITE');
   output.push({bytes:Array.from(savedBytes),object_id,source:e.source,digest:e.product.product_sha256,
    manifest:approvedManifest});
  }
  return output;
 },{writer,service,entries});
 assert.equal(saves,2);
 for(const a of archives){
  assert.equal(a.manifest.format,'iwxa.package');
  assert.equal(a.manifest.counts.objects,1);
  assert.equal(a.manifest.counts.events,0);
  assert.equal(a.manifest.counts.assets,0);
  assert.equal(a.manifest.counts.relations,0);
 }
 const receiverProfile=join(tmp,'activity-independent-technology-recipient');
 let receiver=null;
 try{
  receiver=await open(chromium,receiverProfile,origin);
  const imported=await receiver.page.evaluate(async args=>{
   const {importTechnologyArchive}=await import('/_activity/technology-product-exchange.mjs');
   const {prepareD05RecipientInputs,preparePersonalRecipientActivation}=await import('/_activity/technology-product.mjs');
   const owner=await globalThis.IWXA.connect({service_id:args.writer});
   const client=await globalThis.IWXA.connect({service_id:args.service});
   const subject={getWorkspace:w=>client.t1.getWorkspace(w),getObject:(w,o)=>client.t1.getObject(w,o),
    listObjects:q=>client.t1.listObjects(q),importPreview:b=>client.t2.importPreview(b),
    importCommit:v=>client.t2.importCommit(v),importCancel:t=>client.t2.importCancel(t)};
   const result=[];
   for(let i=0;i<args.entries.length;i++){
    const e=args.entries[i],a=args.archives[i];
    // Different IndexedDB profile: no access to sender's saved Object.
    if(await client.t1.getWorkspace(e.source))throw Error('TECHNOLOGY_RECIPIENT_NOT_INDEPENDENT');
    await owner.t1.createWorkspace({workspace_id:e.recipient,profile:'generic'});
    const r=await importTechnologyArchive({subject,workspace_id:e.recipient,bytes:new Uint8Array(a.bytes),
     confirmOriginalImport:async()=>true,isCurrent:()=>true,expected_product_sha256:a.digest});
    const native=r.product.target==='PERSONAL_AGENT_TASK_PROMPT'?preparePersonalRecipientActivation(r.product,e.binding):
      prepareD05RecipientInputs(r.product,e.binding);
    result.push({object_id:r.object_id,product:r.product,native,status:r.status});
   }
   return result;
  },{writer,service,entries,archives});
  assert.equal(imported.length,2);
  assert.deepEqual(imported[0].product,personal.object_data);
  assert.equal(imported[0].native.job_kind,'task_prompt');
  assert.equal(imported[0].native.options.expected_workspace_id,'recipient-personal');
  assert.equal(imported[0].native.activated,false);
  assert.deepEqual(imported[1].product,d05.object_data);
  assert.equal(imported[1].native.route_inputs.quantity,'20');
  assert.equal(imported[1].native.quality_plan_inputs.checks[0].upper_limit,'100.2');
  assert.equal(imported[1].native.quality_plan_inputs.checks[0].blocking,true);
  assert.equal(imported[1].native.activated,false);
  await receiver.context.close();receiver=null;
  receiver=await open(chromium,receiverProfile,origin);
  const cold=await receiver.page.evaluate(async args=>{
   const {validateTechnologyProduct}=await import('/_activity/technology-product.mjs');
   const client=await globalThis.IWXA.connect({service_id:args.service});
   return Promise.all(args.entries.map(async(e,i)=>{
    const row=await client.t1.getObject(e.recipient,args.archives[i].object_id);
    if(row?.object?.workspace_id!==e.recipient||row.object.revision!==1)throw Error('TECHNOLOGY_NATIVE_COLD_READBACK');
    return validateTechnologyProduct(row.object.data);
   }));
  },{service,entries,archives});
  assert.deepEqual(cold,[personal.object_data,d05.object_data]);
  // Publish only the two qualified, synthetic products, never original source data.
  const output=process.env.IWXA_ACTIVITY_TECHNOLOGY_ARTIFACTS;
  if(output){
   mkdirSync(output,{recursive:true});
   const files=['personal-technology.iwxa','d05-technology.iwxa'].map((name,i)=>{
    const bytes=Buffer.from(archives[i].bytes);
    writeFileSync(join(output,name),bytes);
    return {name,sha256:createHash('sha256').update(bytes).digest('hex'),product_sha256:archives[i].digest};
   });
   writeFileSync(join(output,'qualification.json'),JSON.stringify({synthetic:true,originalKernel:true,physicalSaveReadback:true,independentRecipient:true,coldReadback:true,actualActivation:false,files},null,2)+'\n');
  }
  console.log('ACTIVITY_ORIGINAL_T2_TECHNOLOGY_ARCHIVES_INDEPENDENT_IMPORT_PASS',
   JSON.stringify({archives:2,originalKernel:true,physicalSaveReadback:true,independentRecipient:true,coldReadback:true,
    personalNativeInputs:true,d05NativeInputs:true,actualActivation:false}));
 }finally{if(receiver)await receiver.context.close();}
}
