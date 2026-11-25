import {AsyncLocalStorage} from 'node:async_hooks';

const fail=code=>{throw Object.assign(Error(code),{code,details:Object.freeze({automaticRetryAllowed:false})});};
const ID=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);

// Reuse only the lexically held original workspace-wide mutation boundary.
// This carries a short-lived execution witness, not a lock, permission,
// transaction, queue or independent Host. Independent reads still enter the
// existing owner's history boundary. A detached async continuation cannot
// use a witness whose callback or Host lifetime has already ended.
export function bindT4OriginalHistoryBoundary({workspaceId,originalWriteOwnerRef,getMode,
  withOriginalSubjectMutation,withOriginalHistoryReadBoundary}={}){
  if(![workspaceId,originalWriteOwnerRef].every(ID)||
    ![getMode,withOriginalSubjectMutation,withOriginalHistoryReadBoundary].every(f=>typeof f==='function'))
    fail('ORIGINAL_HISTORY_BOUNDARY_PORTS_REQUIRED');
  const execution=new AsyncLocalStorage();
  const live=()=>{if(getMode()!=='T4_NETWORK')fail('ORIGINAL_HISTORY_BOUNDARY_MODE_OFF');};
  const scope=proof=>{
    live();
    if(proof?.workspaceId!==workspaceId||proof.originalWriteOwnerRef!==originalWriteOwnerRef)
      fail('ORIGINAL_HISTORY_BOUNDARY_SCOPE_INVALID');
  };
  const requireHeld=lease=>{
    live();
    if(!lease?.active||(lease.parent&&!lease.parent.active))fail('ORIGINAL_HISTORY_BOUNDARY_EXPIRED');
  };
  async function within(kind,proof,action,port,parent=null){
    scope(proof);
    if(typeof action!=='function')fail('ORIGINAL_HISTORY_BOUNDARY_ACTION_INVALID');
    const lease={kind,parent,active:false},exact=Object.freeze(structuredClone(proof));
    let calls=0,closed=false,completed=false,receipt;
    const invoke=async()=>{
      if(++calls!==1||closed)fail('ORIGINAL_HISTORY_BOUNDARY_REENTERED');
      live();if(parent)requireHeld(parent);
      lease.active=true;
      try{
        receipt=await execution.run(lease,action);
        requireHeld(lease);
        if(closed)fail('ORIGINAL_HISTORY_BOUNDARY_EXPIRED');
        completed=true;return receipt;
      }finally{lease.active=false;}
    };
    try{
      const result=port===null?await invoke():await port(exact,invoke);
      live();
      if(calls!==1||!completed||result!==receipt)fail('ORIGINAL_HISTORY_BOUNDARY_NOT_PROVEN');
      return receipt;
    }finally{closed=true;lease.active=false;}
  }
  return Object.freeze({
    withOriginalSubjectMutation:async(proof,action)=>{
      scope(proof);
      if(proof.originalHostMustSerializeAllWorkspaceGraphMutations!==true||
        proof.originalHostMustSerializeSubjectMutations!==true)
        fail('ORIGINAL_HISTORY_BOUNDARY_MUTATION_EXCLUSION_REQUIRED');
      const held=execution.getStore();
      if(held){requireHeld(held);fail('ORIGINAL_HISTORY_BOUNDARY_REENTERED');}
      return within('MUTATION',proof,action,withOriginalSubjectMutation);
    },
    withOriginalHistoryReadBoundary:async(proof,action)=>{
      scope(proof);
      if(proof.operation!=='t1.listEventsSince'||proof.originalCommitOrderReadRequired!==true||
        proof.originalHistoryExclusionRequired!==true)
        fail('ORIGINAL_HISTORY_BOUNDARY_READ_EXCLUSION_REQUIRED');
      const held=execution.getStore();
      if(held){
        requireHeld(held);
        if(held.kind!=='MUTATION')fail('ORIGINAL_HISTORY_BOUNDARY_REENTERED');
        return within('READ',proof,action,null,held);
      }
      return within('READ',proof,action,withOriginalHistoryReadBoundary);
    },
    assertOriginalHistoryReadScope:proof=>{
      scope(proof);
      if(proof.commitOperation!=='t1.listEventCommitWindow'||proof.originalCommitOrderReadRequired!==true)
        fail('ORIGINAL_HISTORY_BOUNDARY_READ_EXCLUSION_REQUIRED');
      const held=execution.getStore();
      requireHeld(held);
      if(held.kind!=='READ')fail('ORIGINAL_HISTORY_BOUNDARY_READ_EXCLUSION_REQUIRED');
    },
  });
}
