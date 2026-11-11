// Narrow integration of the ORIGINAL T3 corporate signed Control owner with
// the Activity review UI. The original Kernel, signed grants, D1 and D2 remain
// entirely within the owner Host; this module neither issues nor stores rights.
import {inspectSelectedT3Activity, T3ActivityHold} from './t3-selected-host.mjs';

const need=(condition,code)=>{if(!condition)throw new T3ActivityHold(code);};
const callable=(value,keys)=>value && keys.every(key=>typeof value[key]==='function');

// Run in the existing trusted T3 Host, not in the Tauri/WebView renderer.
// `control` is the original openMultiOrganizationControl owner; `context` is
// the original T2/T3 selected ModuleContext. `createSignedAccessHostPort`
// is the existing original T3 factory, not a new authority or issuer.
export function bindT3ControlActivityReview({
  control, context, bindings, createSignedAccessHostPort,
  readActivityFromWorkspaceContext,
}={}) {
  need(callable(control,['snapshot','signedActivityAccess','subscribeInvalidation']) &&
    callable(context?.currentWorkspace,['get','subscribe']) &&
    typeof createSignedAccessHostPort==='function' &&
    typeof readActivityFromWorkspaceContext==='function' && context?.kernel,
    'T3_CONTROL_ORIGINAL_HOST_REQUIRED');
  let generation=0,closed=false;
  const listeners=new Set();
  const invalidate=()=>{
    generation++;
    for(const listener of [...listeners]) {
      try{listener();}catch{/* A UI subscriber cannot change T3 authority. */}
    }
  };
  let stopOwner=null,stopWorkspace=null;
  try {
    stopOwner=control.subscribeInvalidation(invalidate);
    stopWorkspace=context.currentWorkspace.subscribe(invalidate);
    need(typeof stopOwner==='function' && typeof stopWorkspace==='function',
      'T3_CONTROL_OWNER_INVALIDATION_REQUIRED');
  } catch {
    try{stopOwner?.();}catch{}
    try{stopWorkspace?.();}catch{}
    throw new T3ActivityHold('T3_CONTROL_OWNER_INVALIDATION_REQUIRED');
  }
  const snapshot=()=>{
    let state;
    try{state=control.snapshot();}catch{}
    need(state?.context==='ORGANIZATION' &&
      typeof state.contextId==='string' && state.contextId!=='PERSONAL' &&
      Number.isSafeInteger(state.contextEpoch) && state.contextEpoch>=0,
      'T3_CONTROL_SELECTED_ORGANIZATION_REQUIRED');
    return state;
  };
  const port=Object.freeze({
    async readSelected() {
      need(!closed,'T3_CONTROL_HOST_DETACHED');
      const epoch=generation;
      const selected=context.currentWorkspace.get();
      need(typeof selected?.workspace_id==='string' && selected.workspace_id.length>0,
        'T3_CONTROL_SELECTED_WORKSPACE_REQUIRED');
      const before=snapshot();
      let signed;
      try {
        // Fresh signed DATA Activity Read for *this* selected subject.
        signed=control.signedActivityAccess(createSignedAccessHostPort);
      } catch {
        throw new T3ActivityHold('T3_CONTROL_ACTIVITY_READ_NOT_GRANTED');
      }
      // The original D1 reader checks every Kernel read again. Never pass the
      // Control owner, raw context or signed data through the renderer port.
      const review=await inspectSelectedT3Activity({
        context,signedAccess:signed,bindings,readActivityFromWorkspaceContext,
      });
      need(!closed && generation===epoch,
        'T3_CONTROL_CONTEXT_CHANGED_DURING_READ');
      const after=snapshot();
      need(after.contextEpoch===before.contextEpoch &&
        after.contextId===before.contextId &&
        context.currentWorkspace.get()===selected,
        'T3_CONTROL_CONTEXT_CHANGED_DURING_READ');
      return review;
    },
    subscribeInvalidation(listener){
      need(!closed && typeof listener==='function',
        'T3_CONTROL_OWNER_INVALIDATION_REQUIRED');
      listeners.add(listener);
      return ()=>listeners.delete(listener);
    },
  });
  return Object.freeze({
    port,
    dispose(){
      if(closed)return;
      closed=true;invalidate();listeners.clear();
      stopOwner();stopWorkspace();
    },
  });
}