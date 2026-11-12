import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {digest} from '../index.mjs';
import {extractAdoptedMeetingDecisions} from '../meeting-process.mjs';
import {prepareSavedMeetingDocuments} from '../saved-meeting-result.mjs';
import {prepareAgent05FileActions,inspectAgent05FileReadbacks} from '../agent05-file-actions.mjs';

const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const canonical=x=>Array.isArray(x)?x.map(canonical):x!==null&&typeof x==='object'?
  Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;

/** Author-authored synthetic Graph snapshot, not native P01 or model evidence.
 * Use the real K04 validators and a real local filesystem open-host.
 */
export async function runAgent05DocumentDelivery({directory=null,deliveryMode='compact'}={}){
  const raw=await readFile(new URL('meeting-case-05.txt',import.meta.url),'utf8');
  const transcript=raw.replace(/\r\n?/gu,'\n'); // Only the authored CI fixture.
  const taskRef='TASK-PUBLIC-K04-MEETING-05';
  const input=extractAdoptedMeetingDecisions(transcript).draft;
  const graphConfigDigest=digest({taskRef,sourceRevision:'authored-fixture-LF-v1'});
  const artifactDigest=digest({taskRef,draft:input,graphConfigDigest});
  const source={ref:'public-author-fixture/meeting-case-05.txt',
    revision:'authored-fixture-LF-v1',rights:'AUTHOR_OWNED_SYNTHETIC',
    transcript,transcriptDigest:digest(transcript),graphConfigDigest};
  const graphResult={
    execution_id:'SYNTHETIC-EXEC-K04-MEETING-05',graph_id:'meeting-followup',
    graph_digest:digest({graphId:'meeting-followup',taskRef}),
    execution_digest:digest({taskRef,artifactDigest,stage:'COMPLETED'}),
    node_id:'result',node_run_digest:digest({artifactDigest,run:'one'}),
    artifact_digest:artifactDigest,attempt:1,
    text:JSON.stringify(canonical(input)),content_type:'text/plain',
    execution_state:'COMPLETED',result_is_execution_authority:false,
    human_review_required:true,quality_evaluation:{
      contract:'PUBLIC_SYNTHETIC_SAMPLE_NOT_NATIVE_K05',
      status:'SOURCE_QUOTES_VERIFIED',source_revision:graphConfigDigest,
      passed:true,source_quotes_checked:input.action_items.length,
      errors:[],result_accepted:false,human_review_required:true,
    }
  };
  const started=performance.now();
  const packageResult=prepareSavedMeetingDocuments({taskRef,source,graphResult});
  const batch=prepareAgent05FileActions(packageResult,{deliveryMode});
  const targetRoot=directory?resolve(directory):
    await mkdtemp(join(tmpdir(),'iwxa-k04-open-host-delivery-'));
  await mkdir(targetRoot,{recursive:true});
  let created=0,reused=0;
  const observations=[];
  for(const action of batch.actions){
    if(basename(action.target)!==action.target)
      throw new Error('OPEN_HOST_SAMPLE_LEAF_ONLY');
    const file=join(targetRoot,action.target);
    try{
      await writeFile(file,action.arguments.text,{encoding:'utf8',flag:'wx'});
      created++;
    }catch(e){
      if(e?.code!=='EEXIST')throw e;
      reused++;
    }
    const text=await readFile(file,'utf8');
    if(sha(text)!==action.contentSha256||text!==action.arguments.text)
      throw new Error('OPEN_HOST_READBACK_MISMATCH');
    const readReceiptDigest=digest({kind:'SYNTHETIC_OPEN_HOST_READBACK',
      name:action.name,sha256:sha(text)});
    observations.push({
      data:{root_id:'personal',path:action.target,text,sha256:sha(text)},
      receipt:{tool_id:'files.read',status:'SUCCEEDED',
        receipt_digest:readReceiptDigest}
    });
  }
  const checked=inspectAgent05FileReadbacks(batch,observations);
  if(checked.filesCompared!==batch.actions.length)
    throw new Error('OPEN_HOST_INCOMPLETE');
  return {
    taskRef,sourceKind:'AUTHOR_OWNED_SYNTHETIC_MEETING',
    graphEvidenceKind:'SYNTHETIC_SNAPSHOT_NOT_NATIVE_P01',
    mode:deliveryMode,
    packageStatus:packageResult.status,
    processValidations:{
      actionsExtracted:input.action_items.length,
      quotesIndependentlyChecked:packageResult.quotesIndependentlyChecked,
    },
    outputDirectory:targetRoot,
    documents:checked.files,
    created,reused,
    actualLocalOpenHostWrites:created,
    actualLocalOpenHostReadbacks:checked.filesCompared,
    elapsedMs:performance.now()-started,
    nativeU01Executed:false,nativeReceiptsAttested:false,
    modelInferenceExecuted:false,humanReview:'PENDING',
    employeeActionsExecuted:false,goalCompleted:false,
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const output=await runAgent05DocumentDelivery({
    directory:process.env.K04_COMPACT_DIRECTORY??null,
    deliveryMode:process.env.K04_DOCUMENT_MODE??'compact',
  });
  process.stdout.write(JSON.stringify(output)+'\n');
}
