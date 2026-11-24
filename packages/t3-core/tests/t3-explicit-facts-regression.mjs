// Regression over exact domain forms and the existing evaluation suite.
// Expected values enter ONLY scoreRun, never extraction. No model inference.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import {JSDOM} from "jsdom";
const [assistantArg,domainArg]=process.argv.slice(2);
const assistant=resolve(assistantArg),domain=resolve(domainArg);
const load=(root,file)=>import(pathToFileURL(join(root,file)).href);
const {fieldCandidates,fieldLabel,fieldBatches,splitFormProposals}=await load(assistant,"field-policy.mjs");
const {validateSkillPack,formHintFor}=await load(assistant,"skill-runtime.mjs");
const {suite:observed,scoreRun,scoreCase}=await load(domain,"scripts/score-club-assistant.mjs");
const challenge=process.argv.includes("--challenge"),expanded=process.argv.includes("--expanded");
assert.ok(!(challenge&&expanded));
const suiteName=challenge?"challenge":expanded?"expanded":"observed";
const suite=challenge||expanded?JSON.parse(readFileSync(join(domain,"scripts/fixtures/club-assistant-"+suiteName+".json"),"utf8")):observed;
if(challenge||expanded)assert.equal(suite.schema,"iwxa.club.assistant-"+suiteName+"/1");
if(challenge)assert.deepEqual(suite.forms,observed.forms);
const pack=validateSkillPack(JSON.parse(readFileSync(join(domain,"assets/club-assistant-skills.json"),"utf8")));
const responses=[];
for(const [key,definition] of Object.entries(suite.forms)){
 const dom=new JSDOM(readFileSync(join(domain,definition.page),"utf8"));
 try{
  const form=Array.from(dom.window.document.forms).find(f=>f.hasAttribute(definition.marker));
  assert.ok(form,"ACTUAL_FORM");
  const hint=formHintFor(pack,form,"/"+definition.page.replace(/index\.html$/,""));
  assert.ok(hint&&hint.skillId===definition.skill,"FORM_HINT_ROUTE");
  const fields=fieldCandidates(form.elements,f=>f.isConnected&&!f.closest("[hidden],[aria-hidden=true]"));
  const identity=input=>input.name||definition.fields.find(n=>n.startsWith("@")&&input.hasAttribute(n.slice(1)))||"UNNAMED";
  assert.deepEqual(fields.map(identity),definition.fields);
  const original=fields.map(f=>f.value);
  const matching=new Set(fields.filter(input=>hint.fields.some(h=>h.name===identity(input))));
  assert.equal(matching.size,hint.fields.length,"EXACT_HINT_FIELDS");
  // The real UI offers groups of no more than ten fields. Qualify the
  // same groups, then map local field keys back to the original order
  // solely for the scorer. No oversized model task is constructed.
  const groups=fieldBatches(fields);
  for(const c of suite.cases.filter(c=>c.form===key)){
   const merged={};
   for(const batch of groups){
    const rows=batch.map((input,i)=>({input,form,key:"field_"+(i+1),label:fieldLabel(input),oldValue:input.value,type:input.type}));
    const {known,remaining}=splitFormProposals(rows,c.request,hint);
    assert.ok(known.every(r=>matching.has(r.input))&&remaining.every(r=>!matching.has(r.input)));
    for(const row of known)merged["field_"+(fields.indexOf(row.input)+1)]=row.proposed;
   }
   assert.deepEqual(fields.map(f=>f.value),original,"NO_FORM_MUTATION");
   responses.push({id:c.id,raw:JSON.stringify({fields:merged})});
  }
 }finally{dom.window.close();}
}
const report=challenge||expanded?(()=>{
 const byId=new Map(responses.map(r=>[r.id,r.raw]));
 const cases=suite.cases.map(c=>scoreCase(c,byId.get(c.id),suite.forms));
 return {modelId:"deterministic-domain-hints",submitted:responses.length,expectedCases:cases.length,formatPass:cases.filter(c=>c.format).length,
  exactFields:cases.reduce((n,c)=>n+c.exact,0),expectedFields:cases.reduce((n,c)=>n+c.total,0),
  exactCasePass:cases.filter(c=>c.pass).length,unexpectedFields:cases.reduce((n,c)=>n+c.unexpected.length,0),
  requiresHumanReview:cases.filter(c=>c.review.length).length,modelQualityAccepted:false,cases};
})():scoreRun({schema:"iwxa.club.assistant-responses/1",modelId:"deterministic-domain-hints",responses});
const {cases,...summary}=report;
console.log("T3_CLUB_EXPLICIT_FACTS_REGRESSION "+JSON.stringify({...summary,suite:suiteName,wrongFields:cases.reduce((a,c)=>a+c.wrong.length,0),missingFields:cases.reduce((a,c)=>a+c.missing.length,0),modelExecuted:false}));
if(challenge||expanded){
 for(const c of cases.filter(c=>!c.pass))console.log("T3_CLUB_EXPLICIT_FACTS_CASE "+JSON.stringify({id:c.id,wrong:c.wrong,unexpected:c.unexpected,missing:c.missing}));
 if(!process.argv.includes("--enforce"))process.exit(0);
 assert.equal(cases.reduce((a,c)=>a+c.wrong.length,0),0,"CHALLENGE_NO_WRONG");
 assert.equal(report.unexpectedFields,0,"CHALLENGE_NO_UNEXPECTED");
 assert.ok(report.exactFields>=Math.ceil(report.expectedFields*.80),"CHALLENGE_MINIMUM_COVERAGE");
}
assert.equal(cases.reduce((a,c)=>a+c.wrong.length,0),0,"NO_WRONG_EXPLICIT_FACTS");
assert.equal(report.unexpectedFields,0,"NO_UNEXPECTED_EXPLICIT_FACTS");
assert.ok(report.exactFields>=40,"EXPLICIT_FACTS_MINIMUM_COVERAGE");
console.log("T3_CLUB_EXPLICIT_FACTS_PASS "+report.submitted+" cases "+Object.keys(suite.forms).length+" forms");
