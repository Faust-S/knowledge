/** Controlled K05 ablation over the existing K01 commercial-project fixture.
 * Measures real JS execution/read counts, not user time or LLM quality.
 * Neither source facts nor expected answers are independent human gold.
 */
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {verifyK01ProjectEvidence} from './k05_k01_evidence_check.mjs';

const SCHEMA='IWXA_K05_PROJECT_METHOD_ABLATION/0.1';
const K01_COMMIT='81de619f09f4393945ce5073fda5514729a67414';
const PINS={
 'modules/k01-context/integrations/project-continuation.mjs':'115f19c6172c745e6c67d96ce3cd1b3947e662b8',
 'modules/k01-context/tests/fixtures/commercial-project.mjs':'91ec94ed37173c480a9543616b0668fe0d135876'
};
const gitHash=b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const fail=code=>{throw Error('K05_ABLATION_'+code);};
function pinnedOwner(root){
 for(const [name,sha] of Object.entries(PINS)){
  const b=readFileSync(join(root,name));
  if(gitHash(b)!==sha)fail('K01_OWNER_SOURCE_CHANGED');
 }
}
const cases=[
 {id:'approved',options:{}},
 {id:'revised',options:{updated:true}},
 {id:'conflicting_approved_decisions',options:{addConflict:true}},
 {id:'unavailable_accepted_quote',options:{unavailable:['doc:quote-approved']}},
];
const priceFields=['cabinet','sensors','installation','commissioning','freight',
 'vat','net','gross','lead','validity'];
function expectedFor(fixture,spec){
 const map={...(spec.id==='revised'?fixture.expectedUpdated:fixture.expectedInitial)};
 if(spec.id==='conflicting_approved_decisions')map.advance=null;
 if(spec.id==='unavailable_accepted_quote')
  for(const key of priceFields)map[key]=null;
 return map;
}
function compareExpected(found,expected){
 const rows=[];
 for(const [key,wanted] of Object.entries(expected)){
  const actual=found.get(key);
  const state=wanted===null
   ? (actual===undefined?'DESIRED_ABSTENTION':'UNJUSTIFIED_ASSERTION')
   : actual===undefined?'MISSING':actual.includes(wanted)?'FIXTURE_MATCH':'FIXTURE_MISMATCH';
  rows.push({field:key,state});
 }
 const count=key=>rows.filter(r=>r.state===key).length;
 return {denominator:rows.length,fixtureMatches:count('FIXTURE_MATCH'),
  fixtureMismatches:count('FIXTURE_MISMATCH'),
  missing:count('MISSING'),desiredAbstentions:count('DESIRED_ABSTENTION'),
  unjustifiedAssertions:count('UNJUSTIFIED_ASSERTION'),
  independentHumanGold:false,precision:null,recall:null,f1:null,
  rows};
}
function lineFields(text,fields){
 const out=new Map();
 for(const [i,entry] of text.split(/\r?\n/).entries()){
  const sep=entry.indexOf(':');
  if(sep<1)continue;
  const key=entry.slice(0,sep).trim().toLocaleLowerCase('ru-RU');
  for(const field of fields)
   if(field.labels.some(label=>label.toLocaleLowerCase('ru-RU')===key)){
    const arr=out.get(field.key)||[];
    arr.push({value:entry.slice(sep+1).trim(),line:i+1});
    out.set(field.key,arr);
   }
 }
 return out;
}
async function runLiteralProxy(fixture,spec,which){
 const host=fixture.makeCommercialCase(spec.options);
 const start=performance.now();
 const catalog=await host.sourcePort.listSources(host.request);
 const docs=[...catalog.sources].sort((a,b)=>
  a.issuedAt.localeCompare(b.issuedAt)||a.sourceRef.localeCompare(b.sourceRef));
 const matches=new Map();let bytesRead=0;let ambiguous=0;
 for(const doc of docs){
  const res=await host.sourcePort.readSource({sourceRef:doc.sourceRef,
   requestedRevision:doc.revision,workspaceRef:host.request.workspaceRef});
  if(!res||res.complete!==true||res.revision!==doc.revision)continue;
  bytesRead+=Buffer.byteLength(res.content,'utf8');
  const index=lineFields(res.content,host.request.fields);
  for(const [key,rows] of index){
   if(rows.length!==1){ambiguous++;continue}
   if(which==='full_first'&&!matches.has(key))matches.set(key,rows[0].value);
   if(which==='exact_recent')matches.set(key,rows[0].value);
  }
 }
 return {method:which==='full_first'?'DIRECT_FULL_READ_FIRST_MATCH_PROXY':'EXACT_SEARCH_LATEST_LINE_PROXY',
  values:matches,metrics:{hostReads:host.getMetrics().reads,bytesRead,
   contextBytes:which==='full_first'?bytesRead:Buffer.byteLength([...matches].map(
     ([k,v])=>k+':'+v).join('\n'),'utf8'),
   elapsedMs:Number((performance.now()-start).toFixed(5)),
   duplicateLineDocuments:ambiguous,additionalVerificationBytes:0},
  notes:'DETERMINISTIC_LITERAL_PROXY_NOT_HUMAN_READING'};
}
async function runK01(fixture,owner,spec,withK05){
 const host=fixture.makeCommercialCase(spec.options);
 const start=performance.now();
 const p=await owner.prepareProjectContinuation(host.request,host.sourcePort);
 const k01Elapsed=performance.now()-start;
 const found=new Map();
 for(const item of p.projection.selected){
  const pos=item.excerpt.indexOf(':');
  if(pos>=0)found.set(item.id.slice('field:'.length),item.excerpt.slice(pos+1).trim());
 }
 const extraStart=performance.now();
 const proof=withK05?verifyK01ProjectEvidence(p,host.documents):null;
 const extraMs=performance.now()-extraStart;
 return {method:withK05?'K01_PLUS_K05_SOURCE_CHECK':'K01_CONTEXT_ONLY',
  values:found,
  metrics:{hostReads:host.getMetrics().reads,bytesRead:p.metrics.readBytes,
   contextBytes:Buffer.byteLength(p.projection.selected.map(v=>v.excerpt).join('\n'),'utf8'),
   elapsedMs:Number((k01Elapsed+extraMs).toFixed(5)),
   k01ElapsedMs:Number(k01Elapsed.toFixed(5)),
   additionalK05Ms:withK05?Number(extraMs.toFixed(5)):0,
   additionalVerificationBytes:proof?.metrics.sourceBytesRehashed??0,
   additionalHostReads:proof?.metrics.hostReadsByK05??0},
  notes:'SOURCE_VERIFIED_NOT_HUMAN_GOLD',provenance:proof?
   {status:proof.status,confirmed:proof.confirmed,unresolved:proof.unresolved,
    sourceRefs:proof.sourceRefs}:null,
  issues:p.issues.map(v=>({fieldKey:v.fieldKey,type:v.type}))};
}
function reportMethod(method,expected){
 const {values,...other}=method;
 return {...other,assessment:compareExpected(values,expected)};
}
export async function runStudy(root){
 root=resolve(root);
 pinnedOwner(root);
 const fixture=await import(pathToFileURL(join(root,'modules/k01-context/tests/fixtures/commercial-project.mjs')).href);
 const owner=await import(pathToFileURL(join(root,'modules/k01-context/integrations/project-continuation.mjs')).href);
 if(owner.PROJECT_CONTINUATION_VERSION!=='0.1.0')fail('K01_CONTRACT_DRIFT');
 const results=[];
 for(const scenario of cases){
  const expected=expectedFor(fixture,scenario);
  const measured=[];
  for(const baseline of ['full_first','exact_recent'])
   measured.push(reportMethod(await runLiteralProxy(fixture,scenario,baseline),expected));
  measured.push(reportMethod(await runK01(fixture,owner,scenario,false),expected));
  measured.push(reportMethod(await runK01(fixture,owner,scenario,true),expected));
  results.push({caseId:scenario.id,sourceKind:'K01_OWNER_AUTHORED_CONTROLLED_FIXTURE',
   expectedFieldDenominator:Object.keys(expected).length,
   methods:measured});
 }
 return {schema:SCHEMA,status:'MEASURED_PROCESSING_ON_OWNER_FIXTURE_NOT_USER_OUTCOME',
  owner:{repo:'Faust-S/knowledge',commit:K01_COMMIT,
   sha256CheckedGitBlobs:PINS},
  scenarios:results,
  constraints:{sourceNetworkLatencyMs:null,humanReadingTimeMs:null,
   llmCalls:0,modelQuality:null,skillsInvoked:0,agentSolutionsInvoked:0,
   independentHumanGold:false,precision:null,recall:null,f1:null,
   measuredComputeCostUsd:null,
   comparisonUnit:'DETERMINISTIC_LINE_EXTRACTION_NOT_HUMAN_COMPLETION'},
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);
 const pick=flag=>{const i=args.indexOf(flag);if(i<0||!args[i+1])fail('MISSING_ARGUMENT_'+flag);return args[i+1]};
 const output=pick('--out');
 if(existsSync(output))fail('OUTPUT_EXISTS');
 const report=await runStudy(pick('--k01-owner-root'));
 writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log('K05_PROJECT_ABLATION '+JSON.stringify({
  schema:report.schema,scenarios:report.scenarios.map(s=>({case:s.caseId,
   methods:s.methods.map(m=>({method:m.method,...m.assessment,rows:undefined,
    reads:m.metrics.hostReads,bytesRead:m.metrics.bytesRead,extraBytes:m.metrics.additionalVerificationBytes,
    elapsedMs:m.metrics.elapsedMs}))})),
  independentHumanGold:report.constraints.independentHumanGold,actualUserTimeMs:null
 }));
}
