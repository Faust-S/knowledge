// Explicit one-writer native product candidate, not a service capability
// grant. Register only the existing original T4 technical Object schema.
// The inherited T2 passport derives deleteObject from a nonempty delete
// list, and asset/relation methods from existing writable Object schemas.
import {isDeepStrictEqual} from 'node:util';
import {prepareT4OriginalNetworkTechnicalSchemaRegistration,T4_ORIGINAL_NETWORK_TECHNICAL_SCHEMA_ID as TECH} from './original-network-technical-schema.mjs';
const BUSINESS=Object.freeze(['iwxa.t3.company-work-record','iwxa.agent.accepted-result']);
const REGISTRY='iwxa.t3.access.signed-registry',APPLIED='iwxa.admin.applied-results';
const products=Object.freeze({SOURCE:'iwxa.personal-agent',RECIPIENT:'iwxa.admin-center'});
const fail=code=>{throw Object.assign(Error(code),{code});};
const check=(ok,code)=>{if(!ok)fail(code);};
const sameSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&new Set(a).size===a.length&&b.every(x=>a.includes(x));

export function prepareT4OriginalInstalledProductPassport({domain,passport,role}={}){
  const product=Object.hasOwn(products,role)?products[role]:null;
  check(product!==null&&domain?.domain_id===product&&domain.status==='development'&&
    passport?.service_id===product+'.workspace'&&passport.base_path==='/workspace/'&&
    Array.isArray(passport.supported_levels)&&passport.supported_levels.includes('T1')&&passport.supported_levels.includes('T2'),
    'T4_INSTALLED_PILOT_PRODUCT_REQUIRED');
  const p=passport.permissions,w=p?.workspace,o=p?.objects;
  check(w?.read===true&&w.soft_delete===false&&w.restore===false&&w.purge===false&&
    sameSet(p.operations,['t1.commitObjectGraph'])&&p.events?.read_scope==='workspace'&&
    p.packages?.export_scope==='readable_objects'&&p.packages?.import_scope==='writable_objects',
    'T4_INSTALLED_PILOT_ORIGINAL_PASSPORT_REQUIRED');
  const expected=[...BUSINESS,REGISTRY,...(role==='RECIPIENT'?[APPLIED]:[])];
  const registered=Object.hasOwn(passport.schemas??{},TECH);
  const exact=registered?[...expected,TECH]:expected;
  check(sameSet(Object.keys(passport.schemas??{}),exact)&&
    [passport.input_object_types,passport.output_object_types,o?.read,o?.write,domain.security?.allowed_object_classes].every(list=>sameSet(list,exact))&&
    expected.every(id=>passport.schemas[id]?.schema_version==='1.0.0')&&
    (sameSet(o?.delete,[])||registered&&sameSet(o?.delete,BUSINESS)),
    'T4_INSTALLED_PILOT_SCHEMA_CEILING_REQUIRED');
  const next=prepareT4OriginalNetworkTechnicalSchemaRegistration({domain,passport});
  // Actual original recipient deleteObject is required for replicated
  // business tombstones. SOURCE also captures explicitly permitted local
  // deletions. Neither management nor technical Objects become deletable.
  // Every such command is still subject to signed owner and Workspace scope.
  next.passport.permissions.objects.delete=[...BUSINESS];
  return Object.freeze({domain:next.domain,passport:next.passport,role,technicalSchemaId:TECH,
    originalOwnerAuthorityRequired:true,networkActivated:false,releaseAccepted:false});
}
export function assertT4OriginalInstalledProductPassport({domain,passport,role}={}){
  const next=prepareT4OriginalInstalledProductPassport({domain,passport,role});
  check(isDeepStrictEqual(next.domain,domain)&&isDeepStrictEqual(next.passport,passport),
    'T4_INSTALLED_PILOT_PASSPORT_NOT_REGISTERED');
  return role;
}
