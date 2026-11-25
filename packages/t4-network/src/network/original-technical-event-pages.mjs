const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const keys=(value,expected)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k));
const fail=code=>{throw Object.assign(Error(code),{code});};

// Visit only the original technical Workspace's explicitly authorized commit
// pages. The native owner holds its original execution slot; this function
// supplies no lock, access grant, independent Store or snapshot claim.
// A caller may retain selected witnesses without allocating all Event bodies.
export async function visitT4OriginalTechnicalCommitEvents({workspaceId,
  readOriginalTechnicalCommitPage,authorizeOriginalPage,visitOriginalEvent,pageSize=256}={}){
  if(!ID(workspaceId)||![readOriginalTechnicalCommitPage,authorizeOriginalPage,visitOriginalEvent]
    .every(f=>typeof f==='function')||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>1024)
    fail('TECHNICAL_COMMIT_HISTORY_PORTS_REQUIRED');
  const seen=new Set();let after=null,modern=false,count=0;
  const authorize=async()=>{
    if(await authorizeOriginalPage()!==true)fail('TECHNICAL_COMMIT_HISTORY_READ_DENIED');
  };
  for(;;){
    await authorize();
    const page=structuredClone(await readOriginalTechnicalCommitPage(Object.freeze({
      workspaceId,afterEventId:after,limit:pageSize,
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
        seen.has(entry.event.event_id))fail('TECHNICAL_COMMIT_HISTORY_PAGE_INVALID');
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
