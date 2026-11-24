// Local revision of existing product content, never an export/approval.
// A disclosure finding can be corrected without replacing the technology or
// changing the original operation graph, controls, limits or enum semantics.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {validateTechnologyProduct,TECHNOLOGY_SCHEMA,TECHNOLOGY_VERSION} from './technology-product.mjs';
import {productTextInventory} from './presidio-text-review.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const own=(v,k)=>v!==null&&typeof v==='object'&&Object.hasOwn(v,k);
const qualityTextFields=new Set(['related_product_characteristic','requirement','inspection_method_custom','sampling_rule','required_evidence','action_custom']);
const numericTokens=s=>s.match(/[+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?/g)??[];
function lookup(root,path){
 const parts=path.split('.');
 need(parts.shift()==='object_data','TECHNOLOGY_REVISION_PATH');
 let parent=null,key=null,value=root;
 for(const p of parts){
  need(own(value,p),'TECHNOLOGY_REVISION_PATH');
  parent=value;key=p;value=value[p];
 }
 return {parent,key,value};
}
function classify(product,path){
 if(path==='object_data.title')return 'TEXT';
 if(product.target==='PERSONAL_AGENT_TASK_PROMPT'){
  if(/^object_data\.technology\.(purpose|inputs|outputs|applicability|instructions|cadence\.guidance|(?:result_requirements|context_requirements)\.\d+)$/.test(path))
   return 'TEXT';
  return 'FIXED';
 }
 if(/^object_data\.technology\.terms\.(purpose|inputs|outputs|applicability|adaptation_guidance|local_context_guidance)$/.test(path)||
  /^object_data\.technology\.operations\.\d+\.(label|role|equipment_requirement|material_requirement)$/.test(path)||
  /^object_data\.technology\.(?:route_parameters\.\d+|operations\.\d+\.parameters\.\d+)\.guidance$/.test(path))return 'TEXT';
 if(/^object_data\.technology\.quality_checks\.\d+\.(title|responsible_role)$/.test(path))return 'CONTROL_TEXT';
 const m=/^object_data\.technology\.quality_checks\.(\d+)\.declared_fields\.(\d+)\.value$/.exec(path);
 if(m){
  const field=product.technology.quality_checks[Number(m[1])]?.declared_fields[Number(m[2])];
  if(field?.status==='DECLARED'&&qualityTextFields.has(field.field))return 'CONTROL_TEXT';
 }
 return 'FIXED';
}
export function editableProductTexts(data){
 const p=validateTechnologyProduct(data);
 return productTextInventory(p).map(row=>({...row,edit_kind:classify(p,row.path)}));
}
export async function reviseTechnologyProductText(preview,changes){
 need(preview?.status==='LOCAL_TECHNOLOGY_PRODUCT_PREVIEW'&&preview.schema_id===TECHNOLOGY_SCHEMA&&
  preview.schema_version===TECHNOLOGY_VERSION&&preview.disclosure_status==='REQUIRES_OWNER_REVIEW'&&
  preview.anonymity==='NOT_ESTABLISHED'&&preview.export_allowed===false&&preview.iwxa_package===null,
  'TECHNOLOGY_REVISION_PROFILE');
 const p=validateTechnologyProduct(preview.object_data);
 need(await sha256Canonical(p)===preview.product_sha256,'TECHNOLOGY_REVISION_SOURCE_CHANGED');
 need(exact(changes,['base_product_sha256','edits'])&&changes.base_product_sha256===preview.product_sha256&&
  Array.isArray(changes.edits)&&changes.edits.length>=1&&changes.edits.length<=256,'TECHNOLOGY_REVISION_SELECTION');
 const inventory=new Map(editableProductTexts(p).map(row=>[row.path,row]));
 const seen=new Set(),revisions=[];
 for(const edit of changes.edits){
  need(exact(edit,['path','previous','replacement','reason'])&&typeof edit.path==='string'&&
   typeof edit.previous==='string'&&typeof edit.replacement==='string'&&edit.replacement.trim()===edit.replacement&&
   edit.replacement.length>0&&edit.replacement.length<=16000&&typeof edit.reason==='string'&&
   edit.reason.trim().length>0&&edit.reason.length<=1000&&!seen.has(edit.path),'TECHNOLOGY_REVISION_EDIT');
  const row=inventory.get(edit.path);
  need(row&&row.edit_kind!=='FIXED'&&row.text===edit.previous&&edit.replacement!==edit.previous,'TECHNOLOGY_REVISION_FIELD_FIXED_OR_STALE');
  // Free text acceptance conditions can themselves carry numeric limits.
  // Never change/drop these during redaction. A genuine engineering change
  // must go back through the domain owner, not this disclosure editor.
  if(row.edit_kind==='CONTROL_TEXT')need(JSON.stringify(numericTokens(edit.previous))===JSON.stringify(numericTokens(edit.replacement)),
   'TECHNOLOGY_REVISION_CONTROL_NUMBERS_CHANGED');
  const {parent,key,value}=lookup(p,edit.path);
  need(value===edit.previous,'TECHNOLOGY_REVISION_FIELD_FIXED_OR_STALE');
  parent[key]=edit.replacement;seen.add(edit.path);
  revisions.push({path:edit.path,edit_kind:row.edit_kind,previous:edit.previous,replacement:edit.replacement,reason:edit.reason});
 }
 const object_data=validateTechnologyProduct(p);
 const product_sha256=await sha256Canonical(object_data);
 return {preview:{status:'LOCAL_TECHNOLOGY_PRODUCT_PREVIEW',schema_id:TECHNOLOGY_SCHEMA,schema_version:TECHNOLOGY_VERSION,
  object_data,product_sha256,disclosure_status:'REQUIRES_OWNER_REVIEW',recipient_validation:'REQUIRES_ORIGINAL_CONSUMER',
  anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null},
  local_review:{base_product_sha256:preview.product_sha256,product_sha256,edits:revisions,
   requires_new_screening:true,requires_domain_review:true,semantic_equivalence:'NOT_ESTABLISHED',export_allowed:false}};
}
