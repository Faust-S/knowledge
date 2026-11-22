// UI lifecycle for a narrow, Host-owned Activity review capability.
// The renderer never receives T3 Kernel, signed Access, source IDs or grants.
// The trusted owner runs original signed D1/D2 reads and signals invalidation.
import {T3ActivityHold, T3_SELECTED_VIEW_SCHEMA} from './t3-selected-host.mjs';

const REASON_CODES = new Set([
  'T3_D2_UNRESOLVED_SOURCE_LINK', 'T3_D2_UNMAPPED_SOURCE_RECORD',
  'T3_D2_EVENT_OBJECT_UNVERIFIED', 'T3_D2_NO_OBSERVED_ACTIVITY',
  'T3_D2_UNVERIFIED_EVENT_STEP',
  'T3_D2_EVENT_STATUS_NOT_DECLARED',
  'T3_D2_SYSTEM_CONTEXT_EXCLUDED',
  'T3_D2_OBJECT_EVENT_ORDER_UNKNOWN', 'T3_D2_OBJECT_WITHOUT_EVENTS',
  'T3_D2_RARE_OBJECT_ROUTE', 'T3_D2_RARE_OBJECT_RELATION',
  'T3_D2_RELATION_PRIVACY_REVIEW_REQUIRED',
  'EXTERNAL_LINKAGE_RISK_UNMEASURED',
  'T3_SIGNED_OWNER_RESULT_NOT_INDEPENDENTLY_ATTESTED',
  'OCEL2_FULL_CONFORMANCE_NOT_ESTABLISHED',
]);
const BANDS = new Set(['3-9', '10-49', '50+']);
const ALIAS = /^(?:event_type|object_type)_[0-9]{3,5}$/;
const obj = v => v && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => obj(v) &&
  Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v,key));
const safeCode = error => error instanceof T3ActivityHold &&
  /^T3_[A-Z0-9_]{2,100}$/.test(error.code ?? '') ?
  error.code : 'T3_REVIEW_UNAVAILABLE';

// Strictly disallow raw identifiers, timestamps, arbitrary strings, payloads,
// active authority fields and future schema extensions before they touch React.
function acceptedReview(r) {
  const keys=['schema','status','reason_codes','host_source', 'semantic_mapping',
    'residual_risk','anonymity','export_allowed','iwxa_package','structural_candidate'];
  const ok=exact(r,keys) && r.schema === T3_SELECTED_VIEW_SCHEMA &&
    ['HOLD','STRUCTURE_PRESERVED_REVIEW_REQUIRED'].includes(r.status) &&
    Array.isArray(r.reason_codes) && r.reason_codes.length <= 16 &&
    r.reason_codes.every(x=>REASON_CODES.has(x)) &&
    r.host_source === 'T3_D2_SELECTED_WORKSPACE_INVOKED' &&
    r.semantic_mapping === 'T0_T1_D2_ONLY_NOT_OCEL2_CONFORMANCE' &&
    r.residual_risk === (r.status === 'HOLD' ? 'HIGH_OR_UNDETERMINED' : 'UNDETERMINED') &&
    r.anonymity === 'NOT_ESTABLISHED' && r.export_allowed === false &&
    r.iwxa_package === null;
  if (!ok) throw new T3ActivityHold('T3_HOST_RESULT_UNVERIFIED');
  if (r.status === 'HOLD') {
    if (r.structural_candidate !== null) throw new T3ActivityHold('T3_HOST_RESULT_UNVERIFIED');
  } else {
    if (!Array.isArray(r.structural_candidate) || !r.structural_candidate.length ||
        r.structural_candidate.length > 2000) throw new T3ActivityHold('T3_HOST_RESULT_UNVERIFIED');
    // The UI renders event-local topology and keys cards by object alias.
    // Reject inconsistent or duplicate aliases at the SAME Host boundary,
    // rather than letting an invalid map crash the React tree.
    const objectKinds=new Set();
    for (const v of r.structural_candidate) {
      if (!exact(v,['object_type','cohort_band','observed_event_kinds','object_local_successions']) ||
          !ALIAS.test(v.object_type) || !v.object_type.startsWith('object_type_') ||
          !BANDS.has(v.cohort_band) ||
          !Array.isArray(v.observed_event_kinds) || v.observed_event_kinds.length > 10000 ||
          !v.observed_event_kinds.every(x=>ALIAS.test(x) && x.startsWith('event_type_')) ||
          !Array.isArray(v.object_local_successions) || v.object_local_successions.length > 10000 ||
          !v.object_local_successions.every(e=>exact(e,['from','to','cohort_band','relation']) &&
            ALIAS.test(e.from) && e.from.startsWith('event_type_') &&
            ALIAS.test(e.to) && e.to.startsWith('event_type_') &&
            BANDS.has(e.cohort_band) &&
            e.relation === 'OBSERVED_OBJECT_LOCAL_ORDER_NOT_CAUSAL_DEPENDENCY')) {
        throw new T3ActivityHold('T3_HOST_RESULT_UNVERIFIED');
      }
      if (objectKinds.has(v.object_type))
        throw new T3ActivityHold('T3_HOST_RESULT_UNVERIFIED');
      objectKinds.add(v.object_type);
      const kinds=new Set(v.observed_event_kinds);
      if (kinds.size!==v.observed_event_kinds.length)
        throw new T3ActivityHold('T3_HOST_RESULT_UNVERIFIED');
      const edges=new Set();
      for (const e of v.object_local_successions) {
        const edge=JSON.stringify([e.from,e.to]);
        if (!kinds.has(e.from)||!kinds.has(e.to)||edges.has(edge))
          throw new T3ActivityHold('T3_HOST_RESULT_UNVERIFIED');
        edges.add(edge);
      }
    }
  }
  // Copy after validation so the Host cannot mutate a live renderer reference.
  try { return structuredClone(r); }
  catch { throw new T3ActivityHold('T3_HOST_RESULT_UNVERIFIED'); }
}

export function createT3ReviewController({host, onUpdate} = {}) {
  if (!host || typeof onUpdate !== 'function' ||
      typeof host.readSelected !== 'function' ||
      typeof host.subscribeInvalidation !== 'function') {
    throw new T3ActivityHold('T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
  }
  let generation = 0;
  let detached = false;
  let currentReview = null;
  let stagePending = false;
  let recoveryPending = false;
  // An interrupted write may already be committed in the original Kernel.
  // Do not dispatch a second stage within this mounted signed Host session.
  let stageAttempted = false;
  const invalidate = () => {
    generation += 1;
    currentReview = null;
    // Invalidation must not release an in-flight or already attempted write.
    if (!detached) onUpdate({status: 'READY_TO_READ', review: null});
  };
  let unowner;
  try {
    unowner=host.subscribeInvalidation(invalidate);
    if(typeof unowner!=='function')throw Error('SUBSCRIPTION_MISSING');
  } catch {
    throw new T3ActivityHold('T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
  }
  onUpdate({status: 'READY_TO_READ', review: null});
  return Object.freeze({
    async readSelected() {
      if (detached) return {status: 'DETACHED'};
      if (stagePending || recoveryPending) return {status: 'INVALIDATED'};
      currentReview = null;
      const id = ++generation;
      onUpdate({status: 'READING', review: null});
      try {
        const review = acceptedReview(await host.readSelected());
        if (detached || id !== generation) return {status: 'INVALIDATED'};
        currentReview = review;
        onUpdate({status: 'REVIEW', review, stageBlocked: stageAttempted});
        return {status: 'REVIEW'};
      } catch (error) {
        if (detached || id !== generation) return {status: 'INVALIDATED'};
        onUpdate({status: 'HOLD', review: null, code: safeCode(error)});
        return {status: 'HOLD'};
      }
    },
    async stageSelected() {
      if (detached) return {status: 'DETACHED'};
      if (stagePending || recoveryPending || stageAttempted || !currentReview ||
          typeof host.stageSelected !== 'function') return {status: 'UNAVAILABLE'};
      const id = ++generation;
      stagePending = true;
      stageAttempted = true;
      currentReview = null;
      onUpdate({status: 'STAGING', review: null});
      try {
        const receipt = await host.stageSelected();
        if (detached || id !== generation) return {status: 'INVALIDATED'};
        // The UI must never receive source IDs, signed grants, source receipts
        // or a purported permission to export from the Host.
        if (!exact(receipt, ['status','readback','export_allowed']) ||
            receipt.status !== 'OWNER_REVIEW_DRAFT' ||
            receipt.readback !== true || receipt.export_allowed !== false) {
          throw new T3ActivityHold('T3_HOST_STAGE_RESULT_UNVERIFIED');
        }
        onUpdate({status: 'STAGED', review: null});
        return {status: 'STAGED'};
      } catch (error) {
        if (detached || id !== generation) return {status: 'INVALIDATED'};
        onUpdate({status: 'HOLD', review: null, code: safeCode(error),
          stageBlocked: true});
        return {status: 'HOLD'};
      } finally {
        stagePending = false;
      }
    },
    async recoverSelected() {
      if (detached) return {status: 'DETACHED'};
      if (stagePending || recoveryPending ||
          typeof host.recoverSelected !== 'function') return {status: 'UNAVAILABLE'};
      const id = ++generation;
      recoveryPending = true;
      currentReview = null;
      onUpdate({status: 'RECOVERING', review: null, stageBlocked: stageAttempted});
      try {
        // Only a fresh signed Kernel readback; this port has no write method.
        const receipt = await host.recoverSelected();
        if (detached || id !== generation) return {status: 'INVALIDATED'};
        if (!exact(receipt, ['status','readback','export_allowed']) ||
            receipt.status !== 'OWNER_REVIEW_DRAFT' ||
            receipt.readback !== true || receipt.export_allowed !== false) {
          throw new T3ActivityHold('T3_HOST_RECOVERY_RESULT_UNVERIFIED');
        }
        onUpdate({status: 'STAGED', review: null, recovered: true,
          stageBlocked: stageAttempted});
        return {status: 'STAGED'};
      } catch (error) {
        if (detached || id !== generation) return {status: 'INVALIDATED'};
        onUpdate({status: 'HOLD', review: null, code: safeCode(error),
          stageBlocked: stageAttempted});
        return {status: 'HOLD'};
      } finally {
        recoveryPending = false;
      }
    },
    reset() { if (!detached) invalidate(); },
    dispose() {
      if (detached) return;
      detached = true;
      generation += 1;
      currentReview = null;
      stagePending = false;
      recoveryPending = false;
      unowner();
    },
  });
}