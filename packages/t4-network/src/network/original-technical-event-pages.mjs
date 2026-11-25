const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const keys=(value,expected)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k));
const fail=code=>{throw Object.assign(Error(code),{code});};

// Visit only the original technical Workspace's explicitly authorized commit
// pages. The native owner holds its original execution slot; this function
// supplies no lock, access grant, independent Store or snapshot claim.
// A caller may retain selected witnesses without allocating all Event bodies.
export async function visitT4OriginalTechnicalCommitEvents({workspaceId,objectRef=null,
  readOriginalTechnicalCommitPage,authorizeOriginalPage,visitOriginalEvent,pageSize=256}={}){
  if(!ID(workspaceId)||(objectRef!==null&&!ID(objectRef))||![readOriginalTechnicalCommitPage,authorizeOriginalPage,visitOriginalEvent]
    .every(f=>typeof f==='function')||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1024)
    fail('TECHNICAL_COMMIT_HISTORY_PORTS_REQUIRED');
  const seen=new Set();let after=null,modern=false,count=0;
  const authorize=async()=>{
    if(await authorizeOriginalPage()!==true)fail('TECHNICAL_COMMIT_HISTORY_READ_DENIED');
  };
  for(;;){
    await authorize();
    const page=structuredClone(await readOriginalTechnicalCommitPage(Object.freeze({
      workspaceId,afterEventId:after,limit:pageSize,...(objectRef===null?{}:{objectRef}),
    })));
    await authorize();
    if(!keys(page,['entries','next_after_event_id','has_more','order','legacy_history_causal_proven'])||
      !Array.isArray(page.entries)||page.entries.length>pageSize||typeof page.has_more!=='boolean'||
      page.order!=='LOCAL_TRANSACTION_COMMIT_ORDER'||page.legacy_history_causal_proven!==false||
      (page.has_more&&page.entries.length!==pageSize)||(after!==null&&!page.entries.length))
      fail('TECHNICAL_COMMIT_HISTORY_PAGE_INVALID');
    for(const entry of page.entries){
      if(!keys(entry,['event','legacy_history'])||typeof entry.legacy_history!=='boolean'||
        (modern&&entry.legacy_history)||entry.event?.workspace_id!==workspaceId||!ID(entry.event?.event_id)||
        (objectRef!==null&&entry.event.object_id!==objectRef)||seen.has(entry.event.event_id))fail('TECHNICAL_COMMIT_HISTORY_PAGE_INVALID');
      if(!entry.legacy_history)modern=true;
      seen.add(entry.event.event_id);
    }
    const last=page.entries.at(-1)?.event.event_id??after;
    if(page.next_after_event_id!==last||!Number.isSafeInteger(count+page.entries.length))
      fail('TECHNICAL_COMMIT_HISTORY_PAGE_INVALID');
    for(const entry of page.entries)visitOriginalEvent(entry.event);
    count+=page.entries.length;
    if(!page.has_more)return count;
    after=last;
  }
}

// Exact reads use the original indexed operation, with no Workspace-history
// fallback. Both grants are required by the caller and checked for each page.
export function requireT4OriginalTechnicalObjectHistory(enabled,originalKernel){
  if(typeof enabled!=='boolean'||(enabled&&
    !['listEventsSince','listEventObjectCommitWindow'].every(name=>
      originalKernel?.hasOperation?.('t1.'+name)===true&&typeof originalKernel[name]==='function')))
    fail('TECHNICAL_OBJECT_HISTORY_PORTS_REQUIRED');
}
export async function readT4OriginalTechnicalObjectEvents({originalKernel,workspaceId,objectRef,
  authorizeOriginalOperation,pageSize=256}={}){
  requireT4OriginalTechnicalObjectHistory(true,originalKernel);
  if(!ID(objectRef)||typeof authorizeOriginalOperation!=='function')fail('TECHNICAL_OBJECT_HISTORY_PORTS_REQUIRED');
  const selected=[];
  await visitT4OriginalTechnicalCommitEvents({workspaceId,objectRef,pageSize,
    authorizeOriginalPage:async()=>{
      for(const op of ['t1.listEventsSince','t1.listEventObjectCommitWindow']){
        if(originalKernel.hasOperation(op)!==true||await authorizeOriginalOperation(op)!==true)return false;
      }
      return true;
    },
    readOriginalTechnicalCommitPage:proof=>originalKernel.listEventObjectCommitWindow(
      proof.workspaceId,proof.objectRef,proof.afterEventId,proof.limit),
    visitOriginalEvent:e=>selected.push(e),
  });
  return selected;
}

// Select original subject Events during a complete commit-order traversal.
// The supplied original Host boundary is mandatory: separate read transactions
// are not a snapshot. Only selected Event bodies survive the traversal, but
// every identity (including unrelated Events) is checked for duplication.
export async function readT4OriginalSelectedCommitEvents({workspaceId,originalWriteOwnerRef,
  readOriginalCommitPage,withOriginalHistoryReadBoundary,authorizeOriginalOperation,
  selectOriginalEvent,pageSize=256}={}){
  if(![workspaceId,originalWriteOwnerRef].every(ID)||
    ![readOriginalCommitPage,withOriginalHistoryReadBoundary,authorizeOriginalOperation,selectOriginalEvent]
      .every(f=>typeof f==='function')||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1024)
    fail('ORIGINAL_SELECTED_COMMIT_HISTORY_PORTS_REQUIRED');
  const proof=Object.freeze({operation:'t1.listEventsSince',workspaceId,originalWriteOwnerRef,
    networkReadGrantsCreated:false,originalCommitOrderReadRequired:true,originalHistoryExclusionRequired:true});
  const requireRead=async()=>{
    for(const operation of ['t1.listEventsSince','t1.listEventCommitWindow']){
      if(await authorizeOriginalOperation(operation)!==true)fail('ORIGINAL_SELECTED_COMMIT_HISTORY_READ_DENIED');
    }
  };
  await requireRead();
  let active=true,calls=0,completed;
  const check=()=>{if(!active||calls!==1)fail('ORIGINAL_SELECTED_COMMIT_HISTORY_BOUNDARY_INVALID');};
  const read=async()=>{
    if(!active||++calls!==1)fail('ORIGINAL_SELECTED_COMMIT_HISTORY_BOUNDARY_INVALID');
    const selected=[];
    await visitT4OriginalTechnicalCommitEvents({workspaceId,pageSize,
      authorizeOriginalPage:async()=>{check();await requireRead();check();return true;},
      readOriginalTechnicalCommitPage:async page=>{
        check();const value=await readOriginalCommitPage(Object.freeze({...proof,afterEventId:page.afterEventId,
          limit:page.limit,commitOperation:'t1.listEventCommitWindow'}));check();return value;
      },visitOriginalEvent:event=>{
        check();const keep=selectOriginalEvent(event);
        if(typeof keep!=='boolean')fail('ORIGINAL_SELECTED_COMMIT_HISTORY_SELECTION_INVALID');
        if(keep)selected.push(event);
      }});
    check();await requireRead();check();
    completed=Object.freeze(selected);return completed;
  };
  try{
    const result=await withOriginalHistoryReadBoundary(proof,read);
    if(calls!==1||completed===undefined||result!==completed)fail('ORIGINAL_SELECTED_COMMIT_HISTORY_BOUNDARY_INVALID');
    active=false;await requireRead();return result;
  }finally{active=false;}
}
