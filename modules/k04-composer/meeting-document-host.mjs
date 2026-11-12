import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {performance} from 'node:perf_hooks';
import {digest,ComposerError} from './index.mjs';
import {renderMeetingDocuments,verifyMeetingProcess} from './meeting-process.mjs';

export const MEETING_OPEN_HOST_VERSION='IWXA.K04.MEETING_OPEN_HOST/0.1.0';
const fail=code=>{throw new ComposerError(code);};
const valid=name=>/^[a-z0-9-]+\.(?:md|csv)$/.test(name);

/** Real filesystem-backed open-host sample. The host chooses an isolated
 * directory and owns all file permissions. No custom Task Engine/Store.
 * Existing identical bytes are read back; different bytes never overwritten.
 */
export async function publishMeetingDocuments(process,{directory,failAfterWrites=null}={}){
  verifyMeetingProcess(process);
  if(typeof directory!=='string'||!directory.trim())fail('HOST_OUTPUT_DIRECTORY_REQUIRED');
  if(failAfterWrites!==null&&(!Number.isSafeInteger(failAfterWrites)||failAfterWrites<0))
    fail('INVALID_FAILURE_INJECTION');
  const root=resolve(directory);
  const pack=renderMeetingDocuments(process);
  const names=Object.keys(pack.documents);
  const start=performance.now();
  await mkdir(root,{recursive:true});
  let created=0,reused=0;
  const outputs=[];
  for(const [i,name] of names.entries()){
    if(!valid(name))fail('DOCUMENT_NAME_INVALID');
    if(failAfterWrites!==null&&created>=failAfterWrites)fail('SIMULATED_HOST_TOOL_FAILURE');
    const file=join(root,name);
    if(!file.startsWith(root+sep))fail('DOCUMENT_PATH_INVALID');
    const content=pack.documents[name];
    if(digest(content)!==pack.documentDigests[name])fail('DOCUMENT_DIGEST_MISMATCH');
    let status='REUSED';
    try{
      await writeFile(file,content,{encoding:'utf8',flag:'wx'});
      created++;status='CREATED';
    }catch(e){
      if(e?.code!=='EEXIST')throw e;
      reused++;
    }
    const stat=await lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())fail('DOCUMENT_READBACK_MISMATCH');
    const observed=await readFile(file,'utf8');
    if(observed!==content || digest(observed)!==pack.documentDigests[name])
      fail('DOCUMENT_READBACK_MISMATCH');
    outputs.push({name,path:file,status,
      contentDigest:digest(observed),bytes:Buffer.byteLength(observed,'utf8')});
  }
  const body={schema:MEETING_OPEN_HOST_VERSION,taskRef:process.taskRef,
    processDigest:process.processDigest,planDigest:process.hostPlan.planDigest,
    status:'DOCUMENTS_WRITTEN_AND_READ_BACK',files:outputs,
    documentsCreated:created,documentsReused:reused,
    humanReview:'PENDING',assignmentsExecuted:false,taskReport:'NOT_SUBMITTED',
    goalDecision:'NOT_DECIDED',outboundMessagesSent:0,
    elapsedMs:performance.now()-start};
  return {...body,executionReceiptDigest:digest(body)};
}
