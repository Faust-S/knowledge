import {createHash} from 'node:crypto';
import {ComposerError,digest} from './index.mjs';
import {verifyAgent05FileActionBatch} from './agent05-file-actions.mjs';

export const DELIVERY_PROGRESS_VERSION='IWXA.K04.AGENT05_DELIVERY_PROGRESS/0.1.0';
const STATES=new Set(['NOT_STARTED','AWAITING_APPROVAL','IN_FLIGHT',
  'ACKNOWLEDGED','UNKNOWN','FAILED','DECLINED']);
const OBSERVATION_KEYS=new Set(['target','writeState','readback','repairCaseId']);
const HEX=/^[0-9a-f]{64}$/;
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=code=>{throw new ComposerError(code);};
const hashBytes=text=>createHash('sha256').update(text,'utf8').digest('hex');
function validateObservation(row){
  if(!obj(row)||Object.keys(row).some(k=>!OBSERVATION_KEYS.has(k))||
     typeof row.target!=='string'||!STATES.has(row.writeState))
    fail('AGENT05_PROGRESS_OBSERVATION_INVALID');
  if(row.repairCaseId!==undefined&&row.repairCaseId!==null &&
    (row.writeState!=='UNKNOWN'||
     typeof row.repairCaseId!=='string'||
     !/^REPAIR-[A-Za-z0-9_-]{1,100}$/.test(row.repairCaseId)))
    fail('AGENT05_PROGRESS_REPAIR_CASE_INVALID');
  if(row.readback!==undefined&&row.readback!==null){
    const d=row.readback;
    if(!obj(d)||Object.keys(d).some(x=>!['root_id','path','text','sha256'].includes(x))||
       d.root_id!=='personal'||d.path!==row.target||
       typeof d.text!=='string'||Buffer.from(d.text,'utf8').toString('utf8')!==d.text||
       !HEX.test(d.sha256??'')||hashBytes(d.text)!==d.sha256)
      fail('AGENT05_PROGRESS_READBACK_INVALID');
  }
}
function summarizeFile(action,row){
  const writeState=row?.writeState??'NOT_STARTED';
  const read=row?.readback??null;
  const readbackStatus=read===null?'NOT_OBSERVED':
    (read.sha256===action.contentSha256&&read.text===action.text
      ?'MATCHES_PROPOSAL':'OTHER_CONTENT');
  let status,nextHostStep;
  if(writeState==='UNKNOWN'){
    status='RECONCILIATION_REQUIRED';
    nextHostStep='P01_RECOVER_INTERRUPTED_ACTION_AND_RECONCILE';
  }else if(readbackStatus==='OTHER_CONTENT'){
    status='CONTENT_CONFLICT';
    nextHostStep='STOP_AND_INSPECT_EXISTING_FILE';
  }else if(writeState==='FAILED'){
    status='FAILED_REQUIRES_REVIEW';
    nextHostStep='P01_REVIEW_FAILURE_AND_EXECUTION_RECEIPT';
  }else if(writeState==='DECLINED'){
    status='DECLINED_BY_USER';
    nextHostStep='AWAIT_NEW_USER_DECISION';
  }else if(writeState==='ACKNOWLEDGED'&&readbackStatus==='MATCHES_PROPOSAL'){
    status='HOST_REPORTED_ACK_AND_BYTES_MATCH';
    nextHostStep='P01_VERIFY_NATIVE_RECEIPTS_AND_CORE_RESULT';
  }else if(writeState==='ACKNOWLEDGED'){
    status='READBACK_REQUIRED';
    nextHostStep='P01_FILES_READ_AND_COMPARE_BYTES';
  }else if(readbackStatus==='MATCHES_PROPOSAL'){
    // A file can pre-exist from an older operation or another process.
    // Equal current bytes do NOT prove the intended action took place.
    status='PREEXISTING_FILE_NEEDS_HOST_REVIEW';
    nextHostStep='P01_CHECK_EXISTING_FILE_OR_RECOVERY';
  }else if(writeState==='AWAITING_APPROVAL'){
    status='AWAITING_USER_APPROVAL';
    nextHostStep='P01_SHOW_CURRENT_NATIVE_TOOL_PLAN';
  }else if(writeState==='IN_FLIGHT'){
    status='IN_FLIGHT';
    nextHostStep='P01_WAIT_FOR_TOOL_OR_RECOVER_IF_INTERRUPTED';
  }else{
    status='NOT_STARTED';
    nextHostStep='P01_PREPARE_ACCEPTED_ACTION_CANDIDATE';
  }
  return {
    name:action.name,target:action.target,status,
    writeState,readbackStatus,nextHostStep,
    repairCaseId:row?.repairCaseId??null,
    proposedUtf8Sha256:action.contentSha256,
    hostReportedWriteAcknowledged:writeState==='ACKNOWLEDGED',
    noAutomaticRetry:true,
  };
}

/** Read-only, stateless UI projection over the existing P01/U01 workflow.
 * Observations are UNTRUSTED host-reported snapshots, not native receipts.
 * K04 never claims delivery, executes commands, or authorizes retry.
 */
export function projectAgent05DeliveryProgress(batch,{observations=[]}={}){
  verifyAgent05FileActionBatch(batch);
  if(!Array.isArray(observations)||observations.length>batch.actions.length)
    fail('AGENT05_PROGRESS_OBSERVATIONS_INVALID');
  const byTarget=new Map();
  for(const row of observations){
    validateObservation(row);
    if(byTarget.has(row.target)||
       !batch.actions.some(action=>action.target===row.target))
      fail('AGENT05_PROGRESS_UNEXPECTED_TARGET');
    byTarget.set(row.target,row);
  }
  const files=batch.actions.map(action=>summarizeFile(action,byTarget.get(action.target)));
  const count=status=>files.filter(f=>f.status===status).length;
  const counts={
    total:files.length,
    hostReportedMatched:count('HOST_REPORTED_ACK_AND_BYTES_MATCH'),
    awaitingApproval:count('AWAITING_USER_APPROVAL'),
    inFlight:count('IN_FLIGHT'),
    awaitingReadback:count('READBACK_REQUIRED'),
    needsReconciliation:count('RECONCILIATION_REQUIRED'),
    contentConflicts:count('CONTENT_CONFLICT')+
      count('PREEXISTING_FILE_NEEDS_HOST_REVIEW'),
    failed:count('FAILED_REQUIRES_REVIEW'),
    declined:count('DECLINED_BY_USER'),
    notStarted:count('NOT_STARTED')
  };
  const ordered=[
    ['RECONCILIATION_REQUIRED','P01_RECOVER_INTERRUPTED_ACTION_AND_RECONCILE'],
    ['CONTENT_CONFLICT','STOP_AND_INSPECT_EXISTING_FILE'],
    ['PREEXISTING_FILE_NEEDS_HOST_REVIEW','P01_CHECK_EXISTING_FILE_OR_RECOVERY'],
    ['FAILED_REQUIRES_REVIEW','P01_REVIEW_FAILURE_AND_EXECUTION_RECEIPT'],
    ['DECLINED_BY_USER','AWAIT_NEW_USER_DECISION'],
    ['AWAITING_USER_APPROVAL','P01_SHOW_CURRENT_NATIVE_TOOL_PLAN'],
    ['IN_FLIGHT','P01_WAIT_FOR_TOOL_OR_RECOVER_IF_INTERRUPTED'],
    ['READBACK_REQUIRED','P01_FILES_READ_AND_COMPARE_BYTES'],
    ['NOT_STARTED','P01_PREPARE_ACCEPTED_ACTION_CANDIDATE'],
    ['HOST_REPORTED_ACK_AND_BYTES_MATCH','P01_VERIFY_NATIVE_RECEIPTS_AND_CORE_RESULT']
  ];
  const [overallStatus,nextHostStep]=ordered.find(([status])=>
    files.some(f=>f.status===status))??['NOT_STARTED','P01_PREPARE_ACCEPTED_ACTION_CANDIDATE'];
  const body={
    schema:DELIVERY_PROGRESS_VERSION,
    batchDigest:batch.batchDigest,taskRef:batch.taskRef,
    graphArtifactDigest:batch.graphArtifactDigest,
    deliveryMode:batch.deliveryMode??'full',counts,files,overallStatus,nextHostStep,
    statusMeaning:'UNTRUSTED_HOST_REPORTED_PROGRESS_NOT_EXECUTION_AUTHORITY',
    nativeWriteReceiptsVerifiedByK04:false,
    nativeReadReceiptsVerifiedByK04:false,
    hostAuthorityGranted:false,taskAcceptedByK04:false,
    deliveryCompletedByK04:false,retryAuthorizedByK04:false,
    humanReview:'P01_OWNED',goalDecision:'NOT_DECIDED',
  };
  return {...body,progressDigest:digest(body)};
}
