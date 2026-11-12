import {ComposerError,digest,matchTask,resolveRequiredCapabilities,
  createHostNeutralPlan,checkMeetingEvidence,evaluateResultAgainstCriteria} from './index.mjs';
import {prepareK02StepHandoff} from './k02-step-handoff.mjs';

export const MEETING_PROCESS_VERSION='IWXA.K04.MEETING_PROCESS/0.1.0';
export const MEETING_PACKAGE_VERSION='IWXA.K04.MEETING_PACKAGE/0.1.0';
const names=['meeting-decisions.md','action-register.csv','human-followup-drafts.md','review-questions.md'];
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'&&x.trim().length>0;
const fail=code=>{throw new ComposerError(code);};
const csv=x=>'"'+String(x).replace(/"/gu,'""').replace(/\r?\n/gu,' ')+'"';
const actionKey=x=>x.toLocaleLowerCase('ru-RU').replace(/[.!?]+$/u,'').replace(/\s+/gu,' ').trim();
const pointIndex=(text,offset)=>Array.from(text.slice(0,offset)).length;

/** Bounded extractor for explicitly recorded adopted decisions, not natural-language inference. */
export function extractAdoptedMeetingDecisions(transcript){
  if(!str(transcript)||Buffer.byteLength(transcript,'utf8')>1_000_000)fail('MEETING_SOURCE_REQUIRED');
  const action_items=[],open_questions=[],discussions=[];
  for(const line of transcript.matchAll(/[^\r\n]+/gu)){
    const quote=line[0],marker='Решение принято:';
    if(!quote.trimStart().startsWith(marker)){
      if(/обсужд|предлож|идея|решение не принято/iu.test(quote))
        discussions.push({quote,start:pointIndex(transcript,line.index)});
      continue;
    }
    const rest=quote.slice(quote.indexOf(marker)+marker.length).trim();
    const parts=rest.split(/\s*;\s*/u);
    const action=(parts.shift()??'').trim().replace(/[.\s]+$/u,'');
    if(!str(action)){
      open_questions.push('Отсутствует действие в записи: '+quote);continue;
    }
    let assignee='UNKNOWN',due_date='UNKNOWN',invalid=false;
    for(const part of parts){
      const owner=/^(?:исполнитель|ответственный)\s*:\s*(.+)$/iu.exec(part);
      const deadline=/^срок\s*:\s*(.+)$/iu.exec(part);
      if(owner){
        if(assignee!=='UNKNOWN')invalid=true;
        assignee=owner[1].trim().replace(/[.\s]+$/u,'')||'UNKNOWN';
      }else if(deadline){
        if(due_date!=='UNKNOWN')invalid=true;
        due_date=deadline[1].trim().replace(/[.\s]+$/u,'')||'UNKNOWN';
      }else invalid=true;
    }
    if(invalid){open_questions.push('Неоднозначная запись решения: '+quote);continue;}
    if(assignee==='UNKNOWN')open_questions.push('Уточнить исполнителя: '+action);
    if(due_date==='UNKNOWN')open_questions.push('Уточнить срок: '+action);
    const start=pointIndex(transcript,line.index);
    action_items.push({action,quote,start,end:start+Array.from(quote).length,
      assignee,due_date,worker_kind:assignee==='UNKNOWN'?'unassigned':'human',
      actual_work_status:'NOT_EXECUTED'});
  }
  if(!action_items.length)open_questions.push('Нет явно принятых решений: требуется уточнение.');
  return {draft:{action_items,open_questions:[...new Set(open_questions)]},
    discussions,decisionCount:action_items.length};
}

export function reconcileMeetingDecisions(transcript,draft){
  const verified=checkMeetingEvidence(transcript,draft);
  const conflicts=[],duplicates=[],seen=new Map();
  for(const [index,item] of (Array.isArray(draft?.action_items)?draft.action_items:[]).entries()){
    if(!obj(item)||!str(item.action))continue;
    const key=actionKey(item.action),previous=seen.get(key);
    if(previous){
      if(previous.assignee!==item.assignee||previous.due_date!==item.due_date)
        conflicts.push({action:item.action,indices:[previous.index,index],
          reason:'ACCEPTED_DECISIONS_DISAGREE_ON_OWNER_OR_DEADLINE'});
      else duplicates.push({action:item.action,indices:[previous.index,index]});
    }else seen.set(key,{...item,index});
  }
  return {passed:verified.passed&&!conflicts.length&&!duplicates.length,
    evidencePassed:verified.passed,errors:[...verified.errors,
      ...conflicts.map(c=>'DECISION_CONFLICT_'+c.indices.join('_')),
      ...duplicates.map(c=>'DUPLICATE_DECISION_'+c.indices.join('_'))],
    accepted:verified.accepted,conflicts,duplicates};
}
function receipt(plan,id,input,output,durationMs){
  const step=plan.steps.find(x=>x.id===id);
  if(!step?.selected)fail('MEETING_STEP_NOT_SELECTED');
  return {stepId:id,providerId:step.selected.providerId,
    capabilityId:step.selected.capabilityId,descriptorDigest:step.selected.descriptorDigest,
    planDigest:plan.planDigest,inputDigest:digest(input),
    status:'SUCCEEDED',output,outputDigest:digest(output),durationMs};
}

/** Pure specialized preparation, using original K04 and K02 contracts. */
export function prepareMeetingProcess({task,solution,available}){
  if(!obj(task)||!obj(task.input)||!str(task.input.transcript_text))
    fail('MEETING_SOURCE_REQUIRED');
  const selected=matchTask(task,[solution]).candidates[0];
  if(selected?.status!=='CANDIDATE')fail('MEETING_TASK_NEEDS_INPUT');
  const resolved=resolveRequiredCapabilities(solution,available,{preferOption:'structured_rule'});
  if(resolved.status!=='SUPPORTED'||resolved.chosenOption!=='structured_rule')
    fail('MEETING_REQUIRED_CAPABILITY_UNAVAILABLE');
  const plan=createHostNeutralPlan({task,solution,resolution:resolved});
  const k02Handoff=prepareK02StepHandoff({plan,profiles:solution.stepSelectionProfiles,
    availableInputs:['transcript_text']});
  if(k02Handoff.status!=='READY_FOR_K02')fail('MEETING_STEP_NEEDS_INPUT');
  const transcript=task.input.transcript_text;
  const t0=performance.now(),parsed=extractAdoptedMeetingDecisions(transcript);
  const extractMs=performance.now()-t0;
  const t1=performance.now(),audit=reconcileMeetingDecisions(transcript,parsed.draft);
  const auditMs=performance.now()-t1;
  const verified=checkMeetingEvidence(transcript,parsed.draft);
  const receipts=[receipt(plan,'extract',transcript,parsed.draft,extractMs),
    receipt(plan,'audit',{transcript,draft:parsed.draft},
      {passed:verified.passed,errors:verified.errors,accepted:verified.accepted},auditMs)];
  const evaluation=evaluateResultAgainstCriteria({
    plan,transcript,draft:parsed.draft,receipts,
    humanReview:{status:'PENDING'},taskReport:{status:'NOT_SUBMITTED'},
    goalDecision:{status:'NOT_DECIDED'}});
  if(!evaluation.passed||!audit.evidencePassed)fail('MEETING_EVIDENCE_REJECTED');
  const unknown=parsed.draft.action_items.some(x=>x.assignee==='UNKNOWN'||x.due_date==='UNKNOWN');
  const status=!parsed.decisionCount?'NEEDS_INPUT':
    audit.conflicts.length||audit.duplicates.length?'CONFLICT_REVIEW_REQUIRED':
      unknown?'CLARIFICATION_REQUIRED':'DRAFT_READY_FOR_HUMAN_REVIEW';
  const body={schema:MEETING_PROCESS_VERSION,taskRef:task.taskId,hostPlan:plan,
    k02HandoffDigest:k02Handoff.handoffDigest,
    provenance:{sourceRef:task.source.ref,revision:task.source.revision,
      rights:task.source.rights,transcriptDigest:digest(transcript)},
    extraction:parsed,reconciliation:audit,stepReceipts:receipts,
    legacyEvaluation:evaluation,status,hostReview:'PENDING',
    taskReport:'NOT_SUBMITTED',assignmentsExecuted:false,goalCompleted:false,
    graphIntegration:'HOST_MAPPING_REQUIRED',
    existingGraphNodeKinds:['DETERMINISTIC_TRANSFORM','MODEL_INVOCATION','TOOL'],
    outputSteps:['render_documents','write_documents','readback_documents','human_review'],
    retryPolicy:{render:'RECOMPUTE_PURE',write:'READBACK_BEFORE_RETRY',
      humanReview:'HOST_OWNED_NO_AUTO_RETRY'},hostAuthorityGranted:false};
  return {...body,processDigest:digest(body),k02Handoff};
}
export function verifyMeetingProcess(process){
  if(!obj(process)||process.schema!==MEETING_PROCESS_VERSION||
      !/^[a-f0-9]{64}$/.test(process.processDigest??''))
    fail('INVALID_MEETING_PROCESS');
  const {processDigest,k02Handoff,...body}=process;
  if(digest(body)!==processDigest)fail('MEETING_PROCESS_CHANGED');
  if(k02Handoff?.handoffDigest!==process.k02HandoffDigest)
    fail('MEETING_K02_HANDOFF_CHANGED');
  const {planDigest,...unsigned}=process.hostPlan;
  if(planDigest!==digest(unsigned))fail('MEETING_PLAN_CHANGED');
  return true;
}
export function renderMeetingDocuments(process){
  verifyMeetingProcess(process);
  return buildMeetingDocuments(process);
}
/** Pure shared renderer for a host-verified saved Graph draft. No Graph or Task mutation. */
export function renderMeetingDraftPackage({taskRef,provenance,draft,reconciliation,status,evidenceLabel=null}){
  if(typeof taskRef!=='string'||!taskRef.trim()||
     !provenance||typeof provenance.sourceRef!=='string'||
     typeof provenance.revision!=='string'||
     typeof provenance.rights!=='string'||
     !/^[a-f0-9]{64}$/.test(provenance.transcriptDigest??'')||
     !draft||!Array.isArray(draft.action_items)||!Array.isArray(draft.open_questions)||
     !reconciliation||typeof status!=='string')
    fail('INVALID_SAVED_MEETING_DOCUMENT_INPUT');
  const processDigest=digest({taskRef,provenance,draft,reconciliation,status,evidenceLabel});
  return buildMeetingDocuments({taskRef,provenance,extraction:{draft,discussions:null},
    reconciliation,status,processDigest,evidenceLabel});
}
function buildMeetingDocuments(process){
  const items=process.extraction.draft.action_items;
  const questions=process.extraction.draft.open_questions;
  const p=process.provenance;
  const header='Task: '+process.taskRef+'\nИсточник: '+p.sourceRef+' @ '+p.revision+
    '\nИсточник SHA-256: '+p.transcriptDigest+'\n'+
    (process.evidenceLabel?'Graph Result: '+process.evidenceLabel+'\n':'');
  const rows=items.map((a,i)=>'| '+(i+1)+' | '+a.action+' | '+a.assignee+' | '+a.due_date+
    ' | НЕ ВЫПОЛНЕНО | '+a.start+'–'+a.end+' |');
  const warnings=process.reconciliation.conflicts.map(c=>'- '+c.action+
    ': противоречие записей '+c.indices.map(i=>i+1).join(' и '));
  const summary='# Решения встречи\n\n'+header+'\nСтатус: '+process.status+'\n'+
    'Извлечено решений: '+items.length+'. Обсуждений без решения: '+
    (process.extraction.discussions===null?'не определено':process.extraction.discussions.length)+'.\n\n'+
    '| № | Действие | Исполнитель | Срок | Выполнение | Цитата: смещение Unicode |\n'+
    '| --- | --- | --- | --- | --- | --- |\n'+rows.join('\n')+'\n\n'+
    (warnings.length?'Противоречия:\n'+warnings.join('\n')+'\n':'')+
    '\nДокумент не подтверждает исполнение поручений.\n';
  const table=['номер','действие','исполнитель','срок','статус_работы',
    'смещение_начала','смещение_конца','точная_цитата'];
  const csvRows=items.map((a,i)=>[i+1,a.action,a.assignee,a.due_date,'NOT_EXECUTED',
    a.start,a.end,a.quote].map(csv).join(','));
  const register=[table.map(csv).join(','),...csvRows].join('\n')+'\n';
  const human=items.map((a,i)=>'## Поручение '+(i+1)+'\n\n'+
    'Действие: '+a.action+'\nИсполнитель: '+a.assignee+'\nСрок: '+a.due_date+
    '\nОснование: «'+a.quote+'»\nСтатус: NOT_EXECUTED\n\n'+
    'Черновик для ручной передачи. Сообщение не отправлено.\n').join('\n');
  const checklist='# Вопросы и проверка перед принятием\n\n'+header+'\nСтатус: '+
    process.status+'\n\n'+(questions.length?questions.map(q=>'- '+q).join('\n'):
      '- Неясных исполнителей или сроков в явных решениях не обнаружено.')+
    (warnings.length?'\n\n'+warnings.join('\n'):'')+
    '\n\n- Проверить смысл принятых решений.\n'+
    '- Проверить исходные цитаты.\n'+
    '- Подтвердить поручения существующим Human Review.\n'+
    '- Получить реальные отчёты исполнителей и доказательства выполненных работ.\n'+
    '- Отдельно принять отчёт Task и решение о завершении Goal.\n';
  const documents={
    'meeting-decisions.md':summary,'action-register.csv':register,
    'human-followup-drafts.md':'# Черновики поручений\n\n'+header+'\n'+human,
    'review-questions.md':checklist
  };
  if(Object.keys(documents).sort().join('|')!==[...names].sort().join('|'))
    fail('DOCUMENT_MANIFEST_INVALID');
  return {schema:MEETING_PACKAGE_VERSION,processDigest:process.processDigest,
    documents,documentDigests:Object.fromEntries(Object.entries(documents).map(
      ([name,content])=>[name,digest(content)])),
    hostReadbackRequired:true,humanReviewRequired:true,assignmentsExecuted:false,
    taskCreated:false,externalMessagesSent:false};
}

/** Read-only mapping for the EXISTING Agent Graph, not a second graph definition.
 * P01 supplies actual node IDs, provider binding, task authorization and receipts.
 * Sample open-host receipts are not automatically Graph execution evidence.
 */
export function createMeetingGraphHandoff(process){
  verifyMeetingProcess(process);
  const stages=process.hostPlan.steps;
  const nodes=stages.filter(s=>s.type!=='HOST_GATE').map(s=>({
    k04StepId:s.id,
    existingNodeType:s.type==='HOST_INPUT'?'DETERMINISTIC_TRANSFORM':
      s.type==='HOST_TRANSFORM'?'DETERMINISTIC_TRANSFORM':
        s.selected?.kind==='model'?'MODEL_INVOCATION':'TOOL',
    dependsOn:Array.isArray(s.dependsOn)?[...s.dependsOn]:[],
    capabilityRef:s.selected?{
      providerId:s.selected.providerId,capabilityId:s.selected.capabilityId,
      kind:s.selected.kind,descriptorDigest:s.selected.descriptorDigest,
      ...(s.selected.modelPin?{modelPin:structuredClone(s.selected.modelPin)}:{})
    }:null,
    hostMustBindAndExecute:true,hostGraphReceipt:null,
  }));
  const body={
    schema:'IWXA.K04.EXISTING_GRAPH_HANDOFF/0.1.0',
    taskRef:process.taskRef,planDigest:process.hostPlan.planDigest,
    sourceRef:process.provenance.sourceRef,
    sourceRevision:process.provenance.revision,
    sourceDigest:process.provenance.transcriptDigest,
    nodes,humanReview:{existingHostGate:'human_review',status:'PENDING'},
    hostGraphExecution:'NOT_EXECUTED_BY_K04',
    graphPersisted:false,modelInvokedByK04:false,
    sourceSampleReceiptsNotGraphReceipts:true,
  };
  return {...body,handoffDigest:digest(body)};
}
