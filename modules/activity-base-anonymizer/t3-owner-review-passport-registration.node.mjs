// Build-time extension point for the EXISTING original T2 Host service
// catalog. No new registry, Kernel, authority, Store or .iwxa format.
// The existing Host compiler writes the returned normal T2 JSON files.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {T3ActivityHold} from './t3-selected-host.mjs';
import {T3_ACTIVITY_OWNER_REVIEW_SCHEMA,
  T3_ACTIVITY_OWNER_REVIEW_PASSPORT} from './t3-owner-review-stage.mjs';

const good=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const need=(condition,code)=>{if(!condition)throw new T3ActivityHold(code);};
const sha=value=>createHash('sha256').update(Buffer.from(value,'utf8')).digest('hex');
const SERVICE_ID=T3_ACTIVITY_OWNER_REVIEW_PASSPORT.service_id;
const SERVICE_FILE='_iwxa/services/'+SERVICE_ID+'.json';

/** Returns NORMAL original T2 domain/catalog/passport build inputs.
 * Installation and signing are performed by the already-existing Host
 * build pipeline. This pure planner cannot issue rights or register itself.
 */
export function planOriginalT2ActivityReviewRegistration({domain,catalog,controlPlane}={}){
  need(good(domain)&&good(domain.security)&&
    Array.isArray(domain.modules)&&
    domain.modules.every(x=>good(x)&&typeof x.service_id==='string'&&
      typeof x.base_path==='string')&&
    good(controlPlane)&&Array.isArray(controlPlane.services)&&
    controlPlane.schema_version==='0.3.1'&&
    controlPlane.services.every(x=>good(x)&&typeof x.service_id==='string')&&
    Array.isArray(domain.security.allowed_object_classes)&&
    domain.security.allowed_object_classes.every(x=>typeof x==='string'&&x.trim())&&
    good(catalog)&&Array.isArray(catalog.entries)&&
    Number.isSafeInteger(catalog.count)&&catalog.count===catalog.entries.length,
    'T3_ACTIVITY_ORIGINAL_T2_CATALOG_REQUIRED');
  need(new Set(domain.modules.map(x=>x.service_id)).size===domain.modules.length&&
    new Set(controlPlane.services.map(x=>x.service_id)).size===controlPlane.services.length,
    'T3_ACTIVITY_ORIGINAL_T2_CATALOG_DUPLICATE');
  const names=new Set(),paths=new Set();
  for(const row of catalog.entries){
    need(good(row)&&typeof row.service_id==='string'&&row.service_id.trim()&&
      typeof row.file==='string'&&row.file.trim()&&
      /^[0-9a-f]{64}$/.test(row.sha256??''),
      'T3_ACTIVITY_ORIGINAL_T2_CATALOG_INVALID');
    need(!names.has(row.service_id)&&!paths.has(row.file),
      'T3_ACTIVITY_ORIGINAL_T2_CATALOG_DUPLICATE');
    names.add(row.service_id);paths.add(row.file);
  }
  const passport_bytes=JSON.stringify(T3_ACTIVITY_OWNER_REVIEW_PASSPORT);
  const passport_sha256=sha(passport_bytes);
  const registered={
    service_id:SERVICE_ID,
    service_version:T3_ACTIVITY_OWNER_REVIEW_PASSPORT.service_version,
    base_path:T3_ACTIVITY_OWNER_REVIEW_PASSPORT.base_path,
    supported_levels:[...T3_ACTIVITY_OWNER_REVIEW_PASSPORT.supported_levels],
    file:SERVICE_FILE,sha256:passport_sha256,
  };
  const existing=catalog.entries.find(x=>x.service_id===SERVICE_ID);
  need(!paths.has(SERVICE_FILE)||existing?.file===SERVICE_FILE,
    'T3_ACTIVITY_SERVICE_PASSPORT_COLLISION');
  if(existing){
    need(isDeepStrictEqual(existing,registered),
      'T3_ACTIVITY_SERVICE_PASSPORT_COLLISION');
  }
  const serviceModule={
    service_id:SERVICE_ID,base_path:T3_ACTIVITY_OWNER_REVIEW_PASSPORT.base_path,
  };
  const serviceControl={
    schema_version:'0.3.1',service_id:SERVICE_ID,
    capability_control:'NONE',capability_ceiling:[],
    activation_any_of:[],operation_guards:[],
  };
  const moduleExisting=domain.modules.find(x=>x.service_id===SERVICE_ID);
  const controlExisting=controlPlane.services.find(x=>x.service_id===SERVICE_ID);
  need(!domain.modules.some(x=>x.service_id!==SERVICE_ID&&
    x.base_path===serviceModule.base_path)&&
    (!moduleExisting||isDeepStrictEqual(moduleExisting,serviceModule))&&
    (!controlExisting||isDeepStrictEqual(controlExisting,serviceControl)),
    'T3_ACTIVITY_SERVICE_PASSPORT_COLLISION');
  const security={
    ...domain.security,
    allowed_object_classes:domain.security.allowed_object_classes.includes(
      T3_ACTIVITY_OWNER_REVIEW_SCHEMA)
      ? [...domain.security.allowed_object_classes]
      : [...domain.security.allowed_object_classes,T3_ACTIVITY_OWNER_REVIEW_SCHEMA],
  };
  const entries=existing?[...catalog.entries]:[...catalog.entries,registered];
  const result={
    domain:{...domain,security,
      modules:moduleExisting?[...domain.modules]:[...domain.modules,serviceModule]},
    catalog:{...catalog,count:entries.length,entries},
    controlPlane:{...controlPlane,services:controlExisting
      ? [...controlPlane.services] : [...controlPlane.services,serviceControl]},
    passport_file:SERVICE_FILE,
    passport_bytes,
    passport_sha256,
  };
  // Fail closed on an altered schema or accidental portable package grant.
  need(T3_ACTIVITY_OWNER_REVIEW_PASSPORT.permissions.packages.export===false&&
    T3_ACTIVITY_OWNER_REVIEW_PASSPORT.permissions.packages.import===false&&
    T3_ACTIVITY_OWNER_REVIEW_PASSPORT.permissions.objects.write.length===1&&
    T3_ACTIVITY_OWNER_REVIEW_PASSPORT.permissions.objects.write[0]===
      T3_ACTIVITY_OWNER_REVIEW_SCHEMA,
    'T3_ACTIVITY_NONEXPORTABLE_SERVICE_REQUIRED');
  return Object.freeze(result);
}
