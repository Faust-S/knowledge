import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePersonalTechnologyProduct,prepareD05TechnologyProduct} from '../modules/activity-base-anonymizer/technology-product.mjs';
import {editableProductTexts,reviseTechnologyProductText,reviewTechnologyTextChange,reviewTechnologyTransferContent} from '../modules/activity-base-anonymizer/technology-product-revision.mjs';
import {suggestD05ParameterDecisions} from '../modules/activity-base-anonymizer/d05-adaptation-suggestions.mjs';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
import {personalRows,personalProposal,d05Candidate} from './activity_technology_product_fixture.mjs';
const revision=(p,row,replacement)=>({base_product_sha256:p.product_sha256,edits:[{path:row.path,previous:row.text,replacement,reason:'Remove identifying reference'}]});
test('personal disclosure corrections are new revisions and never approve publication',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),title:'Weekly review by private@example.com'});
 const row=editableProductTexts(p.object_data).find(r=>r.path==='object_data.title');
 const result=await reviseTechnologyProductText(p,revision(p,row,'Weekly review'));
 assert.notEqual(result.preview.product_sha256,p.product_sha256);
 assert.equal(result.preview.object_data.title,'Weekly review');
 assert.match(p.object_data.title,/private@example.com/);
 assert.equal(result.preview.export_allowed,false);
 assert.equal(result.local_review.requires_new_screening,true);
 assert.equal(result.local_review.semantic_equivalence,'NOT_ESTABLISHED');
 await assert.rejects(()=>reviseTechnologyProductText(result.preview,revision(p,row,'Other review')),{code:'TECHNOLOGY_REVISION_SELECTION'});
});
test('D05 privacy editing preserves numeric limits, enums, graph and blocking',async()=>{
 const c=d05Candidate();
 c.technology.quality_checks[0].title='Control for Private Plant: width 100 mm';
 const p=await prepareD05TechnologyProduct(c,'Part');
 const fields=editableProductTexts(p.object_data),row=fields.find(r=>r.path.endsWith('quality_checks.0.title'));
 assert.equal(row.edit_kind,'CONTROL_TEXT');
 const result=await reviseTechnologyProductText(p,revision(p,row,'Width 100 mm'));
 const old=p.object_data.technology,newT=result.preview.object_data.technology;
 assert.deepEqual(newT.operations,old.operations);
 assert.deepEqual(newT.quality_checks[0].declared_fields,old.quality_checks[0].declared_fields);
 await assert.rejects(()=>reviseTechnologyProductText(p,revision(p,row,'Width 110 mm')),{code:'TECHNOLOGY_REVISION_CONTROL_NUMBERS_CHANGED'});
 const fixed=fields.find(r=>r.path.includes('declared_fields')&&r.text==='99.8');
 assert.equal(fixed.edit_kind,'FIXED');
 await assert.rejects(()=>reviseTechnologyProductText(p,revision(p,fixed,'90')),{code:'TECHNOLOGY_REVISION_FIELD_FIXED_OR_STALE'});
});
test('D05 suggestions populate all existing decisions, preserve a selected profile and never invent numeric values',async()=>{
 const r=reviewD05ResultSelection(buildD05RouteQualityComparisonExample(),{includeTechnologyDraft:true});
 const g=r.groups[0],d=r.technology_draft.groups[0],p=d.profiles[0];
 const before=JSON.stringify(r),a=suggestD05ParameterDecisions(r,g.id,p.model_number);
 assert.equal(a.export_allowed,false);
 assert.equal(Object.keys(a.decisions).length,p.conditions.filter(c=>c.use==='ADAPTATION_REVIEW').length);
 for(const c of p.conditions.filter(c=>c.use==='ADAPTATION_REVIEW')){
  if(c.scope==='route')assert.equal(a.decisions[c.key].mode,'PARAMETERIZE');
  if(a.decisions[c.key].mode==='RETAIN_DECLARATION')assert.notEqual(c.value,null);
 }
 assert.equal(JSON.stringify(r),before);
 const form={purpose:'Make part',inputs:'Drawing',outputs:'Conforming part',applicability:'Selected design',
  adaptation_guidance:'Recipient planning',local_context_guidance:'Verify local drawing',
  operations:Object.fromEntries(g.operations.map(o=>[o.id,{label:o.name,role:'Qualified worker',equipment:'Suitable equipment',material:'Specified material'}])),
  quality_roles:Object.fromEntries(p.checks.map(c=>[c.id,'Inspector']))};
 const candidate=prepareD05DisclosureCandidate(r,g.id,p.model_number,form,a.decisions);
 assert.equal(candidate.parameter_summary.pending,0);
 assert.equal(candidate.technology.quality_checks[0].declared_fields.find(f=>f.field==='upper_limit').value,'100.2');
});

import {sha256Canonical} from '../modules/activity-base-anonymizer/engine.mjs';
import {productTextInventory} from '../modules/activity-base-anonymizer/presidio-text-review.mjs';
import {prepareProductGeneralization,applyProductGeneralization} from '../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
async function scan(p,language,find){
 const inventory=productTextInventory(p.object_data);
 const fields=inventory.map(r=>({path:r.path,text_length:Array.from(r.text).length,findings:find(r).map(f=>{
  const i=r.text.indexOf(f.value);assert.ok(i>=0);const start=Array.from(r.text.slice(0,i)).length;
  return {entity_type:f.type,start,end:start+Array.from(f.value).length,score:f.score??0.99};
 })}));
 return {status:'LOCAL_TEXT_SCREENING_COMPLETE',engine:'Presidio Analyzer',version:'2.2.366',language,
 model:language==='ru'?'ru_core_news_sm':'en_core_web_sm',model_version:'3.8.0',spacy_version:'3.8.11',
 score_threshold:0.3,supported_entities:['EMAIL_ADDRESS','PHONE_NUMBER','PERSON','DATE_TIME','LOCATION','URL'],phone_regions:['RU','US','GB','DE','FR'],
 input_sha256:'0'.repeat(64),product_sha256:p.product_sha256,text_inventory_sha256:await sha256Canonical(inventory),
 offset_unit:'UNICODE_CODE_POINT',fields,field_count:fields.length,finding_count:fields.reduce((n,f)=>n+f.findings.length,0),
 scope:'PRODUCT_IDENTIFYING_TEXT_SCREENING_ONLY',anonymity:'NOT_ESTABLISHED',export_allowed:false,iwxa_package:null};
}
const select=(plan,replacements)=>({base_product_sha256:plan.base_product_sha256,proposal_sha256:plan.proposal_sha256,language:plan.language,replacements});
test('generalization merges original bilingual findings and replaces repeated full contact references including missed fields',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),
  title:'📋 Weekly review quality@example.com',instructions:'Use quality@example.com. Keep review frequency 7 days.',
  context_requirements:['Send only to quality@example.com; alternate notquality@example.com.']});
 const find=r=>r.path==='object_data.title'?[{type:'EMAIL_ADDRESS',value:'quality@example.com'}]:[];
 const reports=[await scan(p,'en',find),await scan(p,'ru',find)];
 const plan=await prepareProductGeneralization(p,reports,'en');
 assert.equal(plan.group_count,1);assert.equal(plan.finding_count,2);assert.equal(plan.automatic_group_count,1);
 const g=plan.groups[0];assert.equal(g.spans.length,3);assert.equal(g.spans.filter(s=>s.detected).length,1);
 const out=await applyProductGeneralization(p,reports,select(plan,[{group_id:g.group_id,replacement:g.suggested_replacement}]));
 assert.equal(out.summary.changed_fields,3);assert.equal(out.summary.changed_occurrences,3);
 assert.match(out.preview.object_data.technology.instructions,/7 days/);
 assert.match(out.preview.object_data.technology.context_requirements[0],/notquality@example.com/);
 assert.equal(out.preview.export_allowed,false);assert.equal(out.local_review.semantic_equivalence,'NOT_ESTABLISHED');
 assert.notEqual(out.preview.product_sha256,p.product_sha256);
 assert.equal(p.object_data.title,'📋 Weekly review quality@example.com');
});
test('ambiguous names, dates and technical endpoints remain contextual proposals, not automatic replacements',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),instructions:'Call Ivan Ivanov on 2026-11-24. Use https://example.com.'});
 const raw=await scan(p,'en',r=>r.path.endsWith('.instructions')?[{type:'PERSON',value:'Ivan Ivanov'},{type:'DATE_TIME',value:'2026-11-24'},{type:'URL',value:'https://example.com'}]:[]);
 const plan=await prepareProductGeneralization(p,[raw],'en');assert.equal(plan.automatic_group_count,0);assert.equal(plan.group_count,3);
 const name=plan.groups.find(g=>g.types.includes('PERSON'));
 const revised=await applyProductGeneralization(p,[raw],select(plan,[{group_id:name.group_id,replacement:'the assigned reviewer'}]));
 assert.equal(revised.preview.object_data.technology.instructions,'Call the assigned reviewer on 2026-11-24. Use https://example.com.');
 assert.equal(revised.summary.unselected_groups,2);
});
test('fixed fields and numbers in control text are preserved and shown as unresolved',async()=>{
 const c=d05Candidate();c.technology.quality_checks[0].title='Call +1 (555) 123-4567 for width 100 mm';
 const p=await prepareD05TechnologyProduct(c,'Part');
 const raw=await scan(p,'en',r=>r.path.endsWith('quality_checks.0.title')?[{type:'PHONE_NUMBER',value:'+1 (555) 123-4567'}]:
  r.text==='99.8'?[{type:'DATE_TIME',value:'99.8'}]:[]);
 const plan=await prepareProductGeneralization(p,[raw],'en');
 assert.equal(plan.automatic_group_count,0);assert.ok(plan.groups.every(g=>g.editable_count===0&&g.blocked_count>0));
 await assert.rejects(()=>applyProductGeneralization(p,[raw],select(plan,[{group_id:plan.groups[0].group_id,replacement:'private'}])),{code:'TECHNOLOGY_GENERALIZATION_REPLACEMENT'});
 assert.equal(p.object_data.technology.quality_checks[0].declared_fields.find(f=>f.field==='lower_limit').value,'99.8');
});
test('overlapping selected references rejected; old report and old proposal cannot edit a new product',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),instructions:'Contact ivan@example.com'});
 const raw=await scan(p,'en',r=>r.path.endsWith('.instructions')?[{type:'EMAIL_ADDRESS',value:'ivan@example.com'},{type:'PERSON',value:'ivan'}]:[]);
 const plan=await prepareProductGeneralization(p,[raw],'en');
 const both=plan.groups.map(g=>({group_id:g.group_id,replacement:'the reviewer'}));
 await assert.rejects(()=>applyProductGeneralization(p,[raw],select(plan,both)),{code:'TECHNOLOGY_GENERALIZATION_OVERLAP'});
 const g=plan.groups.find(g=>g.types.includes('EMAIL_ADDRESS')),choice=select(plan,[{group_id:g.group_id,replacement:g.suggested_replacement}]);
 const out=await applyProductGeneralization(p,[raw],choice);
 await assert.rejects(()=>prepareProductGeneralization(out.preview,[raw]),{code:'PRESIDIO_RESULT_SOURCE_CHANGED'});
 await assert.rejects(()=>applyProductGeneralization(p,[raw],{...choice,proposal_sha256:'0'.repeat(64)}),{code:'TECHNOLOGY_GENERALIZATION_STALE'});
});
test('reports must cover the current product, and the same profile cannot count twice',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',personalProposal());
 const raw=await scan(p,'en',()=>[]);
 await assert.rejects(()=>prepareProductGeneralization(p,[raw,raw]),{code:'TECHNOLOGY_GENERALIZATION_REPORTS'});
 const changed=structuredClone(raw);changed.fields.pop();
 await assert.rejects(()=>prepareProductGeneralization(p,[changed]),{code:'PRESIDIO_RESULT_COVERAGE_INVALID'});
 const plan=await prepareProductGeneralization(p,[raw]);assert.equal(plan.groups.length,0);assert.equal(plan.anonymity,'NOT_ESTABLISHED');
});

test('known private aliases and roles supplement Presidio without copying source identity into the revised product',async()=>{
 const c=d05Candidate();
 c.technology.terms.local_context_guidance='Проверка у Иван Тестовый. Согласовать с ООО Частный цех. Лазер 2 мм.';
 c.technology.operations[0].role='Иван Тестовый';
 c.technology.quality_checks[0].title='Контроль ширины 100 мм у ООО Частный цех';
 const p=await prepareD05TechnologyProduct(c,'Правило Иван Тестовый');
 const refs=[{value:'Иван Тестовый',replacement:'оператор пресса',kind:'PERFORMER'},
  {value:'ООО Частный цех',replacement:'подрядчик получателя',kind:'CONTRACTOR'}];
 const plan=await prepareProductGeneralization(p,[],'ru',refs);
 assert.equal(plan.screening_profile_count,0);assert.equal(plan.finding_count,0);
 assert.equal(plan.matched_reference_count,2);assert.equal(plan.automatic_group_count,2);
 const changes=select(plan,plan.groups.map(g=>({group_id:g.group_id,replacement:g.suggested_replacement})));
 const out=await applyProductGeneralization(p,[],changes,refs);
 const t=out.preview.object_data.technology;
 assert.equal(t.operations[0].role,'оператор пресса');
 assert.match(t.terms.local_context_guidance,/Лазер 2 мм/);
 assert.match(t.quality_checks[0].title,/100 мм/);
 assert.deepEqual(t.quality_checks[0].declared_fields,p.object_data.technology.quality_checks[0].declared_fields);
 for(const ref of refs)assert.ok(!JSON.stringify(out.preview.object_data).includes(ref.value));
 assert.equal(out.preview.export_allowed,false);
 await assert.rejects(()=>applyProductGeneralization(p,[],changes,[refs[0]]),{code:'TECHNOLOGY_GENERALIZATION_STALE'});
 const conflict=await prepareProductGeneralization(p,[],'ru',[...refs,{...refs[0],replacement:'контролёр'}]);
 assert.equal(conflict.groups.find(g=>g.value===refs[0].value).suggested_replacement,null);
});

test('a declared contact matches the whole address, not a suffix of another address',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),
  instructions:'Send to quality@example.com, not alt+quality@example.com or quality@example.com-other.'});
 const refs=[{value:'quality@example.com',replacement:'the designated quality contact',kind:'LOCAL_REFERENCE'}];
 const plan=await prepareProductGeneralization(p,[],'en',refs);
 assert.equal(plan.groups[0].spans.length,1);
 const out=await applyProductGeneralization(p,[],select(plan,[{group_id:plan.groups[0].group_id,replacement:refs[0].replacement}]),refs);
 assert.equal(out.preview.object_data.technology.instructions,'Send to the designated quality contact, not alt+quality@example.com or quality@example.com-other.');
});

test('text revision reports altered practical conditions before a new local preview is adopted',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),
  instructions:'Перед проверкой не превышать 100 мм. Согласовать с Иваном Тестовым.'});
 const row=editableProductTexts(p.object_data).find(x=>x.path.endsWith('.instructions'));
 const safe=await reviseTechnologyProductText(p,revision(p,row,'Перед проверкой не превышать 100 мм. Согласовать с ответственным.'));
 assert.deepEqual(safe.local_review.edits[0].text_review.changed_markers,[]);
 const changed=await reviseTechnologyProductText(p,revision(p,row,'После проверки превышать 110 см. Согласовать с ответственным.'));
 const markers=changed.local_review.edits[0].text_review.changed_markers.map(x=>x.kind);
 for(const kind of ['NUMBERS','UNITS','CONDITIONS','OBLIGATIONS'])assert.ok(markers.includes(kind));
 assert.equal(changed.local_review.edits[0].text_review.semantic_equivalence,'NOT_ESTABLISHED');
 assert.equal(changed.preview.export_allowed,false);
 assert.deepEqual(reviewTechnologyTextChange('10 мм; 20','10; 20 мм').changed_markers.map(m=>m.kind),['UNITS']);
 assert.deepEqual(reviewTechnologyTextChange('Maximum 10 mm','Minimum 10 mm').changed_markers.map(m=>m.kind),['COMPARISONS']);
 assert.match(p.object_data.technology.instructions,/Иваном Тестовым/);
});

test('content review detects explicit gaps and supports correction using the existing local revision',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),
  purpose:'Weekly review',inputs:'Weekly review',instructions:'Выполнить задачу',outputs:'Не указано'});
 const before=reviewTechnologyTransferContent(p.object_data);
 assert.equal(before.issues.filter(i=>i.code==='IDENTICAL_DISTINCT_ROLES').length,2);
 assert.ok(before.issues.some(i=>i.path.endsWith('.instructions')&&i.code==='GENERIC_PROCEDURE'));
 assert.ok(before.issues.some(i=>i.path.endsWith('.outputs')&&i.code==='EXPLICIT_PLACEHOLDER'));
 const row=editableProductTexts(p.object_data).find(x=>x.path.endsWith('.instructions'));
 const changed=await reviseTechnologyProductText(p,revision(p,row,'Сопоставить запланированные и выполненные работы, указать отклонения и следующие действия.'));
 assert.ok(!reviewTechnologyTransferContent(changed.preview.object_data).issues.some(i=>i.path===row.path));
 assert.equal(before.semantic_usefulness,'REQUIRES_RECIPIENT_REVIEW');
 assert.equal(changed.preview.export_allowed,false);
 const c=d05Candidate();
 c.technology.operations[0].equipment_requirement='Не требуется';
 const parameter=c.technology.route_parameters.find(x=>x.mode==='PARAMETERIZE');
 assert.ok(parameter);parameter.guidance='Определяет получатель';
 const d=await prepareD05TechnologyProduct(c,'Part');
 const review=reviewTechnologyTransferContent(d.object_data);
 assert.equal(review.recipient.operation_count,d.object_data.technology.operations.length);
 assert.ok(review.issues.some(i=>i.code==='PARAMETER_WITHOUT_SELECTION_RULE'));
 assert.ok(!review.issues.some(i=>i.path.endsWith('equipment_requirement')));
});
