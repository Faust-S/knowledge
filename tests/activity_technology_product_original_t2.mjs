// Extend the already-existing actual T2 Kernel witness. Create REAL original
// .iwxa bytes in one profile and independently import in another; not a fake
// archive writer, private native Agent or fabricated business execution.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {preparePersonalTechnologyProduct,prepareD05TechnologyProduct} from '../modules/activity-base-anonymizer/technology-product.mjs';
import {personalRows,personalProposal,personalBinding,d05Candidate,d05Binding} from './activity_technology_product_fixture.mjs';
export async function qualifyOriginalTechnologyProducts({browser,open,chromium,tmp,origin,writer,service}){
 const personal=await preparePersonalTechnologyProduct(personalRows(),'routine_001',personalProposal());
 const d05=await prepareD05TechnologyProduct(d05Candidate(),'Sheet part route');
 const entries=[{product:personal,binding:personalBinding(),source:'activity-product-personal-'+randomUUID(),recipient:'activity-recipient-personal-'+randomUUID()},
  {product:d05,binding:d05Binding(d05.object_data),source:'activity-product-d05-'+randomUUID(),recipient:'activity-recipient-d05-'+randomUUID()}];
 const archives=await browser.page.evaluate(async args=>{
  const {exportAcceptedTechnology}=await import('/_activity/technology-product-exchange.mjs');
  const owner=await globalThis.IWXA.connect({service_id:args.writer});
  const client=await globalThis.IWXA.connect({service_id:args.service});
  const subject={getWorkspace:w=>client.t1.getWorkspace(w),getObject:(w,o)=>client.t1.getObject(w,o),
   listObjects:q=>client.t1.listObjects(q),putObject:v=>client.t1.putObject(v),
   exportPreview:o=>client.t2.exportPreview(o),exportPackage:o=>client.t2.exportPackage(o)};
  const output=[];
  for(const e of args.entries){
   await owner.t1.createWorkspace({workspace_id:e.source,profile:'generic'});
   // The disposable source is a known new, single-type Workspace. The
   // fixture owner reads the original service objects; no source history
   // is copied here. Production must supply the original full owner.
   const inspect=async workspace=>({objects:await client.t1.listObjects({workspace_id:workspace,include_deleted:true}),
    assets:[],relations:[]});
   const published=await exportAcceptedTechnology({subject,workspace_id:e.source,
    product_sha256:e.product.product_sha256,readAcceptedProduct:async()=>e.product.object_data,
    inspectWholeWorkspace:inspect,isCurrent:()=>true});
   const a=published.artifact;
   const confirmed=await client.t2.confirmExport({package_digest:a.package_digest,workspace_ids:[e.source]});
   if(confirmed.package_digest!==a.package_digest)throw Error('TECHNOLOGY_NATIVE_EXPORT_CONFIRM');
   // A second export of the same product must recover, not write revision 2.
   const recovered=await exportAcceptedTechnology({subject,workspace_id:e.source,
    product_sha256:e.product.product_sha256,readAcceptedProduct:async()=>e.product.object_data,
    inspectWholeWorkspace:inspect,isCurrent:()=>true});
   const saved=await client.t1.getObject(e.source,published.object_id);
   if(saved.object.revision!==1||recovered.object_id!==published.object_id)throw Error('TECHNOLOGY_NATIVE_EXPORT_REPEATED_WRITE');
   output.push({bytes:Array.from(a.bytes),object_id:published.object_id,source:e.source,digest:e.product.product_sha256,
    manifest:a.manifest});
  }
  return output;
 },{writer,service,entries});
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
   writeFileSync(join(output,'qualification.json'),JSON.stringify({synthetic:true,originalKernel:true,independentRecipient:true,coldReadback:true,actualActivation:false,files},null,2)+'\n');
  }
  console.log('ACTIVITY_ORIGINAL_T2_TECHNOLOGY_ARCHIVES_INDEPENDENT_IMPORT_PASS',
   JSON.stringify({archives:2,originalKernel:true,independentRecipient:true,coldReadback:true,
    personalNativeInputs:true,d05NativeInputs:true,actualActivation:false}));
 }finally{if(receiver)await receiver.context.close();}
}
