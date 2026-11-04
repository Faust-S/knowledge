#!/usr/bin/env node
/** BPI13-05: read-only question-conditioned research; never accept Task/TaskType. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const VERSION='IWXA_BPI13_METHOD_PAIR/0.1';
const SHA='6ec2136c607648608655802486df97a866f351668751b7ecbca51e1f8715d522';
const U1='eb15aec5ba1a749c29d7c40a868127e1a384b6bf';
const CUES={
 INCIDENT_ESCALATION_TIMING:['эскалац','поддерж','обращен','срок','передач'],
 TEAM_PING_PONG:['передач','эскалац','поддерж','координац'],
 WAIT_USER_STATUS_ABUSE:['срок','поддерж','ожидан','обращен','клиент'],
 ORGANIZATION_PROCESS_CONFORMITY:['процесс','организац','соответств','регламент','сравн']
};
function gate(x,code){if(!x)throw Error(code)}
export function readCatalog(buffers){
 gate(Array.isArray(buffers)&&buffers.length>0,'CATALOGUE_INPUT_MISSING');
 const entries=[],hashes=[],seen=new Set();
 for(const raw of buffers){
  gate(Buffer.isBuffer(raw)&&raw.length>0,'CATALOGUE_BYTES_INVALID');
  hashes.push(createHash('sha256').update(raw).digest('hex'));
  let category=null;
  for(const line of raw.toString('utf8').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)){
   if(line.startsWith('#'))continue;
   const p=line.replace(/^@/,'').split('|');
   if(line.startsWith('@')){gate(/^C\d\d$/.test(p[0])&&p.length>=4,'CATALOGUE_HEADER_INVALID');category=p[0];continue}
   gate(category&&/^\d\d$/.test(p[0])&&p.length===5,'CATALOGUE_ROW_INVALID');
   const id=category+'-'+p[0];gate(!seen.has(id),'CATALOGUE_DUPLICATE');seen.add(id);
   entries.push({id,title:p[2],inputs:p[3],criterion:p[4]});
  }
 }
 gate(entries.length>0,'CATALOGUE_EMPTY');return {entries,hashes};
}
export function rank(entries,id,k=3){
 gate(Object.hasOwn(CUES,id),'UNKNOWN_QUESTION');
 gate(Number.isInteger(k)&&k>=1&&k<=10,'INVALID_TOPK');
 return entries.map(e=>({id:e.id,score:CUES[id].reduce((n,c)=>n+
  (e.title.toLowerCase().includes(c)?3:0)+(e.inputs.toLowerCase().includes(c)?2:0)+
  (e.criterion.toLowerCase().includes(c)?1:0),0)})).filter(x=>x.score>0)
  .sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,k);
}
export function compare(r,catalogue=null){
 gate(r.schema==='IWXA_BPI13_OFFICIAL_INCIDENTS_APPLICABILITY/0.1','WRONG_SCHEMA');
 gate(r.source?.file_sha256===SHA&&r.source?.sha_pinned_before_this_run===true,'SOURCE_PIN_HOLD');
 gate(r.population?.recorded_cases===7554&&r.population?.registered_events===65533&&r.population?.catalogue_counts_match,'POPULATION_HOLD');
 gate(r.u1_sample?.native_owner_git_blob===U1&&!r.u1_sample?.engine_accepted&&r.u1_sample?.accepted_tasktypes===0,'U1_AUTHORITY_HOLD');
 gate(r.qualification?.accepted_user_tasks===0&&r.qualification?.independent_task_gold==='NOT_MEASURED','GOLD_HOLD');
 gate(r.field_applicability?.wait_user_label_events===4217&&r.field_applicability?.wait_user_label_cases===2495,'AGGREGATE_HOLD');
 gate(r.questions?.length===4&&new Set(r.questions.map(q=>q.id)).size===4,'QUESTION_SCOPE_HOLD');
 const questions=r.questions.map(q=>{
  gate(Object.hasOwn(CUES,q.id),'UNKNOWN_QUESTION');
  const missing=[...q.missing_evidence];
  if(q.id==='ORGANIZATION_PROCESS_CONFORMITY')missing.unshift('authoritative_support_A2_C_organization_mapping');
  return {id:q.id,source_first:{status:'PROPOSED_INVESTIGATION_NOT_TASK',
    source_fit:q.id==='ORGANIZATION_PROCESS_CONFORMITY'?'REQUESTER_ORG_NOT_SUPPORT_ORG':q.source_fit,
    missing_evidence:missing,work_as_done:'UNKNOWN',task_accepted:false},
    catalogue_prior:catalogue?{status:'LEXICAL_CANDIDATES_ONLY',candidates:rank(catalogue.entries,q.id),
      accepted_tasktypes:0}:{status:'NOT_RUN_OWNER_LOCAL_CATALOGUE_ABSENT'}};
 });
 return {schema:VERSION,scope:'FOUR_PUBLISHED_OWNER_QUESTIONS_NOT_FREE_TASK_DISCOVERY',
  source:{incidents_sha256:SHA,u1_blob:U1,private_catalogue_sha256:catalogue?.hashes??[],
   original_source_rows_exported:false,original_catalogue_titles_exported:false},
  source_first:{question_count:questions.length,missing_evidence_categories:questions.reduce((s,q)=>s+q.source_first.missing_evidence.length,0),
   accepted_tasks:0},
  catalogue_prior:{status:catalogue?'LEXICAL_RETRIEVAL_NO_GOLD':'NOT_RUN_OWNER_LOCAL_CATALOGUE_ABSENT',
   denominator:catalogue?.entries.length??null,top_k:catalogue?3:null,
   questions_with_candidates:catalogue?questions.filter(q=>q.catalogue_prior.candidates.length).length:null,
   candidate_count:catalogue?questions.reduce((n,q)=>n+q.catalogue_prior.candidates.length,0):null},
  questions,qualification:{independent_work_truth:'UNKNOWN',task_precision_recall:'NOT_MEASURED',
   false_confident_claim_rate:'NOT_MEASURED',unknown_accuracy:'NOT_MEASURED',
   acquisition_human_time:'NOT_MEASURED',acquisition_cost:'NOT_MEASURED',
   independent_confirmation:'NOT_PRESENT',accepted_tasks:0,task_result:'NOT_RUN',e5:'NOT_RUN'}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{let fit,output,files=[];
  for(let i=2;i<process.argv.length;i++){
   const a=process.argv[i],v=process.argv[++i];
   gate(['--fit','--out','--catalog'].includes(a)&&v,'INVALID_ARGUMENT');
   if(a==='--fit')fit=v;else if(a==='--out')output=v;else files.push(v);
  }
  gate(fit&&output&&fit!==output&&!existsSync(output),'OUTPUT_INVALID');
  const report=compare(JSON.parse(readFileSync(fit,'utf8')),files.length?readCatalog(files.map(p=>readFileSync(p))):null);
  writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log('BPI13_METHOD_PAIR_SCOPED_PASS',report.source_first.question_count,'questions',report.source_first.missing_evidence_categories,'gaps',report.catalogue_prior.status,'accepted',report.qualification.accepted_tasks);
 }catch(e){console.error('BPI13_METHOD_PAIR_HOLD',String(e.message).slice(0,100));process.exitCode=2}
}
