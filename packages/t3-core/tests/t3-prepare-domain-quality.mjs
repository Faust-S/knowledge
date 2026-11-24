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
const {fieldCandidates,fieldLabel,formProposalTask,formOutputFields,fieldBatches,splitFormProposals,parseFormProposals,proposalSelectedByDefault}=await load(assistant,"field-policy.mjs");
const {validateSkillPack,skillPrompt,formHintFor}=await load(assistant,"skill-runtime.mjs");
const {suite,scoreRun}=await load(domain,"scripts/score-club-assistant.mjs");
const pack=validateSkillPack(JSON.parse(readFileSync(join(domain,"assets/club-assistant-skills.json"),"utf8")));
const tasks=new Map(),merged=[];
const hybrid=process.argv.includes("--hybrid"),score=process.argv.includes("--score");
assert.ok(!score||hybrid,"T3_HYBRID_SCORE_MODE");
const comparison=score?JSON.parse(readFileSync(resolve(outArg),"utf8")):null;
if(score)assert.ok(comparison.schema==="iwxa.club.assistant-comparison/1"&&comparison.runs?.length===1&&comparison.runs[0].mode==="structured","T3_HYBRID_RESPONSE_SCHEMA");
const captured=new Map();
for(const r of comparison?.runs?.[0]?.responses??[]){
 assert.ok(!captured.has(r.id),"T3_HYBRID_DUPLICATE_RESPONSE");
 captured.set(r.id,r);
}
let protectedFields=0,modelOnlyFields=0,rejectedResponses=0,modelFailures=0,modelProposals=0;
let knownValues=0,deterministicOnly=0,requiredModel=0;

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
      const hint=formHintFor(pack,form,"/"+definition.page.replace(/index\.html$/,""));
      if(hybrid)assert.ok(hint&&hint.skillId===skill.id,"T3_HYBRID_HINT");
      const {known,remaining,controlled}=hybrid?splitFormProposals(rows,c.request,hint):{known:[],remaining:rows,controlled:0};
      const formFields=formOutputFields(remaining);
      protectedFields+=controlled;modelOnlyFields+=remaining.length;knownValues+=known.length;
      if(hybrid)assert.ok(remaining.every(row=>!hint.fields.some(rule=>rule.name.startsWith("@")?row.input.hasAttribute(rule.name.slice(1)):row.input.name===rule.name)),"T3_HYBRID_CONTROLLED_SCOPE");
      if(formFields.length){
       requiredModel++;
       const prompt=skillPrompt(pack,skill,formProposalTask(remaining,c.request),{mode:"form",maxChars:6000});
       assert.ok(prompt.includes(c.request)&&prompt.length<=6000);
       assert.ok(!tasks.has(c.id)&&formFields.length<=10);
       tasks.set(c.id,{id:c.id,prompt,formFields});
      }else{
       assert.ok(hybrid,"T3_QUALITY_NO_FIELDS");
       deterministicOnly++;
      }
      if(score){
       let accepted=[];
       if(formFields.length){
        const record=captured.get(c.id);
        assert.ok(record,"T3_HYBRID_RESPONSE_MISSING");
        captured.delete(c.id);
        if(record.code||typeof record.raw!=="string")modelFailures++;
        else try{accepted=parseFormProposals(record.raw,remaining);}
        catch{rejectedResponses++;}
        assert.ok(accepted.every(row=>!known.some(k=>k.key===row.key)),"T3_HYBRID_OVERRIDE");
        assert.ok(accepted.every(row=>row.source==="model"&&!proposalSelectedByDefault(row)),"T3_HYBRID_MODEL_DRAFT_PRESELECTED");
        modelProposals+=accepted.length;
       }
       merged.push({id:c.id,raw:JSON.stringify({fields:Object.fromEntries([...known,...accepted].map(row=>[row.key,row.proposed]))})});
      }
   }
 }finally{dom.window.close();}
}
assert.equal(tasks.size+deterministicOnly,suite.cases.length);
if(score){
 assert.equal(captured.size,0,"T3_HYBRID_UNEXPECTED_RESPONSE");
 const {cases,...report}=scoreRun({schema:"iwxa.club.assistant-responses/1",modelId:comparison.modelId,responses:merged});
 console.log("T3_CLUB_HYBRID_QUALITY "+JSON.stringify({...report,modelCases:requiredModel,deterministicOnly,protectedFields,modelOnlyFields,knownValues,modelProposals,rejectedResponses,modelFailures,wrongFields:cases.reduce((n,c)=>n+c.wrong.length,0),missingFields:cases.reduce((n,c)=>n+c.missing.length,0),modelQualityAccepted:false}));
 for(const c of cases.filter(c=>c.wrong.length||c.unexpected.length||c.missing.length)){
  // Frozen synthetic fixture identifiers and field names only. Never log values.
  console.log("T3_CLUB_HYBRID_CASE "+JSON.stringify({id:c.id,wrong:c.wrong,unexpected:c.unexpected,missing:c.missing}));
 }
 // These are the actual proposals admitted to the preview, not automatic
 // writes or a semantic acceptance decision about the remaining text.
 assert.equal(cases.reduce((n,c)=>n+c.wrong.length,0),0,"T3_HYBRID_PRECISE_WRONG");
 assert.equal(report.unexpectedFields,0,"T3_HYBRID_UNEXPECTED_FIELD");
}else{
 const cases=suite.cases.map(c=>tasks.get(c.id)).filter(Boolean);
 assert.ok(cases.length>0);
 writeFileSync(resolve(outArg),JSON.stringify({schema:"iwxa.club.assistant-prompts/1",cases}),{mode:0o600});
 if(hybrid)console.log("T3_HYBRID_PROMPTS_PREPARED "+JSON.stringify({cases:suite.cases.length,modelCases:cases.length,deterministicOnly,protectedFields,modelOnlyFields,knownValues}));
 else console.log("T3_QUALITY_PROMPTS_PREPARED "+cases.length+" forms "+Object.keys(suite.forms).length);
}
