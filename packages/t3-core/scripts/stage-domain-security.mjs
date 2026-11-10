/** Domain-neutral static local first-run registration. Fail closed outside HTTPS loopback. */
import {mkdirSync,readFileSync,writeFileSync,lstatSync,linkSync,unlinkSync,renameSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {projectOwnerPassport,verifyStaticWorkspaceBootstrap} from './verify-static-workspace-bootstrap.mjs';
import {auditT2CapabilityControlPlane} from './verify-capability-control-plane.mjs';
const fail=x=>{throw new Error('T2_STATIC_STAGE_'+x)};
function occupied(path){try{lstatSync(path);return true}catch(e){if(e?.code==='ENOENT')return false;throw e}}
function safeAncestors(root,path){
 const rel=relative(root,path);
 if(!rel||rel==='..'||rel.startsWith('..'+sep))fail('ASSET_PATH_OUTSIDE_ROOT');
 let p=root;
 for(const part of rel.split(sep).slice(0,-1)){
  p=join(p,part);
  if(occupied(p)){const stat=lstatSync(p);if(stat.isSymbolicLink()||!stat.isDirectory())fail('UNSAFE_PARENT_PATH')}
 }
}
function localhost(origin){try{const u=new URL(origin);return u.protocol==='https:'&&u.origin===origin&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash}catch{return false}}
export function stageStaticFirstRunRegistration({publicRoot,config,owner,provisioner,plane,expected}){
 if(!publicRoot||!config||!Array.isArray(config.modules)||!localhost(config.origin)||
    !expected||!Array.isArray(expected.schemaIds))fail('INPUT_INVALID');
 const id=expected.workspaceId;
 if(config.modules.filter(m=>m.service_id===id&&m.base_path==='/workspace/').length!==1||
    config.modules.some(m=>m.service_id===expected.provisionerId))fail('SERVICE_BINDING_INVALID');
 const workspace=projectOwnerPassport(owner,id);
 const audit=auditT2CapabilityControlPlane({plane,servicePassports:{[id]:workspace,[expected.provisionerId]:provisioner}});
 const receipt=verifyStaticWorkspaceBootstrap({plane,owner,workspace,provisioner,expected});
 const root=resolve(publicRoot);
 if(!occupied(root)||lstatSync(root).isSymbolicLink()||!lstatSync(root).isDirectory())fail('PUBLIC_ROOT_INVALID');
 const existing=join(root,'_iwxa/domain.json');
 safeAncestors(root,existing);
 if(!occupied(existing)||lstatSync(existing).isSymbolicLink()||!lstatSync(existing).isFile())fail('DOMAIN_MISSING_OR_UNSAFE');
 const originalDomain=readFileSync(existing);
 if(JSON.stringify(JSON.parse(originalDomain.toString('utf8')))!==JSON.stringify(config))fail('DOMAIN_DRIFT');
 const newDomain={...structuredClone(config),modules:[...config.modules,
  {service_id:expected.provisionerId,base_path:'/workspace/',host_role:'workspace-first-run-provisioner',provisioning_scope:'https-loopback-development-only'}]};
 const docs={'_iwxa/domain.json':newDomain,
 ['_iwxa/services/'+id+'.json']:workspace,
 ['_iwxa/services/'+expected.provisionerId+'.json']:provisioner,
 '_iwxa/security/capability-control-plane.json':plane};
 // Fully stage content first; publish the new domain.json only after the
 // security resources exist. Refuse symlink parents and target collisions.
 const staged=[],installed=[];
 for(const name of Object.keys(docs)){
  const target=join(root,name);safeAncestors(root,target);
  if(name!=='_iwxa/domain.json'&&occupied(target))fail('ASSET_COLLISION:'+name);
 }
 try{
  for(const [name,doc] of Object.entries(docs)){
   const target=join(root,name);safeAncestors(root,target);
   mkdirSync(dirname(target),{recursive:true});
   const temporary=join(dirname(target),'.t2-stage-'+randomBytes(16).toString('hex'));
   writeFileSync(temporary,JSON.stringify(doc,null,2)+'\n',{flag:'wx',mode:0o644});
   staged.push({name,target,temporary});
  }
  for(const item of staged.filter(x=>x.name!=='_iwxa/domain.json')){
   linkSync(item.temporary,item.target);installed.push(item.target);
  }
  if(!readFileSync(existing).equals(originalDomain))fail('DOMAIN_DRIFT');
  renameSync(staged.find(x=>x.name==='_iwxa/domain.json').temporary,existing);
 }catch(e){
  for(const target of installed.reverse()){try{unlinkSync(target)}catch{/* preserve the original staging error */}}
  throw e;
 }finally{
  for(const item of staged){try{unlinkSync(item.temporary)}catch{/* cleanup is best effort */}}
 }
 return {...receipt,capabilityMetadataAudit:audit,domainId:config.domain_id,
 servedPaths:Object.keys(docs),ownerGrantsCreated:false,productionActivation:false};
}
