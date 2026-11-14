// Narrow integration of the ORIGINAL T3 corporate signed Control owner with
// the Activity review UI. The original Kernel, signed grants, D1 and D2 remain
// entirely within the owner Host; this module neither issues nor stores rights.
import {inspectSelectedT3Activity, T3ActivityHold} from './t3-selected-host.mjs';
import {createTrustedT3ActivityStagePort} from './t3-owner-review-stage.mjs';

const need=(condition,code)=>{if(!condition)throw new T3ActivityHold(code);};
const callable=(value,keys)=>value && keys.every(key=>typeof value[key]==='function');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeStageError=error=>new T3ActivityHold(
  error instanceof T3ActivityHold && /^T3_[A-Z0-9_]{2,100}$/.test(error.code??'')
    ? error.code : 'T3_CONTROL_ACTIVITY_STAGE_REFUSED');

// Run in the existing trusted T3 Host, not in the Tauri/WebView renderer.
// `control` is either the original openMultiOrganizationControl owner, or
// the ORIGINAL T3 createControlLoopbackOwner (no parallel Control app).
// `context` is the original T2/T3 ModuleContext, and the optional factory
// belongs to the original native Control, not Activity.
export function bindT3ControlActivityReview({
  control, context, bindings, createSignedAccessHostPort,
  readActivityFromWorkspaceContext,derivation=null,
}={}) {
  const corporate=callable(control,['snapshot','signedActivityAccess','subscribeInvalidation']);
  const loopback=!corporate && control?.requireSignedOwner===true &&
    callable(control,['signedActivityAccess','subscribeSignedAccessInvalidation']);
  need((corporate||loopback) &&
    callable(context?.currentWorkspace,['get','subscribe']) &&
    (loopback||typeof createSignedAccessHostPort==='function') &&
    typeof readActivityFromWorkspaceContext==='function' && context?.kernel,
    'T3_CONTROL_ORIGINAL_HOST_REQUIRED');
  const signedSource=()=>loopback
    ? control.signedActivityAccess('activity.read')
    : control.signedActivityAccess(createSignedAccessHostPort);
  // The trusted Host may use its already-existing second selected Context,
  // or a signed target scoped by original D1 Access without a second Store.
  const signedTargetOnly=derivation!==null&&derivation.targetContext==null;
  if(derivation!==null){
    need(record(derivation)&&
      typeof derivation.createSubjectKernelBinding==='function'&&
      (signedTargetOnly
        ? typeof derivation.targetWorkspaceId==='string'&&
          derivation.targetWorkspaceId.trim()&&
          typeof derivation.resolveTargetSignedAccess==='function'
        : callable(derivation.targetContext?.currentWorkspace,['get','subscribe'])&&
          derivation.targetContext.kernel===context.kernel&&
          callable(derivation.targetSignedAccess,['currentContext','actionFor',
            'authorize','verifyDecisionBinding','operationDigest'])&&
          typeof derivation.subscribeOwnerInvalidation==='function'),
      'T3_CONTROL_DERIVATION_OWNER_REQUIRED');
  }
  // The stock T3 ModuleContext shares ONE CurrentWorkspaceStore across
  // modules. If the target resolves to the same selected Workspace, offering
  // a Save button would be a false promise even with a signed derive grant.
  // Only an actual independent owner-supplied scoped selection enables it.
  let distinctTargets=false;
  if(derivation!==null){
    try{
      const sourceId=context.currentWorkspace.get()?.workspace_id;
      const targetId=signedTargetOnly
        ? derivation.targetWorkspaceId
        : derivation.targetContext.currentWorkspace.get()?.workspace_id;
      distinctTargets=typeof sourceId==='string'&&typeof targetId==='string'&&
        sourceId.length>0&&targetId.length>0&&sourceId!==targetId;
    }catch{/* Missing independent owner selection never permits a save. */}
  }
  let generation=0,closed=false,stagePending=false;
  const listeners=new Set();
  const invalidate=()=>{
    generation++;
    for(const listener of [...listeners]) {
      try{listener();}catch{/* A UI subscriber cannot change T3 authority. */}
    }
  };
  let stopOwner=null,stopWorkspace=null,stopDeriveOwner=null,stopTarget=null;
  try {
    stopOwner=loopback
      ? control.subscribeSignedAccessInvalidation(invalidate)
      : control.subscribeInvalidation(invalidate);
    stopWorkspace=context.currentWorkspace.subscribe(invalidate);
    need(typeof stopOwner==='function' && typeof stopWorkspace==='function',
      'T3_CONTROL_OWNER_INVALIDATION_REQUIRED');
    if(derivation!==null&&!signedTargetOnly){
      stopDeriveOwner=derivation.subscribeOwnerInvalidation(invalidate);
      stopTarget=derivation.targetContext.currentWorkspace.subscribe(invalidate);
      need(typeof stopDeriveOwner==='function'&&typeof stopTarget==='function',
        'T3_CONTROL_DERIVATION_INVALIDATION_REQUIRED');
    }
    // Signed-target mode shares the SINGLE existing original Control stream
    // via stopOwner. Never attach a second SSE subscription or second Store.
  } catch {
    try{stopOwner?.();}catch{}
    try{stopWorkspace?.();}catch{}
    try{stopDeriveOwner?.();}catch{}
    try{stopTarget?.();}catch{}
    throw new T3ActivityHold('T3_CONTROL_OWNER_INVALIDATION_REQUIRED');
  }
  const snapshot=()=>{
    if(loopback)return null; // signed D1 port owns epoch and SSE generation
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
        signed=await signedSource();
        need(signed,'T3_CONTROL_ACTIVITY_READ_NOT_GRANTED');
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
      need((loopback||
        (after.contextEpoch===before.contextEpoch &&
         after.contextId===before.contextId)) &&
        context.currentWorkspace.get()===selected,
        'T3_CONTROL_CONTEXT_CHANGED_DURING_READ');
      return review;
    },
    ...(distinctTargets ? {
      async stageSelected() {
        need(!closed,'T3_CONTROL_HOST_DETACHED');
        need(!stagePending,'T3_CONTROL_ACTIVITY_STAGE_IN_PROGRESS');
        stagePending=true;
        const epoch=generation;
        const selected=context.currentWorkspace.get();
        const targetSelected=signedTargetOnly
          ? derivation.targetWorkspaceId
          : derivation.targetContext.currentWorkspace.get();
        let before=null,started=false;
        try{
          before=snapshot();
          const sourceSignedAccess=await signedSource();
          need(sourceSignedAccess&&!closed&&epoch===generation,
            'T3_CONTROL_ACTIVITY_READ_NOT_GRANTED');
          // The trusted owner retains source/target Kernel, signed grants,
          // context selection, event evidence and possible lost-ack IDs.
          const targetSignedAccess=signedTargetOnly
            ? await derivation.resolveTargetSignedAccess()
            : derivation.targetSignedAccess;
          need(targetSignedAccess&&!closed&&generation===epoch,
            'T3_CONTROL_DERIVATION_OWNER_REQUIRED');
          const ownerStage=createTrustedT3ActivityStagePort({
            sourceContext:context,sourceSignedAccess,
            targetContext:signedTargetOnly?null:derivation.targetContext,
            targetWorkspaceId:signedTargetOnly?targetSelected:null,
            targetSignedAccess,bindings,readActivityFromWorkspaceContext,
            createSubjectKernelBinding:derivation.createSubjectKernelBinding,
            targetKernel:signedTargetOnly?derivation.targetKernel??null:null,
          });
          started=true;
          const receipt=await ownerStage.stageSelected();
          const after=snapshot();
          need(!closed&&generation===epoch&&
            (loopback||
              (after.contextId===before.contextId&&
               after.contextEpoch===before.contextEpoch))&&
            context.currentWorkspace.get()===selected&&
            (signedTargetOnly||
              derivation.targetContext.currentWorkspace.get()===targetSelected),
            'T3_ACTIVITY_WRITE_MAY_HAVE_COMMITTED');
          return receipt; // {status,readback,export_allowed}, no identifiers.
        }catch(error){
          if(started&&(closed||generation!==epoch))
            throw new T3ActivityHold('T3_ACTIVITY_WRITE_MAY_HAVE_COMMITTED');
          throw safeStageError(error);
        }finally{stagePending=false;}
      },
    } : {}),
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
      stopDeriveOwner?.();stopTarget?.();
    },
  });
}
/** Product entry point in the EXISTING trusted T3 Host.
 * It shares one original Control invalidation stream, resolves the target
 * from the real signed derive owner, and binds a narrow renderer port.
 * The source uses the Host's ONE CurrentWorkspaceStore; the target has no
 * CurrentWorkspaceStore and is NEVER inferred from a UI workspace selector.
 * The trusted Host passes its ORIGINAL underlying T2 Kernel facade, not the
 * already subject-bound ModuleContext.kernel (which can deny the target).
 *
 * If the surrounding T3 Host already owns the Control SSE subscription,
 * it MUST supply subscribeExistingInvalidation. Do not attach twice.
 */
export async function openOriginalT3ActivityReviewHost({
  control,context,originalKernel,reviewerKernel=null,
  bindings,readActivityFromWorkspaceContext,
  createSubjectKernelBinding,subscribeExistingInvalidation=null,
}={}) {
  need(control?.requireSignedOwner===true &&
    callable(control,['signedActivityAccess','subscribeSignedAccessInvalidation']) &&
    callable(context?.currentWorkspace,['get','subscribe']) &&
    callable(originalKernel,['hasOperation','getWorkspace','listObjects',
      'getObject','listEventsSince']) &&
    originalKernel.sessionInfo?.contract_version==='1.3.0'&&
    originalKernel.sessionInfo?.runtime_version==='0.3.6'&&
    (reviewerKernel===null||(
      reviewerKernel!==originalKernel&&
      callable(reviewerKernel,['hasOperation','getWorkspace','listObjects',
        'getObject','putObject'])&&
      reviewerKernel.sessionInfo?.service_id==='iwxa.activity.reviewer'&&
      reviewerKernel.sessionInfo?.contract_version==='1.3.0'&&
      reviewerKernel.sessionInfo?.runtime_version==='0.3.6'&&
      reviewerKernel.hasOperation('t1.putObject')===true))&&
    typeof readActivityFromWorkspaceContext==='function'&&
    typeof createSubjectKernelBinding==='function'&&
    (subscribeExistingInvalidation===null||
      typeof subscribeExistingInvalidation==='function'),
    'T3_CONTROL_ORIGINAL_HOST_REQUIRED');
  let epoch=0,closed=false;
  const listeners=new Set();
  const notify=()=>{
    epoch++;
    for(const fn of [...listeners]){try{fn();}catch{}}
  };
  const subscribe=subscribeExistingInvalidation ??
    (fn=>control.subscribeSignedAccessInvalidation(fn));
  let stopControl=null,stopSelection=null,bridge=null;
  try{
    // Exactly one existing SSE source. No extra Controller, signed issuer or
    // callback that can create a grant on the authority side.
    stopControl=subscribe(notify);
    need(typeof stopControl==='function',
      'T3_CONTROL_OWNER_INVALIDATION_REQUIRED');
    stopSelection=context.currentWorkspace.subscribe(()=>{epoch++;});
    need(typeof stopSelection==='function',
      'T3_CONTROL_OWNER_INVALIDATION_REQUIRED');
    const initialEpoch=epoch,selected=context.currentWorkspace.get();
    need(typeof selected?.workspace_id==='string'&&selected.workspace_id,
      'T3_CONTROL_SELECTED_WORKSPACE_REQUIRED');
    const source=await control.signedActivityAccess('activity.read');
    need(callable(source,['currentContext','actionFor','authorize',
      'verifyDecisionBinding','operationDigest']),
      'T3_CONTROL_ACTIVITY_READ_NOT_GRANTED');
    const readOwner=await source.currentContext();
    need(record(readOwner)&&readOwner.workspace_id===selected.workspace_id,
      'T3_CONTROL_ACTIVITY_READ_NOT_GRANTED');
    // A derive grant without the original typed reviewer service is
    // never sufficient to enable a draft write.
    const target=reviewerKernel===null?null:
      await control.signedActivityAccess('activity.derive');
    let derivation=null;
    if(target!==null&&target!==undefined&&
      callable(target,['currentContext','actionFor','authorize',
        'verifyDecisionBinding','operationDigest'])){
      // Derive is optional. Its denial, expiry or unusable action must not
      // block independently authorized source reading. Never infer a grant.
      try{
      const signedTarget=await target.currentContext();
      const samePrincipal=record(signedTarget)&&
        ['PERSONAL','CORP'].includes(readOwner.kind)&&
        typeof readOwner.actor_id==='string'&&readOwner.actor_id.length>0&&
        typeof readOwner.principal_id==='string'&&readOwner.principal_id.length>0&&
        typeof readOwner.realm_id==='string'&&readOwner.realm_id.length>0&&
        ['kind','actor_id','principal_id','realm_id','organization_id'].every(
          key=>readOwner[key]===signedTarget[key]);
      const distinct=typeof signedTarget?.workspace_id==='string'&&
        signedTarget.workspace_id.length>0&&
        signedTarget.workspace_id!==readOwner.workspace_id;
      const action=await target.actionFor('t1.putObject');
      if(samePrincipal&&distinct&&
        signedTarget.purpose==='activity.derivation'&&
        action==='activity.derive'){
        const targetWorkspaceId=signedTarget.workspace_id;
        derivation=Object.freeze({
          targetWorkspaceId,targetKernel:reviewerKernel,
          createSubjectKernelBinding,
          // A fresh original Control signed selection is mandatory at
          // every material effect. The old grant is never reused.
          resolveTargetSignedAccess:()=>control.signedActivityAccess('activity.derive'),
        });
      }
      }catch{/* No usable independent derive right: remain READ-ONLY. */}
    }
    need(!closed&&epoch===initialEpoch&&
      context.currentWorkspace.get()===selected,
      'T3_CONTROL_CONTEXT_CHANGED_DURING_READ');
    // Internal relay is an invalidation FAN-OUT only. It never selects a
    // principal, issues Rights, creates a Kernel, opens a second SSE, or
    // reaches the Activity renderer.
    const shared=Object.freeze({
      requireSignedOwner:true,
      signedActivityAccess:operation=>control.signedActivityAccess(operation),
      subscribeSignedAccessInvalidation:listener=>{
        need(!closed&&typeof listener==='function',
          'T3_CONTROL_OWNER_INVALIDATION_REQUIRED');
        listeners.add(listener);
        return ()=>listeners.delete(listener);
      },
    });
    // Reuse the SAME original Kernel facade for both independently signed
    // scopes. A normal module context.kernel may already be source-bound.
    // The original backend is never sent to the renderer.
    const ownerContext=Object.freeze({
      kernel:originalKernel,currentWorkspace:context.currentWorkspace,
    });
    bridge=bindT3ControlActivityReview({
      control:shared,context:ownerContext,bindings,readActivityFromWorkspaceContext,
      derivation,
    });
    stopSelection();stopSelection=null;
    return Object.freeze({
      port:bridge.port,
      dispose(){
        if(closed)return;
        closed=true;
        bridge.dispose();
        stopControl();stopControl=null;
        listeners.clear();
      },
    });
  }catch(error){
    closed=true;
    try{bridge?.dispose();}catch{}
    try{stopSelection?.();}catch{}
    try{stopControl?.();}catch{}
    listeners.clear();
    throw safeStageError(error);
  }
}
