import {createHash} from 'node:crypto';
import {ComposerError,digest} from './index.mjs';
import {verifySavedMeetingDocuments} from './saved-meeting-result.mjs';

export const AGENT05_FILE_ACTION_VERSION='IWXA.K04.AGENT05_FILE_ACTIONS/0.1.0';
export const AGENT05_FILE_READBACK_VERSION='IWXA.K04.AGENT05_FILE_READBACK/0.1.0';
export const AGENT05_COMPACT_FILE_ACTION_VERSION='IWXA.K04.AGENT05_FILE_ACTIONS/0.2.0';
const COMPACT_FILE='meeting-followup.md';
const COMPACT_SOURCES=Object.freeze(['meeting-decisions.md',
  'review-questions.md','human-followup-drafts.md']);
const MAX_FILE_BYTES=1_000_000;
const FILES=Object.freeze(['action-register.csv','human-followup-drafts.md',
  'meeting-decisions.md','review-questions.md']);
const HEX=/^[0-9a-f]{64}$/;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const reject=code=>{throw new ComposerError(code);};
const fileSha256=text=>createHash('sha256').update(text,'utf8').digest('hex');
const goodText=text=>typeof text==='string' &&
  Buffer.from(text,'utf8').toString('utf8')===text;
function directory(value){
  if(typeof value!=='string'||value.length>500||value.startsWith('/')||
      value.includes('\\'))reject('AGENT05_TARGET_DIRECTORY_INVALID');
  if(value==='')return '';
  const segments=value.split('/');
  if(segments.length>12||segments.some(segment=>{
    if(!/^[\p{L}\p{N} _.()-]{1,80}$/u.test(segment) ||
       segment!==segment.trim() || segment==='.' || segment==='..' ||
       segment.endsWith('.') ||
       /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment))return true;
    return false;
  }))reject('AGENT05_TARGET_DIRECTORY_INVALID');
  return value;
}
function checkBatch(batch){
  const compact=batch?.schema===AGENT05_COMPACT_FILE_ACTION_VERSION;
  if(!isObject(batch)||
     !(batch.schema===AGENT05_FILE_ACTION_VERSION||compact)||
     !HEX.test(batch.batchDigest??''))reject('AGENT05_FILE_BATCH_INVALID');
  const expected=compact?[COMPACT_FILE]:FILES;
  if(compact && (batch.deliveryMode!=='compact'||!Array.isArray(batch.sourceDocuments)||
      batch.sourceDocuments.length!==COMPACT_SOURCES.length||
      batch.sourceDocuments.some((name,i)=>name!==COMPACT_SOURCES[i])))
    reject('AGENT05_FILE_BATCH_CHANGED');
  if(!compact&&('deliveryMode' in batch||'sourceDocuments' in batch))
    reject('AGENT05_FILE_BATCH_CHANGED');
  const {batchDigest,...payload}=batch;
  if(digest(payload)!==batchDigest||batch.authorityGranted!==false||
     batch.executed!==false||batch.resultAccepted!==false||
     batch.origin!=='P01_SAVED_GRAPH_RESULT' ||
     !Array.isArray(batch.actions)||batch.actions.length!==expected.length)
    reject('AGENT05_FILE_BATCH_CHANGED');
  for(let i=0;i<expected.length;i++){
    const x=batch.actions[i];
    if(!isObject(x)||x.name!==expected[i]||x.operation!=='files.write_text'||
      x.effectClass!=='WRITE'||x.requiresHumanApproval!==true||
      x.executionState!=='NOT_EXECUTED'||x.rootId!=='personal'||
      !isObject(x.arguments)||x.arguments.root_id!=='personal'||
      x.arguments.mode!=='create'||x.arguments.path!==x.target||
      x.arguments.text!==x.text||!goodText(x.text)||
      !HEX.test(x.contentSha256??'')||
      fileSha256(x.text)!==x.contentSha256||
      x.k04ContentDigest!==digest(x.text)||
      Buffer.byteLength(x.text,'utf8')>MAX_FILE_BYTES||
      !x.target.endsWith('/'+x.name)&&!x.target.endsWith('-'+x.name))
      reject('AGENT05_FILE_BATCH_CHANGED');
  }
}
/** Check the complete legacy or compact candidate batch without granting execution. */
export function verifyAgent05FileActionBatch(batch){
  checkBatch(batch);
  return true;
}
export function prepareAgent05FileActions(pack,{baseDirectory='',deliveryMode='full'}={}){
  if(!['full','compact'].includes(deliveryMode))
    reject('AGENT05_DELIVERY_MODE_INVALID');
  verifySavedMeetingDocuments(pack);
  const base=directory(baseDirectory);
  if(!isObject(pack.graph)||!HEX.test(pack.graph.artifactDigest??''))
    reject('AGENT05_GRAPH_ORIGIN_REQUIRED');
  if(FILES.some(name=>!goodText(pack.documents?.[name])))
    reject('AGENT05_DOCUMENT_ENCODING_INVALID');
  const compact=deliveryMode==='compact';
  const selectedFiles=compact?[COMPACT_FILE]:FILES;
  const documentContent=compact
    ?{[COMPACT_FILE]:'# Результат встречи. Черновик для проверки\n\n'+
        'Все поручения ниже ещё не выполнены. Ничего не отправлено.\n\n'+
        COMPACT_SOURCES.map(name=>pack.documents[name]).join('\n\n---\n\n')+
        '\n\nДля отдельного CSV-реестра выберите полный комплект.\n'}
    :pack.documents;
  // The user chooses an existing writable directory. A stable artifact-derived
  // prefix avoids a second Store, extra mkdir calls and filename collisions.
  const prefix='K04-'+digest({taskRef:pack.taskRef,
    artifactDigest:pack.graph.artifactDigest}).slice(0,20);
  const actions=selectedFiles.map(name=>{
    const target=(base?base+'/':'')+prefix+'-'+name;
    const text=documentContent[name];
    if(!goodText(text))reject('AGENT05_DOCUMENT_ENCODING_INVALID');
    if(Buffer.byteLength(text,'utf8')>MAX_FILE_BYTES)
      reject('AGENT05_DOCUMENT_TOO_LARGE');
    return {name,operation:'files.write_text',target,rootId:'personal',
      arguments:{root_id:'personal',path:target,mode:'create',text},
      text,contentSha256:fileSha256(text),
      k04ContentDigest:compact?digest(text):pack.documentDigests[name],
      bytes:Buffer.byteLength(text,'utf8'),effectClass:'WRITE',
      requiresHumanApproval:true,executionState:'NOT_EXECUTED',
      risk:'medium',reversible:true,
      idempotency:'U01_PLAN_AND_RECOVERY_ONLY'};
  });
  const body={
    schema:compact?AGENT05_COMPACT_FILE_ACTION_VERSION:AGENT05_FILE_ACTION_VERSION,
    origin:'P01_SAVED_GRAPH_RESULT',
    taskRef:pack.taskRef,graphExecutionId:pack.graph.executionId,
    graphArtifactDigest:pack.graph.artifactDigest,
    graphNodeRunDigest:pack.graph.nodeRunDigest,
    sourceDigest:pack.source.transcriptDigest,
    packageDigest:pack.packageDigest,rootId:'personal',
    baseDirectory:base,filenamePrefix:prefix,actions,
    ...(compact?{deliveryMode:'compact',sourceDocuments:[...COMPACT_SOURCES]}:{}),
    hostPrerequisites:[
      'P01_REVALIDATE_SAVED_GRAPH_SOURCE_AND_ARTIFACT',
      'P01_HUMAN_ACCEPTED_TASK_AND_ACTION_CANDIDATES',
      'U01_CURRENT_FILE_PROVIDER_BINDING',
      'U01_HUMAN_APPROVED_TOOL_PLAN_PER_WRITE',
      'U01_READBACK_OR_RECONCILIATION_BEFORE_RETRY'
    ],
    onExistingFile:'READBACK_AND_COMPARE_NOT_OVERWRITE',
    onUnknownWriteOutcome:'RECONCILIATION_REQUIRED_NO_AUTO_RETRY',
    authorityGranted:false,executed:false,resultAccepted:false,
  };
  return {...body,batchDigest:digest(body)};
}
/**
 * Inspect host-supplied files.read observations for byte equality only.
 * P01 must separately verify native ToolRuntime write/read receipts and
 * archived Task/Result, and approve completion with existing Human Review.
 */
export function inspectAgent05FileReadbacks(batch,observations){
  checkBatch(batch);
  if(!Array.isArray(observations)||observations.length!==batch.actions.length)
    reject('AGENT05_READBACKS_INCOMPLETE');
  const seen=new Set();
  const files=[];
  for(const observation of observations){
    if(!isObject(observation)||!isObject(observation.data)||
      !isObject(observation.receipt)||
      observation.receipt.tool_id!=='files.read'||
      observation.receipt.status!=='SUCCEEDED'||
      !HEX.test(observation.receipt.receipt_digest??''))
      reject('AGENT05_READBACK_INVALID');
    const data=observation.data;
    const target=data.path;
    const action=batch.actions.find(a=>a.target===target);
    if(!action||seen.has(target))reject('AGENT05_READBACK_UNEXPECTED');
    seen.add(target);
    if(data.root_id!=='personal'||!goodText(data.text)||
       data.sha256!==fileSha256(data.text)||
       data.sha256!==action.contentSha256||data.text!==action.text||
       Buffer.byteLength(data.text,'utf8')!==action.bytes)
      reject('AGENT05_READBACK_MISMATCH');
    files.push({name:action.name,path:target,
      utf8Sha256:action.contentSha256,
      readReceiptDigest:observation.receipt.receipt_digest,
      bytes:action.bytes});
  }
  const body={
    schema:AGENT05_FILE_READBACK_VERSION,batchDigest:batch.batchDigest,
    taskRef:batch.taskRef,graphArtifactDigest:batch.graphArtifactDigest,
    status:'HOST_SUPPLIED_READBACK_BYTES_MATCH',
    files:batch.actions.map(x=>files.find(f=>f.name===x.name)),
    filesCompared:batch.actions.length,
    nativeToolWriteReceiptsVerifiedByK04:false,
    nativeToolReadReceiptsVerifiedByK04:false,
    hostAuthorityGranted:false,
    taskAcceptedByK04:false,
    assignmentsExecuted:false,goalCompleted:false,
  };
  return {...body,observationDigest:digest(body)};
}
