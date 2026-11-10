/** Metadata-only T2 Capability Control Plane 0.3.1 verifier. Never issues grants. */
const fail = code => {throw new Error('T2_CAPABILITY_DECLARATION_'+code)};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const unique=a=>Array.isArray(a)&&a.every(x=>typeof x==='string'&&x.length>0)&&new Set(a).size===a.length;
const subset=(a,b)=>a.every(x=>b.includes(x));
export function auditT2CapabilityControlPlane({plane,servicePassports}) {
 if(!record(plane)||plane.schema_version!=='0.3.1'||!Array.isArray(plane.services)||
    !Array.isArray(plane.trusted_issuers)||!Array.isArray(plane.issuance_policies)||
    !record(servicePassports)||'grants' in plane||'receipts' in plane||'private_key' in plane||
    typeof plane.snapshot_id!=='string'||!plane.snapshot_id||
    typeof plane.resolver_id!=='string'||!plane.resolver_id)fail('INPUT_INVALID');
 const names=Object.keys(servicePassports);
 if(!unique(names)||names.length!==plane.services.length)fail('SERVICE_SET_INVALID');
 const declared=new Set();
 for(const d of plane.services){
   if(!record(d)||d.schema_version!=='0.3.1'||typeof d.service_id!=='string'||
      !record(servicePassports[d.service_id])||servicePassports[d.service_id].service_id!==d.service_id||
      declared.has(d.service_id)||!['NONE','REQUIRED'].includes(d.capability_control)||
      !unique(d.capability_ceiling)||!unique(d.activation_any_of)||!Array.isArray(d.operation_guards)||
      !subset(d.activation_any_of,d.capability_ceiling))fail('SERVICE_DECLARATION_INVALID');
   declared.add(d.service_id);
   if(d.capability_control==='NONE'&&(d.capability_ceiling.length||d.activation_any_of.length||d.operation_guards.length))fail('NONE_WITH_GUARDS');
   if(d.capability_control==='REQUIRED'&&(!d.capability_ceiling.length||!d.operation_guards.length))fail('REQUIRED_WITHOUT_GUARDS');
   const seen=new Set();
   for(const guard of d.operation_guards){
      if(!record(guard)||typeof guard.guard_id!=='string'||seen.has(guard.guard_id)||
         typeof guard.operation_id!=='string'||!/^t[12]\.[A-Za-z][A-Za-z0-9]*$/.test(guard.operation_id)||
         !unique(guard.required_capabilities_all)||!unique(guard.required_capabilities_any)||
         !unique(guard.schema_ids)||(!guard.required_capabilities_all.length&&!guard.required_capabilities_any.length)||
         !subset(guard.required_capabilities_all,d.capability_ceiling)||
         !subset(guard.required_capabilities_any,d.capability_ceiling)||
         guard.schema_ids.some(s=>!Object.hasOwn(servicePassports[d.service_id].schemas??{},s)))fail('GUARD_SCOPE_INVALID');
      seen.add(guard.guard_id);
   }
 }
 if(!names.every(id=>declared.has(id)))fail('SERVICE_SET_MISMATCH');
 for(const issuer of plane.trusted_issuers){
   if(!record(issuer)||typeof issuer.issuer_id!=='string'||typeof issuer.key_id!=='string'||
      typeof issuer.public_key!=='string'||issuer.public_key.length<16||
      !unique(issuer.allowed_audiences)||!unique(issuer.allowed_capability_prefixes)||
      !['ACTIVE','SUSPENDED','REVOKED'].includes(issuer.status))fail('ISSUER_METADATA_INVALID');
 }
 for(const policy of plane.issuance_policies){
   const d=plane.services.find(s=>s.service_id===policy?.audience_service_id);
   if(!record(policy)||!d||d.capability_control!=='REQUIRED'||!unique(policy.capabilities)||
      !subset(policy.capabilities,d.capability_ceiling)||
      !['package_workspaces','mapped_workspace_only'].includes(policy.workspace_scope))fail('POLICY_METADATA_INVALID');
 }
 return {status:'METADATA_AUDITED_NOT_AUTHORIZED',serviceCount:names.length,
 guardedServiceCount:plane.services.filter(s=>s.capability_control==='REQUIRED').length,
 externalProvisioningRequired:plane.services.some(s=>s.operation_guards.some(g=>g.operation_id==='t1.createWorkspace')),
 signedGrantVerified:false,activeReceiptVerified:false,productionActivation:false};
}
