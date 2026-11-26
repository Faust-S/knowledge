// Local functional generalization of exact original Presidio findings.
// No recognition engine, publication permission or new product format.
import {ActivityHold,sha256Canonical} from './engine.mjs';
import {reviewProductPresidioTextScreening} from './presidio-text-review.mjs';
import {editableProductTexts,reviseTechnologyProductText} from './technology-product-revision.mjs';
import {validateTechnologyProduct,TECHNOLOGY_SCHEMA,TECHNOLOGY_VERSION} from './technology-product.mjs';
const need=(ok,code)=>{if(!ok)throw new ActivityHold(code);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const word=c=>!!c&&/[\p{L}\p{M}\p{N}_]/u.test(c);
const email=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const phone=/^\+[0-9 ()-]{10,24}$/;
const direct=(value,types,score)=>{
 if(score>=0.8&&types.includes('EMAIL_ADDRESS')&&email.test(value))return 'EMAIL';
 if(score>=0.85&&types.includes('PHONE_NUMBER')&&phone.test(value)&&value.replace(/\D/g,'').length>=10&&value.replace(/\D/g,'').length<=15)return 'PHONE';
 return null;
};
const wording={
 ru:{EMAIL:'контактный адрес электронной почты',PHONE:'контактный телефон'},
 en:{EMAIL:'the designated contact email address',PHONE:'the designated contact phone number'},
};
function boundary(points,start,end,value,kind){
 if(word(points[start-1])&&word(points[start]))return false;
 if(word(points[end-1])&&word(points[end]))return false;
 if(kind==='EMAIL'&&(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]/.test(points[start-1]??'')||
    /[A-Za-z0-9_@-]/.test(points[end]??'')||points[end]==='.'&&word(points[end+1])))return false;
 return true;
}
function occurrences(row,value,kind){
 const out=[],offsets=row.offsets;
 let at=0;
 for(;;){
  const pos=row.text.indexOf(value,at);if(pos<0)break;
  const start=offsets.get(pos),end=offsets.get(pos+value.length);
  if(start!==undefined&&end!==undefined&&boundary(row.points,start,end,value,kind))out.push({start,end});
  at=pos+Math.max(1,value.length);
 }
 return out;
}
// Known multiword personal/organization names can have different casing,
// horizontal spacing and quote styles. These are candidate aliases only.
// Do not fold contacts, internal identifiers, numeric values or inflection.
function nameVariantPattern(ref){
 if(!['CUSTOMER','PERFORMER','CONTRACTOR'].includes(ref.kind)||!/^[\p{L}\p{M} \u00a0\u202f«»„“”"'-]+$/u.test(ref.value)||
  (ref.value.match(/[\p{L}\p{M}]+/gu)??[]).length<2)return null;
 const escape=v=>v.replace(/[.*+?^$(){}[\]\\]/g,ch=>'\\'+ch);
 return new RegExp(ref.value.split(/([ \u00a0\u202f]+|[«»„“”"])/u).map(part=>
  /^[ \u00a0\u202f]+$/u.test(part)?'[ \\u00a0\\u202f]+':/^[«»„“”"]$/u.test(part)?'[«»„“”"]':escape(part)).join(''),'giu');
}
function variantOccurrences(row,ref,pattern){
 const matches=[];
 pattern.lastIndex=0;
 for(const m of row.text.matchAll(pattern)){
  const value=m[0];if(value===ref.value)continue;
  const start=row.offsets.get(m.index),end=row.offsets.get(m.index+value.length);
  if(start!==undefined&&end!==undefined&&boundary(row.points,start,end,value,null))matches.push({value,start,end});
 }
 return matches;
}
const spanKey=x=>x.path+':'+x.start+':'+x.end;
const digit=s=>/\d/.test(s);
const overlaps=(a,b)=>a.path===b.path&&a.start<b.end&&b.start<a.end;
const referenceKinds=new Set(['CUSTOMER','PERFORMER','CONTRACTOR','LOCAL_REFERENCE','FUNCTIONAL_MAPPING']);
function normalizedReferences(references){
 need(Array.isArray(references)&&references.length<=512,'TECHNOLOGY_GENERALIZATION_REFERENCES');
 const found=new Map();
 for(const row of references){
  need(exact(row,['value','replacement','kind'])&&referenceKinds.has(row.kind)&&typeof row.value==='string'&&
   row.value===row.value.trim()&&row.value.length>=3&&row.value.length<=240&&typeof row.replacement==='string'&&
   row.replacement===row.replacement.trim()&&row.replacement.length>=1&&row.replacement.length<=512&&
   !row.replacement.includes(row.value)&&!/[\u0000-\u001f\u007f]/.test(row.value+row.replacement),
   'TECHNOLOGY_GENERALIZATION_REFERENCE_INVALID');
  const key=JSON.stringify([row.value,row.replacement,row.kind]);
  found.set(key,{value:row.value,replacement:row.replacement,kind:row.kind});
 }
 return [...found.values()].sort((a,b)=>cmp(a.value,b.value)||cmp(a.replacement,b.replacement)||cmp(a.kind,b.kind));
}
export async function prepareProductGeneralization(preview,reports,language='ru',references=[]){
 const known=normalizedReferences(references);
 need(['ru','en'].includes(language)&&Array.isArray(reports)&&reports.length<=2&&(reports.length>0||known.length>0),
  'TECHNOLOGY_GENERALIZATION_REPORTS');
 need(preview?.status==='LOCAL_TECHNOLOGY_PRODUCT_PREVIEW'&&preview.schema_id===TECHNOLOGY_SCHEMA&&
  preview.schema_version===TECHNOLOGY_VERSION&&preview.disclosure_status==='REQUIRES_OWNER_REVIEW'&&
  preview.anonymity==='NOT_ESTABLISHED'&&preview.export_allowed===false&&preview.iwxa_package===null,
  'TECHNOLOGY_GENERALIZATION_PRODUCT');
 need(await sha256Canonical(validateTechnologyProduct(preview.object_data))===preview.product_sha256,
  'TECHNOLOGY_GENERALIZATION_PRODUCT_CHANGED');
 // Revalidate original complete reports at the point of use, not just a
 // previously rendered "reviewed" flag. Keep recognized source values local.
 const reviews=await Promise.all(reports.map(r=>reviewProductPresidioTextScreening(preview,r)));
 need(new Set(reviews.map(r=>r.language)).size===reviews.length,'TECHNOLOGY_GENERALIZATION_REPORTS');
 const report_sha256=(await Promise.all(reports.map(r=>sha256Canonical(r)))).sort(cmp);
 const inventory=editableProductTexts(preview.object_data).map(r=>{
  const points=Array.from(r.text),offsets=new Map();let offset=0;
  points.forEach((ch,i)=>{offsets.set(offset,i);offset+=ch.length;});offsets.set(offset,points.length);
  return {...r,points,offsets};
 });
 const fields=new Map(inventory.map(r=>[r.path,r])),groups=new Map();
 for(const review of reviews)for(const field of review.fields)for(const f of field.findings){
  const row=fields.get(field.path),value=row.points.slice(f.start,f.end).join('');
  let g=groups.get(value);
  if(!g){g={value,types:new Set(),languages:new Set(),score:0,spans:new Map(),references:[]};groups.set(value,g);}
  g.types.add(f.entity_type);g.languages.add(review.language);g.score=Math.max(g.score,f.score);
  const span={path:row.path,start:f.start,end:f.end,edit_kind:row.edit_kind,detected:true};
  g.spans.set(spanKey(span),span);
 }
 // A declared local reference is supplementary evidence, not a fabricated
 // recognizer finding. Search exact complete occurrences throughout the same
 // editable product inventory. No source identities are added to the product.
 for(const ref of known){
  let g=groups.get(ref.value);
  if(!g){g={value:ref.value,types:new Set(),languages:new Set(),score:0,spans:new Map(),references:[]};}
  const kind=email.test(ref.value)?'EMAIL':null;
  for(const row of inventory)for(const pos of occurrences(row,ref.value,kind)){
   const span={path:row.path,...pos,edit_kind:row.edit_kind,detected:false};
   if(!g.spans.has(spanKey(span)))g.spans.set(spanKey(span),span);
  }
  if(g.spans.size){g.references.push(ref);groups.set(ref.value,g);}
  const pattern=nameVariantPattern(ref);
  if(pattern){
   for(const row of inventory)for(const pos of variantOccurrences(row,ref,pattern)){
    let variant=groups.get(pos.value);
    if(!variant){variant={value:pos.value,types:new Set(),languages:new Set(),score:0,spans:new Map(),references:[]};groups.set(pos.value,variant);}
    if(!variant.references.some(r=>r.value===ref.value&&r.replacement===ref.replacement&&r.kind===ref.kind))variant.references.push(ref);
    variant.source_variant=true;
    const span={path:row.path,start:pos.start,end:pos.end,edit_kind:row.edit_kind,detected:false};
    if(!variant.spans.has(spanKey(span)))variant.spans.set(spanKey(span),span);
    need(groups.size<=512,'TECHNOLOGY_GENERALIZATION_GROUP_LIMIT');
   }
  }
 }
 need(groups.size<=512,'TECHNOLOGY_GENERALIZATION_GROUP_LIMIT');
 let spanCount=0;
 const result=[];
 for(const g of [...groups.values()].sort((a,b)=>cmp(a.value,b.value))){
  const types=[...g.types].sort(cmp),kind=direct(g.value,types,g.score);
  const boundaryKind=kind??(email.test(g.value)?'EMAIL':null);
  // Expand identical complete references throughout the product. Short or
  // purely numeric findings stay scoped to the actual analyzer spans.
  if(kind||Array.from(g.value).length>=3&&/\p{L}/u.test(g.value)){
   for(const row of inventory)for(const pos of occurrences(row,g.value,boundaryKind)){
    const span={path:row.path,...pos,edit_kind:row.edit_kind,detected:false};
    if(!g.spans.has(spanKey(span)))g.spans.set(spanKey(span),span);
   }
  }
  const spans=[...g.spans.values()].sort((a,b)=>cmp(a.path,b.path)||a.start-b.start||a.end-b.end);
  spanCount+=spans.length;need(spanCount<=32768,'TECHNOLOGY_GENERALIZATION_SPAN_LIMIT');
  // Technical numeric free text and fixed fields are not redacted by a
  // contact replacement. A domain revision is needed if those are private.
  const editable=spans.filter(s=>s.edit_kind!=='FIXED'&&!(s.edit_kind==='CONTROL_TEXT'&&digit(g.value)));
  const blocked=spans.length-editable.length;
  const complete=spans.every(s=>boundary(fields.get(s.path).points,s.start,s.end,g.value,boundaryKind));
  const referenceRoles=[...new Set(g.references.map(r=>r.replacement))];
  // A replacement may itself be another known identifying reference. Such
  // chains and conflicting roles are left to the owner, never applied by default.
  const referenceSuggestion=referenceRoles.length===1&&!known.some(r=>r.value!==g.value&&referenceRoles[0].includes(r.value))?
   referenceRoles[0]:null;
  const suggestion=blocked===0&&complete&&editable.length?
   (g.references.length?referenceSuggestion:kind?wording[language][kind]:null):null;
  result.push({group_id:'g_'+String(result.length+1).padStart(4,'0'),value:g.value,types,languages:[...g.languages].sort(cmp),
   score:g.score,spans,editable_count:editable.length,blocked_count:blocked,
   source_kinds:[...new Set(g.references.map(r=>r.kind))].sort(cmp),source_variant:g.source_variant===true,source_review_required:g.source_variant===true||g.references.some(r=>r.kind==='FUNCTIONAL_MAPPING'),
   mode:editable.length===0?'DOMAIN_REVIEW_REQUIRED':suggestion?(g.source_variant?'SOURCE_REFERENCE_VARIANT':g.references.some(r=>r.kind==='FUNCTIONAL_MAPPING')?'FUNCTIONAL_MAPPING_REVIEW':g.references.length?'SOURCE_REFERENCE_SUGGESTION':'DIRECT_CONTACT_SUGGESTION'):'CONTEXT_REQUIRED',
   suggested_replacement:suggestion});
 }
 // A single direct identifier may be detected by both profiles. Do not
 // choose a winner if distinct suggested identifiers overlap.
 const autoByPath=new Map();
 for(const g of result.filter(g=>g.suggested_replacement!==null))for(const span of g.spans){
  const items=autoByPath.get(span.path)??[];items.push({...span,group:g});autoByPath.set(span.path,items);
 }
 for(const items of autoByPath.values()){
  items.sort((a,b)=>a.start-b.start||b.end-a.end);
  let outer=null;
  for(const item of items){
   if(outer&&item.start<outer.end&&item.group!==outer.group){
    for(const g of [outer.group,item.group]){g.mode='CONTEXT_REQUIRED';g.suggested_replacement=null;}
   }
   if(!outer||item.end>outer.end)outer=item;
  }
 }
 const body={base_product_sha256:preview.product_sha256,report_sha256,language,source_reference_sha256:await sha256Canonical(known),groups:result};
 return {status:'LOCAL_PRODUCT_GENERALIZATION_PROPOSAL',...body,proposal_sha256:await sha256Canonical(body),
  finding_count:reviews.reduce((n,r)=>n+r.finding_count,0),group_count:result.length,
  source_reference_count:known.length,matched_reference_count:result.filter(g=>g.source_kinds.length>0).length,source_variant_count:result.filter(g=>g.source_variant).length,screening_profile_count:reviews.length,
  automatic_group_count:result.filter(g=>g.suggested_replacement!==null&&!g.source_review_required).length,
  requires_owner_review:true,anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}
export async function applyProductGeneralization(preview,reports,choices,references=[]){
 need(exact(choices,['base_product_sha256','proposal_sha256','language','replacements'])&&
  choices.base_product_sha256===preview?.product_sha256&&Array.isArray(choices.replacements)&&
  choices.replacements.length>=1&&choices.replacements.length<=512,'TECHNOLOGY_GENERALIZATION_SELECTION');
 const plan=await prepareProductGeneralization(preview,reports,choices.language,references);
 need(choices.proposal_sha256===plan.proposal_sha256,'TECHNOLOGY_GENERALIZATION_STALE');
 const groupMap=new Map(plan.groups.map(g=>[g.group_id,g])),seen=new Set(),byPath=new Map();
 let edited=0,blocked=0;
 for(const c of choices.replacements){
  const g=groupMap.get(c?.group_id);
  need(exact(c,['group_id','replacement'])&&g&&g.editable_count>0&&!seen.has(c.group_id)&&
   typeof c.replacement==='string'&&c.replacement===c.replacement.trim()&&c.replacement.length>=1&&
   c.replacement.length<=512&&!/[\u0000-\u001f\u007f]/.test(c.replacement)&&
   !c.replacement.includes(g.value),'TECHNOLOGY_GENERALIZATION_REPLACEMENT');
  seen.add(g.group_id);blocked+=g.blocked_count;
  for(const span of g.spans){
   if(span.edit_kind==='FIXED'||span.edit_kind==='CONTROL_TEXT'&&digit(g.value))continue;
   const edits=byPath.get(span.path)??[];
   need(!edits.some(s=>overlaps(s,span)),'TECHNOLOGY_GENERALIZATION_OVERLAP');
   edits.push({...span,replacement:c.replacement});byPath.set(span.path,edits);edited++;
  }
 }
 need(byPath.size>=1&&byPath.size<=256,'TECHNOLOGY_GENERALIZATION_EDIT_LIMIT');
 const inventory=new Map(editableProductTexts(preview.object_data).map(r=>[r.path,r.text]));
 const edits=[];
 for(const [path,spans] of byPath){
  const previous=inventory.get(path),points=Array.from(previous);
  // Use original code-point offsets, descending, so supplementary characters
  // and earlier replacements cannot shift another edit.
  for(const s of spans.sort((a,b)=>b.start-a.start))points.splice(s.start,s.end-s.start,s.replacement);
  const replacement=points.join('');
  edits.push({path,previous,replacement,reason:choices.language==='ru'?'Функциональное обобщение выбранных идентификаторов':'Functional generalization of selected identifying references'});
 }
 const revised=await reviseTechnologyProductText(preview,{base_product_sha256:preview.product_sha256,edits});
 return {...revised,summary:{selected_groups:seen.size,changed_occurrences:edited,changed_fields:edits.length,
  retained_fixed_occurrences:blocked,unselected_groups:plan.groups.length-seen.size,
  requires_new_screening:true,semantic_equivalence:'NOT_ESTABLISHED',export_allowed:false}};
}
