/**
 * The T4 native ledgers are original T3 Objects in the owner's technical
 * Workspace. Register this schema in the existing T3 service passport and
 * domain config during assembly, not in another Store or schema registry.
 * The declaration supplies no per-principal or per-Workspace authority.
 */
export const T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID='iwxa.t4.network.record';
export const T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID='iwxa.demo.note';
const RECORD_KINDS=Object.freeze([
  'IWXA_T4_ORIGINAL_NETWORK_REPLAY_CHECKPOINT_V1',
  'IWXA_T4_ORIGINAL_NETWORK_SESSION_PHASES_V1',
  'IWXA_T4_ORIGINAL_NATIVE_PUBLICATION_V1',
  'IWXA_T4_ORIGINAL_HOST_NATIVE_ACK_FRONTIER_V1',
  'IWXA_T4_ORIGINAL_HOST_NATIVE_RECIPIENT_FRONTIER_V1',
  'IWXA_T4_ORIGINAL_NETWORK_CAPTURE_LEDGER_RECORD_V1',
]);
const fail=code=>{throw Object.assign(Error(code),{code});};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>Array.isArray(x)?x.map(canonical):
  object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function requireT4OriginalNetworkTechnicalSchemaId(value){
  if(![T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,T4_LEGACY_TEST_TECHNICAL_SCHEMA_ID].includes(value))
    fail('ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID_DENIED');
  return value;
}
export function createT4OriginalNetworkTechnicalSchemaDeclaration(){
  return {schema_version:'1.0.0',preserve_unknown:true,
    json_schema:{type:'object',required:['schema','title'],
      properties:{schema:{type:'string',enum:[...RECORD_KINDS]},title:{type:'string'}},
      additionalProperties:true},embedded:{}};
}
/** Pure assembly-time extension of the original passport. Preserve all
 * existing capabilities, object permissions and domain identity. Do not
 * grant deletion, Exchange, or new t1.* operations. The original installer
 * must recalculate the service-catalog digest as for any passport change.
 */
export function prepareT4OriginalNetworkTechnicalSchemaRegistration({domain,passport}={}){
  if(!object(domain)||!object(passport)||typeof passport.service_id!=='string'||
    !Array.isArray(domain.modules)||!domain.modules.some(m=>
      m.service_id===passport.service_id&&m.base_path===passport.base_path)||
    !Array.isArray(passport.supported_levels)||!passport.supported_levels.includes('T1')||
    !object(passport.schemas)||!object(passport.permissions?.objects)||
    ![domain.security?.allowed_object_classes,passport.input_object_types,
      passport.output_object_types,passport.permissions.objects.read,
      passport.permissions.objects.write].every(v=>Array.isArray(v)&&v.every(x=>typeof x==='string')))
    fail('ORIGINAL_NETWORK_TECHNICAL_SCHEMA_PASSPORT_REQUIRED');
  const id=T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID,decl=createT4OriginalNetworkTechnicalSchemaDeclaration();
  if(Object.hasOwn(passport.schemas,id)&&!same(passport.schemas[id],decl))
    fail('ORIGINAL_NETWORK_TECHNICAL_SCHEMA_DECLARATION_CONFLICT');
  const nextDomain=structuredClone(domain),nextPassport=structuredClone(passport);
  const append=a=>{if(!a.includes(id))a.push(id);};
  nextPassport.schemas[id]=decl;
  for(const list of [nextDomain.security.allowed_object_classes,
    nextPassport.input_object_types,nextPassport.output_object_types,
    nextPassport.permissions.objects.read,nextPassport.permissions.objects.write])append(list);
  return Object.freeze({domain:nextDomain,passport:nextPassport,schemaId:id,
    originalT3SchemaRegistration:true,originalOwnerAuthorityRequired:true,
    createsStore:false,createsIAM:false,createsScheduler:false});
}
export function assertT4OriginalNetworkTechnicalSchemaRegistered({domain,passport}={}){
  const next=prepareT4OriginalNetworkTechnicalSchemaRegistration({domain,passport});
  if(!same(next.domain,domain)||!same(next.passport,passport))
    fail('ORIGINAL_NETWORK_TECHNICAL_SCHEMA_NOT_REGISTERED');
  return T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID;
}
