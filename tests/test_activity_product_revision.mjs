import test from 'node:test';
import assert from 'node:assert/strict';
import {preparePersonalTechnologyProduct,prepareD05TechnologyProduct} from '../modules/activity-base-anonymizer/technology-product.mjs';
import {editableProductTexts,reviseTechnologyProductText} from '../modules/activity-base-anonymizer/technology-product-revision.mjs';
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
