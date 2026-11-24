// Extend the original Host build catalogue with one ordinary typed service.
// The original reviewer is kept separate and cannot export source reviews.
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {ActivityHold} from './engine.mjs';
import {TECHNOLOGY_SCHEMA} from './technology-product.mjs';
import {TECHNOLOGY_SERVICE,TECHNOLOGY_PASSPORT} from './technology-product-passport.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
export function planOriginalTechnologyRegistration({domain,catalog,controlPlane}={}){
 need(Array.isArray(domain?.modules)&&Array.isArray(domain?.security?.allowed_object_classes)&&
  Array.isArray(catalog?.entries)&&catalog.count===catalog.entries.length&&
  controlPlane?.schema_version==='0.3.1'&&Array.isArray(controlPlane.services),
  'TECHNOLOGY_ORIGINAL_CATALOG_REQUIRED');
 const file='_iwxa/services/'+TECHNOLOGY_SERVICE+'.json',passport_bytes=JSON.stringify(TECHNOLOGY_PASSPORT);
 const passport_sha256=createHash('sha256').update(passport_bytes).digest('hex');
 const entry={service_id:TECHNOLOGY_SERVICE,service_version:TECHNOLOGY_PASSPORT.service_version,
  base_path:TECHNOLOGY_PASSPORT.base_path,supported_levels:[...TECHNOLOGY_PASSPORT.supported_levels],file,sha256:passport_sha256};
 const module={service_id:TECHNOLOGY_SERVICE,base_path:TECHNOLOGY_PASSPORT.base_path};
 const control={schema_version:'0.3.1',service_id:TECHNOLOGY_SERVICE,capability_control:'NONE',
  capability_ceiling:[],activation_any_of:[],operation_guards:[]};
 function append(rows,row){
  need(rows.every(r=>r&&typeof r.service_id==='string')&&new Set(rows.map(r=>r.service_id)).size===rows.length,'TECHNOLOGY_ORIGINAL_CATALOG_DUPLICATE');
  const old=rows.find(r=>r.service_id===row.service_id);
  need(!old||isDeepStrictEqual(old,row),'TECHNOLOGY_ORIGINAL_CATALOG_COLLISION');
  return old?[...rows]:[...rows,row];
 }
 need(!catalog.entries.some(r=>r.file===file&&r.service_id!==TECHNOLOGY_SERVICE)&&
  !domain.modules.some(r=>r.base_path===module.base_path&&r.service_id!==TECHNOLOGY_SERVICE),
  'TECHNOLOGY_ORIGINAL_CATALOG_COLLISION');
 const entries=append(catalog.entries,entry);
 return {domain:{...domain,modules:append(domain.modules,module),security:{...domain.security,
    allowed_object_classes:[...new Set([...domain.security.allowed_object_classes,TECHNOLOGY_SCHEMA])]}},
  catalog:{...catalog,entries,count:entries.length},
  controlPlane:{...controlPlane,services:append(controlPlane.services,control)},
  passport_file:file,passport_bytes,passport_sha256};
}
