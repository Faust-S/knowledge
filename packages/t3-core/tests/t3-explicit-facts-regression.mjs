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
const {fieldCandidates,fieldLabel,splitFormProposals}=await load(assistant,"field-policy.mjs");
const {validateSkillPack,formHintFor}=await load(assistant,"skill-runtime.mjs");
const {suite,scoreRun}=await load(domain,"scripts/score-club-assistant.mjs");
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
  assert.deepEqual(fields.map(f=>f.name||"@data-club-coop-source"),definition.fields);
  const rows=fields.map((input,i)=>({input,form,key:"field_"+(i+1),label:fieldLabel(input),oldValue:input.value,type:input.type}));
  const original=fields.map(f=>f.value);
  const matching=new Set(rows.filter(r=>hint.fields.some(h=>h.name===r.input.name||h.name.startsWith("@")&&r.input.hasAttribute(h.name.slice(1)))).map(r=>r.key));
  assert.equal(matching.size,hint.fields.length,"EXACT_HINT_FIELDS");
  for(const c of suite.cases.filter(c=>c.form===key)){
   const {known,remaining}=splitFormProposals(rows,c.request,hint);
   assert.ok(known.every(r=>matching.has(r.key))&&remaining.every(r=>!matching.has(r.key)));
   assert.deepEqual(fields.map(f=>f.value),original,"NO_FORM_MUTATION");
   responses.push({id:c.id,raw:JSON.stringify({fields:Object.fromEntries(known.map(r=>[r.key,r.proposed]))})});
  }
 }finally{dom.window.close();}
}
const report=scoreRun({schema:"iwxa.club.assistant-responses/1",modelId:"deterministic-domain-hints",responses});
const {cases,...summary}=report;
console.log("T3_CLUB_EXPLICIT_FACTS_REGRESSION "+JSON.stringify({...summary,wrongFields:cases.reduce((a,c)=>a+c.wrong.length,0),missingFields:cases.reduce((a,c)=>a+c.missing.length,0),modelExecuted:false}));
assert.equal(cases.reduce((a,c)=>a+c.wrong.length,0),0,"NO_WRONG_EXPLICIT_FACTS");
assert.equal(report.unexpectedFields,0,"NO_UNEXPECTED_EXPLICIT_FACTS");
assert.ok(report.exactFields>=40,"EXPLICIT_FACTS_MINIMUM_COVERAGE");
console.log("T3_CLUB_EXPLICIT_FACTS_PASS "+report.submitted+" cases "+Object.keys(suite.forms).length+" forms");
