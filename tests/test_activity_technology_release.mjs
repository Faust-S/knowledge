import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePersonalTechnologyProduct,TECHNOLOGY_SCHEMA,TECHNOLOGY_VERSION} from '../modules/activity-base-anonymizer/technology-product.mjs';
import {releaseAcceptedTechnology,importTechnologyArchive} from '../modules/activity-base-anonymizer/technology-product-exchange.mjs';
import {personalRows,personalProposal} from './activity_technology_product_fixture.mjs';
const counts={workspaces:1,objects:1,events:0,relations:0,assets:0,schemas:1};
const zero=Object.fromEntries(Object.keys(counts).map(k=>[k,0]));
const workspace_id='release-ws';
const package_digest='a'.repeat(64);
async function fixture(){
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',personalProposal());
 let row=null,live=true,approved=true,other=false;
 const calls=[];
 const object_id='technology:'+p.product_sha256;
 const opts={include_history:false,include_assets:false,include_relations:false,include_schemas:true};
 const manifest={format:'iwxa.package',format_version:'1.0',package_digest,workspaces:[workspace_id],options:opts,counts};
 const subject={
  async getWorkspace(){return {workspace_id};},
  async listObjects(){return row?[row]:[];},
  async getObject(){return {object:row,relations:{incoming:[],outgoing:[]}};},
  async putObject(v){calls.push('put');row={...v,revision:1,deleted:false};return {object:row};},
  async exportPreview(){calls.push('preview');return {workspaces:[workspace_id],counts,summary:{included:counts,excluded_by_permission:zero},unsupported:[],conflicts:[]};},
  async exportPackage(){calls.push('export');return {filename:'technology.iwxa',bytes:new Uint8Array([1,2,3]),size:3,package_digest,manifest,validation:{ok:true}};},
  async confirmExport(v){calls.push('confirm');return {...v,confirmations:1,confirmed_at:'2026-11-24T00:00:00Z'};},
 };
 const input={subject,workspace_id,product_sha256:p.product_sha256,
  readAcceptedProduct:async()=>{if(!approved)throw Error('OWNER_REFUSED');return p.object_data;},
  inspectWholeWorkspace:async()=>({objects:row?[row]:[],assets:other?[{}]:[],relations:[]}),
  isCurrent:()=>live,saveAndReadback:async v=>{calls.push('save');return {status:'SAVED',bytes:v.bytes.slice()};}};
 return {input,calls,object_id,expire:()=>{live=false;},revoke:()=>{approved=false;},mix:()=>{other=true;}};
}
test('original release confirms only after actual trusted readback, does not repeat immutable write',async()=>{
 const x=await fixture();const r=await releaseAcceptedTechnology(x.input);
 assert.equal(r.status,'ORIGINAL_TECHNOLOGY_RELEASED');assert.equal(r.object_id,x.object_id);
 assert.equal(r.file_saved,true);assert.equal(r.export_confirmed,true);
 assert.equal(r.manifest.package_digest,r.package_digest);
 assert.deepEqual(x.calls,['put','preview','export','save','confirm']);
 await releaseAcceptedTechnology(x.input);assert.equal(x.calls.filter(c=>c==='put').length,1);
});
test('missing original owner and cancellation do not confirm export',async()=>{
 const x=await fixture();
 await assert.rejects(()=>releaseAcceptedTechnology({...x.input,saveAndReadback:undefined}),{code:'TECHNOLOGY_NATIVE_SAVE_OWNER_REQUIRED'});
 assert.deepEqual(x.calls,[]);
 x.revoke();await assert.rejects(()=>releaseAcceptedTechnology(x.input),/OWNER_REFUSED/);
 assert.deepEqual(x.calls,[]);
 const y=await fixture();const r=await releaseAcceptedTechnology({...y.input,saveAndReadback:async()=>({status:'CANCELLED'})});
 assert.equal(r.file_saved,false);assert.equal(r.export_confirmed,false);
 assert.ok(!y.calls.includes('confirm'));
});
test('bad or unknown physical save never confirms original Exchange',async()=>{
 for(const saveAndReadback of [async()=>true,async()=>({status:'SAVED',bytes:new Uint8Array([1,2,4])}),async()=>{throw Error('lost save reply');}]){
  const x=await fixture();const r=await releaseAcceptedTechnology({...x.input,saveAndReadback});
  assert.equal(r.export_confirmed,false);assert.equal(r.confirmation_required,true);assert.ok(!x.calls.includes('confirm'));
 }
});
test('owner revocation, selection changes and mixed data during save stay explicit',async()=>{
 for(const change of ['expire','revoke','mix']){
  const x=await fixture();
  const r=await releaseAcceptedTechnology({...x.input,saveAndReadback:async v=>{x[change]();return {status:'SAVED',bytes:v.bytes};}});
  assert.equal(r.status,'TECHNOLOGY_SAVED_CONFIRMATION_UNCERTAIN');assert.equal(r.file_saved,true);
  assert.ok(!x.calls.includes('confirm'));
 }
});
test('lost confirmation acknowledgement is not retried',async()=>{
 const x=await fixture();x.input.subject.confirmExport=async()=>{x.calls.push('confirm');throw Error('lost');};
 const r=await releaseAcceptedTechnology(x.input);
 assert.equal(r.status,'TECHNOLOGY_SAVED_CONFIRMATION_UNCERTAIN');assert.equal(r.file_saved,true);
 assert.equal(x.calls.filter(c=>c==='confirm').length,1);
});
test('selection invalidated after original import preview still consumes token',async()=>{
 let current=true,cancelled=0,commits=0;
 const subject={getWorkspace:async()=>({workspace_id}),listObjects:async()=>[],getObject:async()=>null,
  importPreview:async()=>{current=false;return {preview_token:'native-token'};},
  importCancel:async t=>{assert.equal(t,'native-token');cancelled++;return true;},importCommit:async()=>{commits++;}};
 await assert.rejects(()=>importTechnologyArchive({subject,workspace_id,bytes:new Uint8Array([1]),
  confirmOriginalImport:async()=>true,isCurrent:()=>current}),{code:'TECHNOLOGY_NATIVE_CONTEXT_CHANGED'});
 assert.equal(cancelled,1);assert.equal(commits,0);
});
