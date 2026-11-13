// A selected-owner Activity REVIEW is persisted only in a separate,
// empty Workspace owned by the SAME principal. The ORIGINAL T3 subject
// binding authorizes each Kernel read/write. No new Store/IAM or .iwxa writer.
// This is NOT anonymization, disclosure authority, or recipient acceptance.
import {inspectSelectedT3Activity, T3ActivityHold,
  T3_SELECTED_VIEW_SCHEMA} from './t3-selected-host.mjs';

const frozen=value=>{
  if(value!==null&&typeof value==='object'){
    for(const child of Object.values(value))frozen(child);
    Object.freeze(value);
  }
  return value;
};
export const T3_ACTIVITY_OWNER_REVIEW_SCHEMA = 'iwxa.activity.process-review';
export const T3_ACTIVITY_OWNER_REVIEW_DECLARATION = frozen({
  schema_id:T3_ACTIVITY_OWNER_REVIEW_SCHEMA,
  schema_version:'1.0.0', preserve_unknown:false,
  json_schema:{
    type:'object',
    properties:{
      status:{const:'OWNER_REVIEW_DRAFT'},
      source_review_schema:{const:T3_SELECTED_VIEW_SCHEMA},
      source_status:{enum:['HOLD','STRUCTURE_PRESERVED_REVIEW_REQUIRED']},
      semantic_mapping:{const:'T0_T1_D2_ONLY_NOT_OCEL2_CONFORMANCE'},
      reason_codes:{type:'array',maxItems:16,items:{type:'string',maxLength:128}},
      anonymity:{const:'NOT_ESTABLISHED'},
      disclosure_status:{const:'NOT_EVALUATED'},
      export_allowed:{const:false},
      candidate:{
        type:['array','null'], maxItems:2000,
        items:{type:'object',additionalProperties:false,
          required:['object_type','cohort_band','observed_event_kinds','object_local_successions'],
          properties:{
            object_type:{type:'string',pattern:'^object_type_[0-9]{3,5}$'},
            cohort_band:{enum:['3-9','10-49','50+']},
            observed_event_kinds:{type:'array',maxItems:10000,
              items:{type:'string',pattern:'^event_type_[0-9]{3,5}$'}},
            object_local_successions:{type:'array',maxItems:10000,
              items:{type:'object',additionalProperties:false,
                required:['from','to','cohort_band','relation'],
                properties:{
                  from:{type:'string',pattern:'^event_type_[0-9]{3,5}$'},
                  to:{type:'string',pattern:'^event_type_[0-9]{3,5}$'},
                  cohort_band:{enum:['3-9','10-49','50+']},
                  relation:{const:'OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY'},
                }}},
          }},
      },
    },
    required:['status','source_review_schema','source_status','semantic_mapping',
      'reason_codes','anonymity','disclosure_status','export_allowed','candidate'],
    additionalProperties:false,
  },
  embedded:{},
});


/** Register with the ORIGINAL T2 service registry at trusted Host boot.
 * This is a normal T2 service passport, not an Activity-owned Kernel.
 * A derivation service can read and write only its own review objects;
 * package export/import is explicitly unavailable from this service.
 * Source Workspace reads use the separately signed existing Host owner.
 */
export const T3_ACTIVITY_OWNER_REVIEW_PASSPORT = frozen({
  service_id:'iwxa.activity.reviewer',
  service_version:'1.0.0',
  base_path:'/workspace/activity/',
  supported_levels:['T1','T2'],
  input_object_types:[],
  output_object_types:[T3_ACTIVITY_OWNER_REVIEW_SCHEMA],
  schemas:{[T3_ACTIVITY_OWNER_REVIEW_SCHEMA]:T3_ACTIVITY_OWNER_REVIEW_DECLARATION},
  permissions:{
    workspace:{list:false,read:true,create:false,soft_delete:false,
      restore:false,purge:false},
    objects:{read:[T3_ACTIVITY_OWNER_REVIEW_SCHEMA],
      write:[T3_ACTIVITY_OWNER_REVIEW_SCHEMA],delete:[]},
    events:{read_scope:'service'},
    packages:{export:false,import:false,
      export_scope:'readable_objects',import_scope:'writable_objects'},
  },
});

const good=(x)=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const need=(ok,code)=>{if(!ok)throw new T3ActivityHold(code);};
function selected(context){
  need(good(context)&&good(context.kernel)&&
    typeof context.currentWorkspace?.get==='function'&&
    typeof context.currentWorkspace?.subscribe==='function',
    'T3_ACTIVITY_ORIGINAL_HOST_REQUIRED');
  const choice=context.currentWorkspace.get();
  need(typeof choice?.workspace_id==='string'&&choice.workspace_id.trim(),
    'T3_ACTIVITY_WORKSPACE_REQUIRED');
  return choice;
}
function sameOwner(source,target) {
  for (const key of ['kind','actor_id','principal_id','realm_id','organization_id']) {
    need(source?.[key]===target?.[key], 'T3_ACTIVITY_CROSS_PRINCIPAL_TRANSFER_FORBIDDEN');
  }
  need(['PERSONAL','CORP'].includes(source?.kind)&&
    typeof source.workspace_id==='string'&&
    typeof target.workspace_id==='string'&&
    source.workspace_id!==target.workspace_id,
    'T3_ACTIVITY_SEPARATE_TARGET_WORKSPACE_REQUIRED');
  need(typeof target.purpose==='string'&&target.purpose==='activity.derivation',
    'T3_ACTIVITY_DERIVATION_PURPOSE_REQUIRED');
}
async function stable(context,choice,owner,port,invalidated) {
  need(!invalidated()&&context.currentWorkspace.get()===choice,
    'T3_ACTIVITY_SELECTION_CHANGED');
  // The original signed Host must continue to represent the same actor,
  // grant and scope; a new grant or epoch requires starting over.
  need(JSON.stringify(await port.currentContext())===owner,
    'T3_ACTIVITY_SIGNED_OWNER_CHANGED');
}

/** Trusted Host only. Source/target are TWO already-selected ModuleContexts,
 * each backed by the original Kernel. Never pass these ports into renderer.
 * The target must be EMPTY, distinct, and owned by the SAME principal.
 * This deliberately does not authorize export of the draft Workspace.
 */
export async function stageSelectedT3ActivityReview({
  sourceContext, sourceSignedAccess, targetContext, targetSignedAccess,
  bindings, readActivityFromWorkspaceContext, createSubjectKernelBinding,
  explicitSave=false,
}={}) {
  need(explicitSave===true,'T3_ACTIVITY_EXPLICIT_SAVE_REQUIRED');
  const sourceChoice=selected(sourceContext),targetChoice=selected(targetContext);
  need(sourceContext.kernel===targetContext.kernel,
    'T3_ACTIVITY_SAME_ORIGINAL_KERNEL_REQUIRED');
  need(typeof readActivityFromWorkspaceContext==='function'&&
    typeof createSubjectKernelBinding==='function'&&
    sourceSignedAccess!==targetSignedAccess&&
    typeof sourceSignedAccess?.currentContext==='function'&&
    typeof targetSignedAccess?.currentContext==='function'&&
    typeof targetSignedAccess?.actionFor==='function',
    'T3_ACTIVITY_INDEPENDENT_SIGNED_ACCESS_REQUIRED');

  const srcOwner=await sourceSignedAccess.currentContext();
  const dstOwner=await targetSignedAccess.currentContext();
  need(good(srcOwner)&&good(dstOwner)&&
    srcOwner.workspace_id===sourceChoice.workspace_id&&
    dstOwner.workspace_id===targetChoice.workspace_id,
    'T3_ACTIVITY_OWNER_WORKSPACE_MISMATCH');
  sameOwner(srcOwner,dstOwner);
  need(await targetSignedAccess.actionFor('t1.putObject')==='activity.derive',
    'T3_ACTIVITY_DERIVE_ACTION_REQUIRED');
  const sourceIdentity=JSON.stringify(srcOwner),targetIdentity=JSON.stringify(dstOwner);
  let sourceInvalidated=false,targetInvalidated=false;
  let stopSource=null,stopTarget=null;
  let objectId=null,writeAttempted=false;
  try{
    stopSource=sourceContext.currentWorkspace.subscribe(()=>{sourceInvalidated=true;});
    stopTarget=targetContext.currentWorkspace.subscribe(()=>{targetInvalidated=true;});
    need(typeof stopSource==='function'&&typeof stopTarget==='function',
      'T3_ACTIVITY_OWNER_SUBSCRIPTION_REQUIRED');
    const check=async()=>{
      await stable(sourceContext,sourceChoice,sourceIdentity,sourceSignedAccess,()=>sourceInvalidated);
      await stable(targetContext,targetChoice,targetIdentity,targetSignedAccess,()=>targetInvalidated);
    };
    await check();
    // ORIGINAL T3 signed D1/D2 read. Keep the source projection only inside
    // this trusted Host closure, never in the renderer or derived Workspace.
    let observedSource=null;
    const captureOriginal=async(...args)=>{
      const view=await readActivityFromWorkspaceContext(...args);
      observedSource=view;
      return view;
    };
    const review=await inspectSelectedT3Activity({
      context:sourceContext,signedAccess:sourceSignedAccess,
      bindings,readActivityFromWorkspaceContext:captureOriginal,
    });
    await check();
    need(review.schema===T3_SELECTED_VIEW_SCHEMA&&
      review.anonymity==='NOT_ESTABLISHED'&&review.export_allowed===false&&
      review.iwxa_package===null,
      'T3_ACTIVITY_SOURCE_REVIEW_UNSUPPORTED');
    // ORIGINAL T3 D1 subject-bound Kernel. The target grant must allow
    // t1.getWorkspace, t1.listObjects, t1.putObject and t1.getObject.
    const scoped=createSubjectKernelBinding({
      kernel:targetContext.kernel,access:targetSignedAccess,
    });
    const targetId=targetChoice.workspace_id;
    const ws=await scoped.getWorkspace(targetId);
    await check();
    need(ws?.workspace_id===targetId&&!ws.deleted_at,
      'T3_ACTIVITY_TARGET_WORKSPACE_UNAVAILABLE');
    const existing=await scoped.listObjects({workspace_id:targetId,include_deleted:true});
    await check();
    need(Array.isArray(existing)&&existing.length===0,
      'T3_ACTIVITY_TARGET_NOT_EMPTY');
    // Store only enum/alias/cohort review data in the isolated Workspace.
    // No source object/event IDs, source digest, actor IDs, keys or grants.
    // Re-read the original source with a FRESH signed Access decision right
    // before the material effect. Status revocation, updated source revision
    // and selected-context changes must not yield a stale derived draft.
    const currentSource=await readActivityFromWorkspaceContext(sourceContext,{
      bindings,signedAccess:sourceSignedAccess,
    });
    await check();
    need(good(observedSource)&&JSON.stringify(currentSource)===JSON.stringify(observedSource),
      'T3_ACTIVITY_SOURCE_CHANGED_BEFORE_SAVE');
    const data={
      status:'OWNER_REVIEW_DRAFT',
      source_review_schema:T3_SELECTED_VIEW_SCHEMA,
      source_status:review.status,
      semantic_mapping:'T0_T1_D2_ONLY_NOT_OCEL2_CONFORMANCE',
      reason_codes:[...review.reason_codes],
      anonymity:'NOT_ESTABLISHED',
      disclosure_status:'NOT_EVALUATED',
      export_allowed:false,
      candidate:structuredClone(review.structural_candidate),
    };
    need(typeof globalThis.crypto?.randomUUID==='function',
      'T3_ACTIVITY_ID_UNAVAILABLE');
    objectId='activity-review:'+globalThis.crypto.randomUUID();
    await check();
    // An authoritative signed preflight AFTER the source's last read
    // distinguishes a known revoked right from an interrupted Kernel write.
    // The putObject itself still performs another original T3 JIT check.
    const finalTarget=await scoped.getWorkspace(targetId);
    await check();
    need(finalTarget?.workspace_id===targetId&&!finalTarget.deleted_at,
      'T3_ACTIVITY_TARGET_WORKSPACE_UNAVAILABLE');
    // Once invoked, an interrupted Host may have committed; never retry.
    writeAttempted=true;
    const receipt=await scoped.putObject({
      workspace_id:targetId,object_id:objectId,
      schema_id:T3_ACTIVITY_OWNER_REVIEW_SCHEMA,schema_version:'1.0.0',
      base_revision:0,data,extensions:{},
      event:{event_type:'t3.activity.review.staged',
        payload:{status:'OWNER_REVIEW_DRAFT',disclosure_status:'NOT_EVALUATED'}},
    });
    await check();
    need(receipt?.object?.workspace_id===targetId&&
      receipt.object.object_id===objectId&&receipt.object.revision===1&&
      typeof receipt.event?.event_id==='string',
      'T3_ACTIVITY_ORIGINAL_RECEIPT_INVALID');
    const detail=await scoped.getObject(targetId,objectId);
    await check();
    need(detail?.object?.workspace_id===targetId&&
      detail.object.object_id===objectId&&detail.object.revision===1&&
      detail.object.schema_id===T3_ACTIVITY_OWNER_REVIEW_SCHEMA&&
      detail.object.schema_version==='1.0.0'&&
      JSON.stringify(detail.object.data)===JSON.stringify(data),
      'T3_ACTIVITY_ORIGINAL_READBACK_INVALID');
    return Object.freeze({
      workspace_id:targetId,object_id:objectId,revision:1,
      event_id:receipt.event.event_id,status:'OWNER_REVIEW_DRAFT',
      source_review_status:review.status,readback:true,export_allowed:false,
    });
  }catch(error){
    if(writeAttempted){
      // May have committed despite lost acknowledgement, revoked status or
      // selected context switching. Reopen this exact object; no auto retry.
      const uncertain=new T3ActivityHold('T3_ACTIVITY_WRITE_MAY_HAVE_COMMITTED');
      uncertain.object_id=objectId;
      uncertain.cause_code=error?.code??'UNVERIFIED_COMMIT_OR_READBACK';
      throw uncertain;
    }
    throw error;
  }finally{
    stopSource?.();stopTarget?.();
  }
}

// Optional renderer capability: the trusted owner keeps all T3 Kernel,
// selected Workspace, source evidence and signed Access in its own process.
// The only result crossing into UI is the three-field, non-exportable status.
export function createTrustedT3ActivityStagePort(config) {
  need(good(config),'T3_ACTIVITY_STAGE_OWNER_REQUIRED');
  return Object.freeze({
    async stageSelected() {
      try{
        const receipt=await stageSelectedT3ActivityReview({...config,explicitSave:true});
        need(receipt.status==='OWNER_REVIEW_DRAFT'&&receipt.readback===true&&
          receipt.export_allowed===false,'T3_ACTIVITY_ORIGINAL_READBACK_INVALID');
        return Object.freeze({status:'OWNER_REVIEW_DRAFT',readback:true,export_allowed:false});
      }catch(error){
        // A lost-ack error can carry an internal object_id; it must never
        // cross the renderer boundary or become an export identifier.
        const code=error instanceof T3ActivityHold &&
          /^T3_[A-Z0-9_]{2,100}$/.test(error.code??'')
          ? error.code : 'T3_ACTIVITY_STAGE_REFUSED';
        throw new T3ActivityHold(code);
      }
    },
  });
}
