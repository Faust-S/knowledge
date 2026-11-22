import {
  publishT4OriginalHostOutbox,inspectT4OriginalHostOutboxNetwork,
} from './original-host-outbox-delivery.mjs';

export class T4OriginalHostOutboxDispatcherError extends Error {
  constructor(code,details={}) {
    super(code);this.name='T4OriginalHostOutboxDispatcherError';
    this.code=code;this.details=Object.freeze({...details});
  }
}
const fail=(code,details)=>{throw new T4OriginalHostOutboxDispatcherError(code,details);};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const SHA=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const HASH=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/.test(x);
const CURSOR='IWXA_T4_ORIGINAL_EVENT_CURSOR_V1';
const ATTEMPT='IWXA_T4_ORIGINAL_HOST_NETWORK_ATTEMPT_V1';
const CHECKPOINT='IWXA_T4_ORIGINAL_HOST_NETWORK_CHECKPOINT_V1';
const validCursor=(c,ws,owner)=>c?.schema===CURSOR&&
  c.workspaceId===ws&&c.originalWriteOwnerRef===owner&&
  ID(c.lastEventId)&&HASH(c.sourcePrefixDigest)&&
  Number.isSafeInteger(c.seenEventCount)&&c.seenEventCount>=1;
const canonical=x=>Array.isArray(x)?x.map(canonical):
  x&&typeof x==='object'?Object.fromEntries(
    Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const matchingCursor=(a,b)=>same(a,b);
const entryKind=e=>e?.schema==='IWXA_T4_ORIGINAL_OBJECT_DELTA_OUTBOX_V1'
  ?'OBJECT_PUT':e?.schema==='IWXA_T4_ORIGINAL_SUBJECT_DELTA_OUTBOX_V1'
    ?e.kind:null;
const subjectId=e=>entryKind(e)==='OBJECT_PUT'?e.objectId:e.subjectId;
function validateEntries(rows,workspaceId,originalWriteOwnerRef,frontier) {
  if(!Array.isArray(rows)||rows.length>4096)
    fail('DISPATCH_ORIGINAL_OUTBOX_LIST_INVALID');
  const entries=rows.map(row=>{
    const kind=entryKind(row),id=subjectId(row);
    if(!['OBJECT_PUT','ASSET_PUT','RELATION_PUT'].includes(kind)||
      ![row?.captureRef,id,row?.sourceEventId].every(ID)||
      row.workspaceId!==workspaceId||
      row.originalWriteOwnerRef!==originalWriteOwnerRef||
      !SHA(row.sha256)||row.key!==row.sha256+'.t4d'||
      row.networkPublished!==false||row.recipientApplied!==false||
      row.originalT3MutationConfirmed!==true||
      !validCursor(row.sourceCursorBefore,workspaceId,originalWriteOwnerRef)||
      !validCursor(row.sourceCursorAfter,workspaceId,originalWriteOwnerRef)||
      row.sourceCursorAfter.seenEventCount!==row.sourceCursorBefore.seenEventCount+1||
      row.sourceCursorAfter.lastEventId!==row.sourceEventId)
      fail('DISPATCH_ORIGINAL_OUTBOX_ENTRY_INVALID');
    return Object.freeze({outbox:row,kind,captureRef:row.captureRef,
      subjectId:id,sourceEventId:row.sourceEventId,
      before:row.sourceCursorBefore,after:row.sourceCursorAfter});
  }).sort((a,b)=>a.before.seenEventCount-b.before.seenEventCount);
  if(entries.length&&!matchingCursor(entries[0].before,frontier))
    fail('DISPATCH_ORIGINAL_FRONTIER_GAP',{
      firstCaptureRef:entries[0].captureRef,networkWritesStarted:false,
    });
  const captures=new Set(),events=new Set(),positions=new Set();
  for(const [index,item] of entries.entries()){
    const pos=item.before.seenEventCount;
    if(captures.has(item.captureRef)||events.has(item.sourceEventId)||
      positions.has(pos))fail('DISPATCH_DUPLICATE_ORIGINAL_EVENT');
    captures.add(item.captureRef);events.add(item.sourceEventId);
    positions.add(pos);
    if(index>0&&!matchingCursor(entries[index-1].after,item.before))
      fail('DISPATCH_ORIGINAL_EVENT_CHAIN_GAP',{
        previousCaptureRef:entries[index-1].captureRef,
        nextCaptureRef:item.captureRef,networkWritesStarted:false,
      });
  }
  return entries;
}
function scope(item,params) {
  return Object.freeze({
    kind:item.kind,captureRef:item.captureRef,
    subjectId:item.subjectId,workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
  });
}
function witness(item,params,schema){
  return Object.freeze({
    schema,networkTargetRef:params.networkTargetRef,
    ...scope(item,params),key:item.outbox.key,sha256:item.outbox.sha256,
    sourceEventId:item.sourceEventId,
    sourceCursorBefore:item.before,sourceCursorAfter:item.after,
    sourceT3Original:true,recipientApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
  });
}
function assertWitness(record,expected){
  if(!record||!same(record,expected))
    fail('DISPATCH_ORIGINAL_DELIVERY_RECORD_MISMATCH',{
      captureRef:expected.captureRef,networkTargetRef:expected.networkTargetRef,
    });
}
function rights(params,operation,purpose,item=null){
  return Object.freeze({operation,purpose,
    workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    networkTargetRef:params.networkTargetRef,
    captureRef:item?.captureRef??null,
    originalT3AuthorityRequired:true,
    networkIsNotOriginalWriteAuthority:true,
  });
}
function mode(params){
  if(params.getMode()!=='T4_NETWORK')fail('DISPATCH_NETWORK_MODE_OFF');
}
async function allowed(params,step,item=null){
  mode(params);
  if(await params.authorizeOriginalRead(
    rights(params,'t1.getObject',step,item))!==true||
    await params.authorizeOriginalWrite(
      rights(params,'t1.putObject',step,item))!==true||
    await params.authorizeNetworkPublish(
      rights(params,'t4.network.publish',step,item))!==true)
    fail('DISPATCH_ORIGINAL_OR_NETWORK_AUTHORITY_DENIED');
  mode(params);
}
async function readChecked(params,port,item,step){
  await allowed(params,step,item);
  const found=await params[port](Object.freeze({
    ...scope(item,params),networkTargetRef:params.networkTargetRef,
  }));
  mode(params);
  return found;
}
async function persistAndVerify(params,writePort,readPort,expected,item,step){
  await allowed(params,step,item);
  const created=await params[writePort](expected);
  if(created!==true&&created!==false)
    fail('DISPATCH_ORIGINAL_RECORD_WRITE_UNCERTAIN',{captureRef:item.captureRef,
      step,automaticRetryAllowed:false});
  const stored=await readChecked(params,readPort,item,step+'-readback');
  assertWitness(stored,expected);
  return created;
}
function publicationParams(params,item){
  return {...params,...scope(item,params)};
}
async function inspect(params,item){
  try{
    const result=await inspectT4OriginalHostOutboxNetwork(
      publicationParams(params,item));
    if(result?.expectedBytesOnRemoteVerified!==true||
      result?.key!==item.outbox.key||result?.sha256!==item.outbox.sha256||
      result?.originalRecipientApplied!==false)
      fail('DISPATCH_REMOTE_OBSERVATION_INVALID');
    return 'PRESENT';
  }catch(error){
    if(error?.code==='OUTBOX_REMOTE_OUTCOME_STILL_UNKNOWN'&&
      error.details?.originalCode==='REMOTE_NOT_FOUND')
      return 'ABSENT';
    if(error instanceof T4OriginalHostOutboxDispatcherError)throw error;
    fail('DISPATCH_REMOTE_INSPECTION_FAILED',{
      captureRef:item.captureRef,originalCode:error?.code??null,
      automaticRetryAllowed:false,
    });
  }
}
async function execute(params,maxEntries){
  if(!ID(params.workspaceId)||!ID(params.originalWriteOwnerRef)||
    !ID(params.networkTargetRef)||
    !Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>64||
    typeof params.transport?.putSnapshot!=='function'||
    typeof params.transport?.inspectOutcome!=='function'||
    ['getMode','authorizeOriginalRead','authorizeOriginalWrite',
      'authorizeNetworkPublish','listOriginalOutbox',
      'readOriginalIntent','readOriginalOutbox','readOriginalEvents',
      'readOriginalDeliveryAttempt','persistOriginalDeliveryAttempt',
      'readOriginalDeliveryCheckpoint','persistOriginalDeliveryCheckpoint',
      'readOriginalDeliveryFrontier']
      .some(port=>typeof params[port]!=='function'))
    fail('DISPATCH_ORIGINAL_HOST_PORTS_REQUIRED');
  await allowed(params,'outbox-list');
  const rows=await params.listOriginalOutbox(Object.freeze({
    workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    networkTargetRef:params.networkTargetRef,
    kindFilter:Object.freeze(['OBJECT_PUT','ASSET_PUT','RELATION_PUT']),
  }));
  mode(params);
  await allowed(params,'frontier-read');
  const frontier=await params.readOriginalDeliveryFrontier(Object.freeze({
    workspaceId:params.workspaceId,originalWriteOwnerRef:params.originalWriteOwnerRef,
    networkTargetRef:params.networkTargetRef,
    originalHostCursorRequired:true,
  }));
  if(!validCursor(frontier,params.workspaceId,params.originalWriteOwnerRef))
    fail('DISPATCH_ORIGINAL_FRONTIER_INVALID');
  mode(params);
  const entries=validateEntries(rows,params.workspaceId,
    params.originalWriteOwnerRef,frontier);
  let verified=0,previouslyVerified=0,examined=0;
  const results=[];
  for(const item of entries){
    if(examined>=maxEntries)break;
    examined++;
    await allowed(params,'outbox-dispatch',item);
    const desiredCheckpoint=witness(item,params,CHECKPOINT);
    const checkpoint=await readChecked(params,
      'readOriginalDeliveryCheckpoint',item,'checkpoint-read');
    if(checkpoint!==null&&checkpoint!==undefined){
      assertWitness(checkpoint,desiredCheckpoint);
      previouslyVerified++;
      results.push(Object.freeze({captureRef:item.captureRef,
        state:'PREVIOUSLY_VERIFIED',key:item.outbox.key}));
      continue;
    }
    const desiredAttempt=witness(item,params,ATTEMPT);
    const attempt=await readChecked(params,'readOriginalDeliveryAttempt',
      item,'attempt-read');
    if(attempt!==null&&attempt!==undefined)
      assertWitness(attempt,desiredAttempt);
    // Always inspect first. A timeout, a crashed process, or a failed
    // original checkpoint is never authority for a second network PUT.
    const observed=await inspect(params,item);
    if(observed==='ABSENT'){
      if(attempt!==null&&attempt!==undefined)
        fail('DISPATCH_PRIOR_NETWORK_ATTEMPT_UNRESOLVED',{
          captureRef:item.captureRef,networkTargetRef:params.networkTargetRef,
          remoteWriteMayExist:true,automaticRetryAllowed:false,
          alreadyVerifiedCount:previouslyVerified+verified,
        });
      const created=await persistAndVerify(params,
        'persistOriginalDeliveryAttempt','readOriginalDeliveryAttempt',
        desiredAttempt,item,'attempt-persist');
      if(created!==true)
        fail('DISPATCH_CONCURRENT_NETWORK_ATTEMPT',{
          captureRef:item.captureRef,automaticRetryAllowed:false,
        });
      await allowed(params,'network-put-after-original-attempt',item);
      let published;
      try{
        published=await publishT4OriginalHostOutbox(
          publicationParams(params,item));
      }catch(error){
        fail('DISPATCH_REMOTE_OUTCOME_UNKNOWN',{
          captureRef:item.captureRef,originalCode:error?.code??null,
          originalAttemptStored:true,automaticRetryAllowed:false,
          originalRecipientApplied:false,
        });
      }
      if(published?.networkPublishedAndReadBack!==true||
        published?.key!==item.outbox.key||
        published?.sha256!==item.outbox.sha256||
        published?.originalRecipientApplied!==false)
        fail('DISPATCH_NETWORK_PUBLICATION_NOT_VERIFIED',{
          captureRef:item.captureRef,automaticRetryAllowed:false,
        });
    }
    await persistAndVerify(params,
      'persistOriginalDeliveryCheckpoint','readOriginalDeliveryCheckpoint',
      desiredCheckpoint,item,'checkpoint-persist');
    verified++;
    results.push(Object.freeze({captureRef:item.captureRef,
      state:observed==='PRESENT'?'REMOTE_READBACK_RECOVERED':
        'PUBLISHED_AND_READ_BACK',key:item.outbox.key}));
  }
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCH_RESULT_V1',
    networkTargetRef:params.networkTargetRef,
    workspaceId:params.workspaceId,
    originalWriteOwnerRef:params.originalWriteOwnerRef,
    totalListed:entries.length,examinedCount:examined,
    newlyVerifiedCount:verified,previouslyVerifiedCount:previouslyVerified,
    hasMore:examined<entries.length,
    results:Object.freeze(results),
    sourceT3OutboxUnchanged:true,
    originalRecipientApplied:false,
    sourceCursorAdvanced:false,recipientCursorAdvanced:false,
    fullContinuousHostSchedulingInstalled:false,
  });
}

/**
 * The existing T3 Host/Task scheduler invokes drain(). All durable records
 * (outbox, attempt and checkpoint) are T3 technical Workspace ports, NOT a
 * second Store, queue, Kernel, router, or business acknowledgement.
 */
export function createT4OriginalHostOutboxDispatcher(params={}){
  let active=null;
  return Object.freeze({
    schema:'IWXA_T4_ORIGINAL_HOST_OUTBOX_DISPATCHER_V1',
    usesOriginalT3HostAndStore:true,
    async drain({maxEntries=64}={}){
      if(active)return active;
      const work=execute(params,maxEntries);
      active=work;
      try{return await work;}
      finally{if(active===work)active=null;}
    },
  });
}
