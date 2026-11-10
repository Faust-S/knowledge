import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectOwnerPassport, verifyStaticWorkspaceBootstrap } from '../scripts/verify-static-workspace-bootstrap.mjs';
const ownerId='test.owner', workspaceId='test.workspace', provisionerId='test.provisioner';
const schemaIds=['test.one','test.two'];
const perms=(create,ids)=>({workspace:{list:true,read:true,create,soft_delete:false,restore:false,purge:false},objects:{read:[...ids],write:[...ids],delete:[]},events:{read_scope:'service'},packages:{export:false,import:false,export_scope:'readable_objects',import_scope:'writable_objects'}});
const make=()=>{
 const owner={service_id:ownerId,base_path:'/owner/',supported_levels:['T0','T1'],input_object_types:[],output_object_types:[...schemaIds],schemas:Object.fromEntries(schemaIds.map(x=>[x,{schema_version:'1.0.0'}])),permissions:perms(false,schemaIds)};
 const workspace=projectOwnerPassport(owner,workspaceId);
 const provisioner={service_id:provisionerId,base_path:'/workspace/',supported_levels:['T0','T1'],input_object_types:[],output_object_types:[],schemas:{},permissions:perms(true,[])};
 const plane={schema_version:'0.3.1',snapshot_id:'local-service',resolver_id:'local-service',trusted_issuers:[],issuance_policies:[],services:[workspaceId,provisionerId].map(service_id=>({schema_version:'0.3.1',service_id,capability_control:'NONE',capability_ceiling:[],activation_any_of:[],operation_guards:[]}))};
 return {plane,owner,workspace,provisioner,expected:{ownerId,workspaceId,provisionerId,schemaIds}};
};
test('static metadata keeps create isolated in provisioner and no holder grants',()=>{
 const result=verifyStaticWorkspaceBootstrap(make()); assert.equal(result.status,'STATIC_REGISTRATION_VERIFIED_NOT_A_GRANT');assert.equal(result.ownerGrantsCreated,false);
});
test('rejects unapproved guard/bypass, issuer, issuance policy and grants',()=>{
 for(const mutate of [a=>a.plane.services[0].capability_control='REQUIRED',a=>a.plane.services[0].operation_guards=[{operation_id:'t1.putObject'}],a=>a.plane.trusted_issuers.push({issuer_id:'wrong'}),a=>a.plane.issuance_policies.push({policy_id:'wrong'}),a=>a.plane.grants=[]]){
  const data=make();mutate(data);assert.throws(()=>verifyStaticWorkspaceBootstrap(data),/T2_BOOTSTRAP_/);
 }
});
test('rejects owner write widening and role confusion',()=>{
 for(const mutate of [a=>a.workspace.permissions.workspace.create=true,a=>a.provisioner.permissions.objects.write=['test.one'],a=>a.provisioner.permissions.packages.export=true,a=>a.provisioner.permissions.workspace.purge=true,a=>a.workspace.schemas['foreign']={},a=>a.workspace.service_id='test.provisioner',a=>a.workspace.permissions.objects.read.push('foreign'),a=>a.owner.output_object_types.push('foreign')]){
  const data=make();mutate(data);assert.throws(()=>verifyStaticWorkspaceBootstrap(data),/T2_BOOTSTRAP_/);
 }
});
