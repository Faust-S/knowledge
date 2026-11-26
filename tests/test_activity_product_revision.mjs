import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePersonalTechnologyProduct,prepareD05TechnologyProduct,prepareD05RecipientInputs,validateTechnologyProduct} from '../modules/activity-base-anonymizer/technology-product.mjs';
import {editableProductTexts,reviseTechnologyProductText,reviewTechnologyTextChange,reviewTechnologyTransferContent} from '../modules/activity-base-anonymizer/technology-product-revision.mjs';
import {suggestD05ParameterDecisions} from '../modules/activity-base-anonymizer/d05-adaptation-suggestions.mjs';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate} from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
import {personalRows,personalProposal,d05Candidate,d05Binding} from './activity_technology_product_fixture.mjs';
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
import {prepareProductGeneralization,applyProductGeneralization,prepareContextualGeneralizationRequest,reviewContextualGeneralizationProposal,prepareContextualGeneralizationPlan,reviewContextualGeneralizationPlan,CONTEXTUAL_PROPOSAL} from '../modules/activity-base-anonymizer/technology-disclosure-generalization.mjs';
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

test('known names include complete case and quote variants but never preselect ambiguous aliases',async()=>{
 const c=d05Candidate();
 c.technology.terms.local_context_guidance='Согласовать с ООО «Частный цех» и ООО "ЧАСТНЫЙ ЦЕХ". ООО «ЧАСТНЫЙ ЦЕХ 2» оставить для предметного уточнения.';
 const p=await prepareD05TechnologyProduct(c,'Part');
 const refs=[{value:'ООО «Частный цех»',replacement:'подрядчик получателя',kind:'CONTRACTOR'}];
 const plan=await prepareProductGeneralization(p,[],'ru',refs);
 assert.equal(plan.groups.length,2);
 assert.equal(plan.source_variant_count,1);assert.equal(plan.automatic_group_count,1);
 const alias=plan.groups.find(g=>g.source_variant);
 assert.equal(alias.value,'ООО "ЧАСТНЫЙ ЦЕХ"');
 assert.equal(alias.mode,'SOURCE_REFERENCE_VARIANT');
 assert.equal(alias.suggested_replacement,refs[0].replacement);
 const changes=select(plan,plan.groups.map(g=>({group_id:g.group_id,replacement:'подрядчиком получателя'})));
 const out=await applyProductGeneralization(p,[],changes,refs);
 assert.equal(out.preview.object_data.technology.terms.local_context_guidance,
  'Согласовать с подрядчиком получателя и подрядчиком получателя. ООО «ЧАСТНЫЙ ЦЕХ 2» оставить для предметного уточнения.');
 assert.equal(out.preview.export_allowed,false);
});

test('source functional mappings remain explicit contextual suggestions and preserve conflicts for field review',async()=>{
 const c=d05Candidate();
 c.technology.terms.local_context_guidance='Использовать станок LT-02 при изготовлении.';
 const p=await prepareD05TechnologyProduct(c,'Part');
 const ref={value:'станок LT-02',replacement:'лазерный станок с ЧПУ',kind:'FUNCTIONAL_MAPPING'};
 const plan=await prepareProductGeneralization(p,[],'ru',[ref]);
 assert.equal(plan.groups.length,1);
 const g=plan.groups[0];
 assert.equal(g.mode,'FUNCTIONAL_MAPPING_REVIEW');assert.equal(g.source_review_required,true);
 assert.equal(plan.automatic_group_count,0);assert.equal(g.suggested_replacement,ref.replacement);
 const result=await applyProductGeneralization(p,[],select(plan,[{group_id:g.group_id,replacement:ref.replacement}]),[ref]);
 assert.equal(result.preview.object_data.technology.terms.local_context_guidance,'Использовать лазерный станок с ЧПУ при изготовлении.');
 assert.deepEqual(result.preview.object_data.technology.quality_checks,p.object_data.technology.quality_checks);
 assert.equal(result.preview.export_allowed,false);
 const conflict=await prepareProductGeneralization(p,[],'ru',[ref,{...ref,replacement:'другой класс оборудования'}]);
 assert.equal(conflict.groups[0].suggested_replacement,null);
 assert.equal(conflict.groups[0].reference_alternatives.length,2);
 const materialCandidate=d05Candidate();
 materialCandidate.technology.terms.local_context_guidance='Использовать материал Сталь 08пс 2 мм.';
 const material=await prepareD05TechnologyProduct(materialCandidate,'Part');
 const materialPlan=await prepareProductGeneralization(material,[],'ru',[{value:'Сталь 08пс 2 мм',replacement:'Материал по чертежу',kind:'FUNCTIONAL_MAPPING'}]);
 assert.equal(materialPlan.groups[0].suggested_replacement,null);
 assert.ok(materialPlan.groups[0].functional_marker_review[0].markers.some(m=>m.kind==='UNITS'));
});

test('native D05 duration is positive and a retained duration always keeps its original unit',async()=>{
 const records=buildD05RouteQualityComparisonExample();
 const source=records.find(r=>r.object.schema_id.endsWith('.operation-route')).object.data.value.data.inputs.operations[0];
 source.duration='0';source.unit='hours';
 const r=reviewD05ResultSelection(records,{includeTechnologyDraft:true}),g=r.groups[0],profile=r.technology_draft.groups[0].profiles[0];
 const op=g.operations.find(o=>o.name===source.name);
 const decisions=suggestD05ParameterDecisions(r,g.id,1).decisions;
 assert.equal(decisions[op.id+'.duration'].mode,'PARAMETERIZE');
 assert.equal(decisions[op.id+'.unit'].mode,'RETAIN_DECLARATION');
 const invalid=prepareD05DisclosureCandidate(r,g.id,1,{}, {...decisions,[op.id+'.duration']:{mode:'RETAIN_DECLARATION'}});
 assert.ok(invalid.pending_parameter_decisions.some(p=>p.key===op.id+'.duration'));
 const candidate=d05Candidate(),target=candidate.technology.operations[0];
 const duration=target.parameters.find(p=>p.field==='duration'),unit=target.parameters.find(p=>p.field==='unit');
 assert.equal(duration.mode,'RETAIN_DECLARATION');
 Object.assign(unit,{mode:'PARAMETERIZE',value:null,guidance:'Choose local unit'});
 await assert.rejects(()=>prepareD05TechnologyProduct(candidate,'Part'),{code:'TECHNOLOGY_D05_DURATION_REQUIRES_FIXED_UNIT'});
 const legacy=validateTechnologyProduct({title:'Part',target:'D05_OPERATION_ROUTE_QUALITY',technology:candidate.technology});
 assert.throws(()=>prepareD05RecipientInputs(legacy,d05Binding(legacy)),{code:'TECHNOLOGY_D05_DURATION_REQUIRES_FIXED_UNIT'});
 Object.assign(duration,{mode:'PARAMETERIZE',value:null,guidance:'Set positive duration with matching time unit'});
 const p=await prepareD05TechnologyProduct(candidate,'Part');
 const binding=d05Binding(p.object_data);
 binding.operations[target.operation_id].parameters.duration='0';
 assert.throws(()=>prepareD05RecipientInputs(p.object_data,binding),{code:'TECHNOLOGY_D05_RECIPIENT_PARAMETER_VALUE'});
 binding.operations[target.operation_id].parameters.duration='2';
 assert.equal(prepareD05RecipientInputs(p.object_data,binding).route_inputs.operations[0].duration,'2');
 assert.equal(prepareD05RecipientInputs(p.object_data,binding).quality_plan_inputs.checks[0].upper_limit,'100.2');
});

const contextualReply=(req,rows)=>({profile:CONTEXTUAL_PROPOSAL,request_sha256:req.request_sha256,
 fields:Object.fromEntries(req.document.fields.map(f=>[f.path,rows[f.path]??{decision:'RETAIN',value:null,reason:'Technical content retained'}]))});
test('contextual generalization rewrites complete recipient statements differently, preserves meaningful references and binds the selected fields',async()=>{
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),
  title:'Alpha weekly review',instructions:'Send the weekly review to Alpha before Monday. Do not send without approval.',
  result_requirements:['Verify the Alpha criterion and preserve the limit of 10 mm.']});
 const refs=[{value:'Alpha',replacement:'recipient function',kind:'LOCAL_REFERENCE'}];
 const paths=['object_data.technology.instructions','object_data.technology.result_requirements.0','object_data.title'];
 const request=await prepareContextualGeneralizationRequest(p,[],'en',refs,paths);
 assert.equal(request.field_count,3);assert.ok(request.editable_field_count>3);
 assert.equal(request.document.fields.find(f=>f.path===paths[0]).matches[0].value,'Alpha');
 const reordered=await prepareContextualGeneralizationRequest(p,[],'en',refs,[...paths].reverse());
 assert.equal(reordered.request_sha256,request.request_sha256);
 const proposal=contextualReply(request,{
  [paths[0]]:{decision:'REWRITE',value:'Send the weekly review to the designated reviewer before Monday. Do not send without approval.',reason:'Replace internal recipient by its role'},
  [paths[1]]:{decision:'RETAIN',value:null,reason:'Alpha may identify a required criterion; verify with owner'},
  [paths[2]]:{decision:'REWRITE',value:'Weekly review',reason:'Remove local program name'}});
 const before=JSON.stringify(p),out=await reviewContextualGeneralizationProposal(p,[],'en',refs,paths,proposal);
 assert.equal(out.changed_field_count,2);assert.equal(out.remaining_match_field_count,1);
 assert.equal(out.introduced_match_field_count,0);
 const copied=await reviewContextualGeneralizationProposal(p,[],'en',refs,paths,contextualReply(request,{
  [paths[0]]:{decision:'REWRITE',value:'Send the weekly review to the designated reviewer before Monday. Do not send without approval.',reason:'Replace local recipient'},
  [paths[2]]:{decision:'REWRITE',value:'Alpha private review',reason:'Keep known reference'}}));
 assert.equal(copied.fields.find(f=>f.path===paths[2]).remaining_matches[0].introduced,false);
 const addedPath='object_data.technology.outputs',addedRequest=await prepareContextualGeneralizationRequest(p,[],'en',refs,[addedPath]);
 const added=await reviewContextualGeneralizationProposal(p,[],'en',refs,[addedPath],contextualReply(addedRequest,{
  [addedPath]:{decision:'REWRITE',value:'Weekly report for Alpha',reason:'Model copied a local identity from context'}}));
 assert.equal(added.introduced_match_field_count,1);
 assert.equal(added.fields[0].remaining_matches[0].value,'Alpha');
 assert.deepEqual(out.revision.preview.object_data.technology.result_requirements,p.object_data.technology.result_requirements);
 assert.equal(out.revision.preview.object_data.title,'Weekly review');
 assert.equal(out.revision.preview.export_allowed,false);assert.equal(out.anonymity,'NOT_ESTABLISHED');
 assert.equal(JSON.stringify(p),before);
 await assert.rejects(()=>reviewContextualGeneralizationProposal(p,[],'en',refs,paths.slice(0,2),proposal),{code:'TECHNOLOGY_CONTEXTUAL_GENERALIZATION_REQUEST_CHANGED'});
 await assert.rejects(()=>prepareContextualGeneralizationRequest(p,[],'en',refs,['object_data.technology.cadence.mode']),{code:'TECHNOLOGY_CONTEXTUAL_GENERALIZATION_SELECTION'});
 await assert.rejects(()=>reviewContextualGeneralizationProposal(out.revision.preview,[],'en',refs,paths,proposal),{code:'TECHNOLOGY_CONTEXTUAL_GENERALIZATION_REQUEST_CHANGED'});
});
test('contextual D05 proposal cannot erase technical measurements or move a practical rule to another operation',async()=>{
 const c=d05Candidate(),id=c.technology.operations[0].operation_id,other=c.technology.operations[1].operation_id;
 c.technology.operations[0].equipment_requirement='Станок LT-02 для листа 2 мм';
 c.technology.terms.local_context_guidance='Операция '+id+': Проверить упор LT-02 перед запуском.';
 const p=await prepareD05TechnologyProduct(c,'Private part');
 const paths=['object_data.technology.terms.local_context_guidance','object_data.technology.operations.0.equipment_requirement','object_data.title'];
 const request=await prepareContextualGeneralizationRequest(p,[],'ru',[],paths);
 assert.equal(request.document.read_only_context.related_operations[0].operation_id,id);
 const out=await reviewContextualGeneralizationProposal(p,[],'ru',[],paths,contextualReply(request,{
  [paths[0]]:{decision:'REWRITE',value:'Операция '+other+': Проверить упор перед запуском.',reason:'Generalize'},
  [paths[1]]:{decision:'REWRITE',value:'Подходящий станок',reason:'Generalize'},
  [paths[2]]:{decision:'REWRITE',value:'Изготовление детали',reason:'Remove local name'}}));
 assert.equal(out.changed_field_count,1);assert.equal(out.blocked_field_count,2);
 assert.equal(out.fields.find(f=>f.path===paths[0]).block,'PRACTICAL_SCOPE_CHANGED');
 assert.equal(out.fields.find(f=>f.path===paths[1]).block,'TECHNICAL_MARKERS_CHANGED');
 assert.deepEqual(out.revision.preview.object_data.technology,p.object_data.technology);
 const safe=await reviewContextualGeneralizationProposal(p,[],'ru',[],paths,contextualReply(request,{
  [paths[0]]:{decision:'REWRITE',value:'Операция '+id+': Проверить упор оборудования перед запуском.',reason:'Retain action and condition'},
  [paths[1]]:{decision:'REWRITE',value:'Станок для обработки листа 2 мм',reason:'Preserve thickness and required function'}}));
 assert.equal(safe.changed_field_count,2);assert.equal(safe.blocked_field_count,0);
 const invented=await reviewContextualGeneralizationProposal(p,[],'ru',[],paths,contextualReply(request,{
  [paths[2]]:{decision:'REWRITE',value:'Изготовление детали 10 мм',reason:'Invented condition'}}));
 assert.equal(invented.changed_field_count,0);assert.equal(invented.fields.find(f=>f.path===paths[2]).block,'TECHNICAL_MARKERS_CHANGED');
 assert.deepEqual(safe.revision.preview.object_data.technology.quality_checks,p.object_data.technology.quality_checks);
});

test('whole personal technology is partitioned exactly once and model replies merge against a single original revision',async()=>{
 const proposal={...personalProposal(),title:'Alpha review',instructions:'Review the Alpha report.',result_requirements:Array.from({length:24},(_,i)=>'Check item '+(i+1)+' in Alpha.'),
  context_requirements:Array.from({length:12},(_,i)=>'Obtain source '+(i+1)+' from Alpha.')};
 const p=await preparePersonalTechnologyProduct(personalRows(),'routine_001',proposal);
 const refs=[{value:'Alpha',replacement:'recipient context',kind:'LOCAL_REFERENCE'}];
 const plan=await prepareContextualGeneralizationPlan(p,[],'en',refs);
 const editable=editableProductTexts(p.object_data).filter(r=>r.edit_kind!=='FIXED').map(r=>r.path).sort();
 assert.ok(plan.batches.length>=3);assert.equal(plan.unplanned.length,0);
 assert.deepEqual(plan.batches.flatMap(b=>b.paths).sort(),editable);
 assert.equal(new Set(plan.batches.flatMap(b=>b.paths)).size,editable.length);
 assert.ok(plan.batches.every(b=>b.paths.length<=16&&b.document_bytes<=42000));
 const replies=[];
 for(const batch of plan.batches){
  const request=await prepareContextualGeneralizationRequest(p,[],'en',refs,batch.paths);
  assert.equal(request.request_sha256,batch.request_sha256);
  replies.push(contextualReply(request,Object.fromEntries(request.document.fields.filter(f=>f.text.includes('Alpha'))
   .map(f=>[f.path,{decision:'REWRITE',value:f.text.replaceAll('Alpha','recipient context'),reason:'Replace local name'}]))));
 }
 const chosen=replies.flatMap(v=>Object.entries(v.fields).filter(([,v])=>v.decision==='REWRITE').map(([path])=>path));
 const first=await reviewContextualGeneralizationPlan(p,[],'en',refs,plan.plan_sha256,[replies[0]],[]);
 assert.equal(first.answered_field_count,plan.batches[0].paths.length);assert.equal(first.coverage_complete,false);assert.equal(first.revision,null);
 const result=await reviewContextualGeneralizationPlan(p,[],'en',refs,plan.plan_sha256,[...replies].reverse(),chosen);
 assert.equal(result.coverage_complete,true);assert.equal(result.answered_field_count,editable.length);
 assert.equal(result.revision.local_review.base_product_sha256,p.product_sha256);
 assert.equal(result.revision.local_review.edits.length,chosen.length);
 assert.ok(!JSON.stringify(result.revision.preview.object_data).includes('Alpha'));
 assert.equal(result.revision.preview.export_allowed,false);assert.equal(result.anonymity,'NOT_ESTABLISHED');
 assert.match(p.object_data.title,/Alpha/);
 await assert.rejects(()=>reviewContextualGeneralizationPlan(p,[],'en',refs,plan.plan_sha256,[replies[0],replies[0]],[]),{code:'TECHNOLOGY_CONTEXTUAL_PLAN_RESPONSE'});
 await assert.rejects(()=>reviewContextualGeneralizationPlan(p,[],'en',refs,plan.plan_sha256,[],chosen),{code:'TECHNOLOGY_CONTEXTUAL_PLAN_SELECTION'});
 await assert.rejects(()=>reviewContextualGeneralizationPlan(p,[],'en',[],plan.plan_sha256,replies,chosen),{code:'TECHNOLOGY_CONTEXTUAL_PLAN_CHANGED'});
 const altered=structuredClone(replies[0]);delete altered.fields[plan.batches[0].paths[0]];
 await assert.rejects(()=>reviewContextualGeneralizationPlan(p,[],'en',refs,plan.plan_sha256,[altered],[]),{code:'TECHNOLOGY_CONTEXTUAL_GENERALIZATION_REQUEST_CHANGED'});
});
test('whole D05 plan retains oversized fields as unresolved and merges compatible scoped changes only',async()=>{
 const c=d05Candidate();
 const op=c.technology.operations[0],check=c.technology.quality_checks[0],other=c.technology.operations[1];
 op.equipment_requirement='LT-02 для листа 2 мм';
 c.technology.terms.local_context_guidance='Операция '+op.operation_id+': Проверить упор LT-02 перед запуском.';
 const p=await prepareD05TechnologyProduct(c,'LT-02');
 const refs=[{value:'LT-02',replacement:'оборудование получателя',kind:'FUNCTIONAL_MAPPING'}];
 const plan=await prepareContextualGeneralizationPlan(p,[],'ru',refs);
 const paths=plan.batches.flatMap(b=>b.paths),all=editableProductTexts(p.object_data).filter(r=>r.edit_kind!=='FIXED');
 assert.equal(paths.length+plan.unplanned.length,all.length);assert.equal(new Set(paths).size,paths.length);
 assert.ok(plan.batches[0].priority_field_count>0);
 const scope='object_data.technology.terms.local_context_guidance',equipment='object_data.technology.operations.0.equipment_requirement';
 const replies=[];
 for(const batch of plan.batches){
  const request=await prepareContextualGeneralizationRequest(p,[],'ru',refs,batch.paths);
  replies.push(contextualReply(request,{
   [scope]:{decision:'REWRITE',value:'Операция '+other.operation_id+': Проверить упор оборудования перед запуском.',reason:'Wrong scope'},
   [equipment]:{decision:'REWRITE',value:'Оборудование для листа 2 мм',reason:'Preserve technical condition'},
   'object_data.title':{decision:'REWRITE',value:'Изготовление детали',reason:'Remove local name'}}));
 }
 const result=await reviewContextualGeneralizationPlan(p,[],'ru',refs,plan.plan_sha256,replies,[equipment,'object_data.title']);
 assert.equal(result.coverage_complete,true);assert.equal(result.blocked_field_count,1);
 assert.deepEqual(result.revision.preview.object_data.technology.quality_checks,p.object_data.technology.quality_checks);
 assert.equal(result.revision.preview.object_data.technology.terms.local_context_guidance,p.object_data.technology.terms.local_context_guidance);
 await assert.rejects(()=>reviewContextualGeneralizationPlan(p,[],'ru',refs,plan.plan_sha256,replies,[scope]),{code:'TECHNOLOGY_CONTEXTUAL_PLAN_SELECTION'});
 // A legal input can exceed the local model budget after required linked
 // context is included. Report that field, do not silently omit context.
 const large=await preparePersonalTechnologyProduct(personalRows(),'routine_001',{...personalProposal(),instructions:'я'.repeat(16000),
  purpose:'я'.repeat(4096),inputs:'я'.repeat(4096),outputs:'я'.repeat(4096),applicability:'я'.repeat(4096)});
 const oversized=await prepareContextualGeneralizationPlan(large,[],'ru',[]);
 assert.ok(oversized.unplanned.some(f=>f.path.endsWith('.instructions')&&f.document_bytes>42000));
 assert.equal(oversized.planned_field_count+oversized.unplanned.length,oversized.editable_field_count);
 const incomplete=await reviewContextualGeneralizationPlan(large,[],'ru',[],oversized.plan_sha256,[],[]);
 assert.equal(incomplete.coverage_complete,false);assert.ok(incomplete.unplanned_field_count>0);
 const swapped=d05Candidate(),a=swapped.technology.operations[0].operation_id,b=swapped.technology.operations[1].operation_id;
 swapped.technology.terms.local_context_guidance='Операция '+a+': Проверить зазор 2 мм.\nОперация '+b+': Проверить зазор 5 мм.';
 const source=await prepareD05TechnologyProduct(swapped,'Part');
 const scopedRequest=await prepareContextualGeneralizationRequest(source,[],'ru',[],[scope]);
 const exchanged=await reviewContextualGeneralizationProposal(source,[],'ru',[],[scope],contextualReply(scopedRequest,{
  [scope]:{decision:'REWRITE',value:'Операция '+b+': Проверить зазор 2 мм.\nОперация '+a+': Проверить зазор 5 мм.',reason:'Exchange scope without changing global marker order'}}));
 assert.equal(exchanged.fields[0].block,'PRACTICAL_SCOPE_CHANGED');
});
