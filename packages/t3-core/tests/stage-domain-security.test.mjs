import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageStaticFirstRunRegistration} from '../scripts/stage-domain-security.mjs';
const ids=['x.example.object'];
const perms=(create,schemas)=>({workspace:{list:true,read:true,create,soft_delete:false,restore:false,purge:false},objects:{read:schemas,write:schemas,delete:[]},events:{read_scope:'service'},packages:{export:false,import:false,export_scope:'readable_objects',import_scope:'writable_objects'}});
function input(){
 const owner={service_id:'test.owner',base_path:'/owner/',supported_levels:['T0','T1'],input_object_types:[],output_object_types:ids,schemas:{'x.example.object':{schema_version:'1.0.0'}},permissions:perms(false,ids)};
 const provisioner={service_id:'test.provisioner',base_path:'/workspace/',supported_levels:['T0','T1'],input_object_types:[],output_object_types:[],schemas:{},permissions:perms(true,[])};
 const plane={schema_version:'0.3.1',snapshot_id:'test.snapshot',resolver_id:'test.resolver',trusted_issuers:[],issuance_policies:[],services:['test.workspace','test.provisioner'].map(service_id=>({schema_version:'0.3.1',service_id,capability_control:'NONE',capability_ceiling:[],activation_any_of:[],operation_guards:[]}))};
 const config={domain_id:'test',origin:'https://localhost:8443',workspace_profile:'personal',modules:[{service_id:'test.workspace',base_path:'/workspace/'}]};
 return {config,owner,provisioner,plane,expected:{ownerId:'test.owner',workspaceId:'test.workspace',provisionerId:'test.provisioner',schemaIds:ids}};
}
function fixture(cb){const dir=mkdtempSync(join(tmpdir(),'t2-stage-'));mkdirSync(join(dir,'_iwxa'));const x=input();writeFileSync(join(dir,'_iwxa/domain.json'),JSON.stringify(x.config));try{cb(dir,x)}finally{rmSync(dir,{recursive:true,force:true})}}
test('stages resources and activates domain config last',()=>fixture((dir,x)=>{
 const r=stageStaticFirstRunRegistration({publicRoot:dir,...x});assert.equal(r.ownerGrantsCreated,false);
 assert.equal(JSON.parse(readFileSync(join(dir,'_iwxa/domain.json'))).modules.at(-1).host_role,'workspace-first-run-provisioner');
 assert.equal(existsSync(join(dir,'_iwxa/security/capability-control-plane.json')),true);
}));
test('symlinked or junction parent refused; domain config stays unmodified',()=>fixture((dir,x)=>{
 const out=mkdtempSync(join(tmpdir(),'t2-stage-external-'));
 try{symlinkSync(out,join(dir,'_iwxa/services'),process.platform==='win32'?'junction':'dir');const before=readFileSync(join(dir,'_iwxa/domain.json'));
 assert.throws(()=>stageStaticFirstRunRegistration({publicRoot:dir,...x}),/UNSAFE_PARENT_PATH/);
 assert.deepEqual(readFileSync(join(dir,'_iwxa/domain.json')),before);
 assert.equal(existsSync(join(out,'test.workspace.json')),false);
 }finally{rmSync(out,{recursive:true,force:true})}
}));
test('existing control plane never overwritten',()=>fixture((dir,x)=>{
 mkdirSync(join(dir,'_iwxa/security'));writeFileSync(join(dir,'_iwxa/security/capability-control-plane.json'),'foreign');
 assert.throws(()=>stageStaticFirstRunRegistration({publicRoot:dir,...x}),/ASSET_COLLISION/);
 assert.equal(readFileSync(join(dir,'_iwxa/security/capability-control-plane.json'),'utf8'),'foreign');
}));
