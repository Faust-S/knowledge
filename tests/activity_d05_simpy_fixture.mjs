import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildD05RouteQualityComparisonExample,reviewD05ResultSelection,prepareD05DisclosureCandidate}
 from '../modules/activity-base-anonymizer/d05-route-comparison.mjs';
export function buildSimPyRequest(){
 const r=reviewD05ResultSelection(buildD05RouteQualityComparisonExample(),{includeTechnologyDraft:true});
 const g=r.groups[0],p=r.technology_draft.groups[0].profiles[0];
 const form={purpose:'Изготовление деталей по чертежу',inputs:'Листовой материал',outputs:'Деталь',
  applicability:'Материал и размеры в пределах чертежа',adaptation_guidance:'Уточнить условия получателя',
  local_context_guidance:'Проверить доступность материала',
  operations:Object.fromEntries(g.operations.map(o=>[o.id,{label:o.name,role:'Специалист',
   equipment:'Оборудование необходимого класса',material:'Материал по спецификации'}])),
  quality_roles:Object.fromEntries(p.checks.map(c=>[c.id,'Контролёр']))};
 const decisions=Object.fromEntries(p.conditions.filter(c=>c.use==='ADAPTATION_REVIEW'&&c.value!==null)
  .map(c=>[c.key,{mode:'RETAIN_DECLARATION'}]));
 const candidate=prepareD05DisclosureCandidate(r,g.id,1,form,decisions);
 const settings={'Раскрой':{resource:'laser',rate:100},'Гибка':{resource:'bend',rate:80},'Контроль размеров':{resource:'qc',rate:50}};
 const get=(o,k)=>o.parameters.find(p=>p.field===k).value;
 const resources=Object.values(settings).map(x=>({key:x.resource,capacity:1,rate_minor_per_minute:x.rate}));
 const operations=candidate.technology.operations.map(o=>({operation_id:o.operation_id,duration:get(o,'duration'),
  unit:get(o,'unit'),setup_hours:get(o,'setup'),buffer_hours:get(o,'buffer'),resource_key:settings[o.label].resource}));
 const baseline={hours_per_day:'8',resources,operations,other_cost_minor_per_order:300};
 const recipient=structuredClone(baseline);recipient.resources.find(r=>r.key==='laser').capacity=2;
 return {profile:'ACTIVITY_D05_SIMPY_COMPARISON_V1',candidate,arrival_minutes:[0,0],deadline_after_minutes:480,
  buffer_policy:'RELEASE_RESOURCE_DURING_BUFFER',currency:'RUB',baseline,recipient};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const root=process.argv[2];mkdirSync(root,{recursive:true});
 writeFileSync(join(root,'request.json'),JSON.stringify(buildSimPyRequest())+'\n','utf8');
}
