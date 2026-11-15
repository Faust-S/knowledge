// Build-time normal ORIGINAL T2 Host catalog extension. This is NOT a
// runtime registry, issuer, license, second IAM, Host, Kernel or Exchange.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {EXTERNAL_PROCESS_LINK_PASSPORT,EXTERNAL_PROCESS_LINK_SCHEMA}
  from './external-process-link.mjs';

const P=EXTERNAL_PROCESS_LINK_PASSPORT;
const FILE='_iwxa/services/'+P.service_id+'.json';
const HASH=/^[a-f0-9]{64}$/;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function need(ok,code){if(!ok)throw Object.assign(new Error(code),{code});}
const digest=x=>createHash('sha256').update(Buffer.from(x,'utf8')).digest('hex');

/** Return normal immutable T2 build inputs. The actual Host compiler and
 * original signed Kernel enforce the service passport. No registration is
 * performed by this function, and no renderer may call it. */
export function planOriginalT2ExternalProcessRegistration({
  domain,catalog,controlPlane,
}={}) {
  need(object(domain)&&object(domain.security)&&
    Array.isArray(domain.modules)&&
    domain.modules.every(row=>object(row)&&typeof row.service_id==='string'&&
      typeof row.base_path==='string')&&
    Array.isArray(domain.security.allowed_object_classes)&&
    domain.security.allowed_object_classes.every(x=>typeof x==='string'&&x.trim())&&
    object(catalog)&&Array.isArray(catalog.entries)&&
    Number.isSafeInteger(catalog.count)&&catalog.count===catalog.entries.length&&
    object(controlPlane)&&controlPlane.schema_version==='0.3.1'&&
    Array.isArray(controlPlane.services)&&
    controlPlane.services.every(row=>object(row)&&
      typeof row.service_id==='string'),
    'T3_EXT_ORIGINAL_T2_CATALOG_REQUIRED');

  const modules=new Set(domain.modules.map(x=>x.service_id));
  const services=new Set(controlPlane.services.map(x=>x.service_id));
  need(modules.size===domain.modules.length&&
    services.size===controlPlane.services.length,
    'T3_EXT_ORIGINAL_T2_CATALOG_DUPLICATE');

  const names=new Set(),files=new Set();
  for(const row of catalog.entries){
    need(object(row)&&typeof row.service_id==='string'&&row.service_id.trim()&&
      typeof row.file==='string'&&row.file.trim()&&HASH.test(row.sha256??''),
      'T3_EXT_ORIGINAL_T2_CATALOG_INVALID');
    need(!names.has(row.service_id)&&!files.has(row.file),
      'T3_EXT_ORIGINAL_T2_CATALOG_DUPLICATE');
    names.add(row.service_id);files.add(row.file);
  }
  // A normal original T2 service passport does not replace the signed D1
  // owner. It cannot create or delete a Workspace or export .iwxa.
  need(P.permissions.workspace.read===true&&
    P.permissions.workspace.list===false&&
    P.permissions.workspace.create===false&&
    P.permissions.workspace.soft_delete===false&&
    P.permissions.workspace.restore===false&&
    P.permissions.workspace.purge===false&&
    isDeepStrictEqual(P.permissions.objects.read,[EXTERNAL_PROCESS_LINK_SCHEMA])&&
    isDeepStrictEqual(P.permissions.objects.write,[EXTERNAL_PROCESS_LINK_SCHEMA])&&
    isDeepStrictEqual(P.permissions.objects.delete,[])&&
    P.permissions.events.read_scope==='service'&&
    P.permissions.packages.export===false&&
    P.permissions.packages.import===false&&
    isDeepStrictEqual(P.input_object_types,[])&&
    isDeepStrictEqual(P.output_object_types,[EXTERNAL_PROCESS_LINK_SCHEMA]),
    'T3_EXT_PASSPORT_SCOPE_INVALID');

  const passport_bytes=JSON.stringify(P);
  const passport_sha256=digest(passport_bytes);
  const catalogEntry={
    service_id:P.service_id,service_version:P.service_version,
    base_path:P.base_path,supported_levels:[...P.supported_levels],
    file:FILE,sha256:passport_sha256,
  };
  const existing=catalog.entries.find(x=>x.service_id===P.service_id);
  need(!files.has(FILE)||existing?.file===FILE,
    'T3_EXT_PASSPORT_COLLISION');
  need(!existing||isDeepStrictEqual(existing,catalogEntry),
    'T3_EXT_PASSPORT_COLLISION');
  const moduleEntry={service_id:P.service_id,base_path:P.base_path};
  const controlEntry={
    schema_version:'0.3.1',service_id:P.service_id,
    capability_control:'NONE',capability_ceiling:[],
    activation_any_of:[],operation_guards:[],
  };
  const oldModule=domain.modules.find(x=>x.service_id===P.service_id);
  const oldControl=controlPlane.services.find(x=>x.service_id===P.service_id);
  need(!domain.modules.some(row=>row.service_id!==P.service_id&&
    row.base_path===P.base_path)&&
    (!oldModule||isDeepStrictEqual(oldModule,moduleEntry))&&
    (!oldControl||isDeepStrictEqual(oldControl,controlEntry)),
    'T3_EXT_PASSPORT_COLLISION');

  const classes=domain.security.allowed_object_classes;
  const entries=existing?[...catalog.entries]:[...catalog.entries,catalogEntry];
  return Object.freeze({
    domain:{...domain,security:{...domain.security,
      allowed_object_classes:classes.includes(EXTERNAL_PROCESS_LINK_SCHEMA)?
        [...classes]:[...classes,EXTERNAL_PROCESS_LINK_SCHEMA]},
      modules:oldModule?[...domain.modules]:[...domain.modules,moduleEntry]},
    catalog:{...catalog,count:entries.length,entries},
    controlPlane:{...controlPlane,
      services:oldControl?[...controlPlane.services]:
        [...controlPlane.services,controlEntry]},
    passport_file:FILE,passport_bytes,passport_sha256,
  });
}
