// Build held-out prompts from exact private domain forms and ORIGINAL
// assistant policy. This script accepts no expected output as prompt input.
// Static DOM preparation is not a browser/mobile/model quality PASS.
import assert from "node:assert/strict";
import {readFileSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {JSDOM} from "jsdom";
const [assistantArg,domainArg,outArg]=process.argv.slice(2);
assert.ok(assistantArg&&domainArg&&outArg,"T3_QUALITY_ARGUMENTS");
const assistant=resolve(assistantArg),domain=resolve(domainArg);
const load=(root,file)=>import(pathToFileURL(join(root,file)).href);
const {fieldCandidates,fieldLabel,formProposalTask,formOutputFields,fieldBatches}=await load(assistant,"field-policy.mjs");
const {validateSkillPack,skillPrompt}=await load(assistant,"skill-runtime.mjs");
const {suite}=await load(domain,"scripts/score-club-assistant.mjs");
const pack=validateSkillPack(JSON.parse(readFileSync(join(domain,"assets/club-assistant-skills.json"),"utf8")));
const tasks=new Map();
for(const [key,definition] of Object.entries(suite.forms)){
 const dom=new JSDOM(readFileSync(join(domain,definition.page),"utf8"));
 try{
   const form=Array.from(dom.window.document.forms).find(f=>f.hasAttribute(definition.marker));
   assert.ok(form,"T3_QUALITY_FORM_NOT_FOUND");
   const fields=fieldCandidates(form.elements,f=>f.isConnected&&!f.closest("[hidden],[aria-hidden=true]"));
   assert.deepEqual(fields.map(f=>f.name||"@data-club-coop-source"),definition.fields,"T3_QUALITY_FIELD_ORDER");
   const batches=fieldBatches(fields);
   assert.equal(batches.length,1,"T3_QUALITY_REQUIRES_BATCH_AWARE_SCORING");
   const rows=fields.map((input,i)=>({input,form,key:"field_"+(i+1),label:fieldLabel(input),oldValue:input.value,type:input.type||input.tagName.toLowerCase()}));
   const skill=pack.skills.find(s=>s.id===definition.skill);
   assert.ok(skill,"T3_QUALITY_SKILL_NOT_FOUND");
   const taskCases=suite.cases.filter(c=>c.form===key);
   for(const c of taskCases){
      // The only case-specific input is the held-out user's request.
      // The expected/omit/review data stays exclusively in the scorer.
      const prompt=skillPrompt(pack,skill,formProposalTask(rows,c.request),{mode:"form",maxChars:6000});
      assert.ok(prompt.includes(c.request)&&prompt.length<=6000);
      assert.ok(!tasks.has(c.id));
      const formFields=formOutputFields(rows);
      assert.ok(formFields.length>0&&formFields.length<=10);
      tasks.set(c.id,{id:c.id,prompt,formFields});
   }
 }finally{dom.window.close();}
}
assert.equal(tasks.size,suite.cases.length);
const cases=suite.cases.map(c=>tasks.get(c.id));
writeFileSync(resolve(outArg),JSON.stringify({schema:"iwxa.club.assistant-prompts/1",cases}),{mode:0o600});
console.log("T3_QUALITY_PROMPTS_PREPARED "+cases.length+" forms "+Object.keys(suite.forms).length);
