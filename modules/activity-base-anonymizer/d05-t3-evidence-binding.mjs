// Evidence-aware D05 source profile for the EXISTING original T3 D2 reader.
// No new Kernel/Host/Store/signer, no inferred industrial execution.
// Source immutable Git TREE: Faust-S/cehovod.ru at 0ada4f082a39ec9a7bf2be3f75b57ebc5ebc39b4.
// The original CehoVod T2 commands only report application state changes.
import {createTrustedT3ReviewPort} from './t3-selected-host.mjs';
export const D05_SOURCE_PIN=Object.freeze({
 repository:'Faust-S/cehovod.ru',
 commit:'0ada4f082a39ec9a7bf2be3f75b57ebc5ebc39b4',
 tree:'a0570f59cf74a4f6449d4cf874a288fc898fdc29',
 domain:'ru.5ibs.productionops',
 version:'1.0.0',
});
export const D05_RESULT_TYPES=Object.freeze([
 'production-request',
 'product',
 'product-version',
 'product-passport',
 'bill-of-materials',
 'material-requirement',
 'operation',
 'operation-route',
 'lead-time-estimate',
 'cost-calculation',
 'make-or-buy-analysis',
 'make-or-buy-decision',
 'contract-operation-brief',
 'quality-plan',
 'quality-check-template',
 'defect-record',
 'order-readiness-assessment',
 'production-order-draft',
 'production-order',
 'production-execution',
 'production-actuals',
 'quality-check-result',
 'batch',
 'plan-fact-analysis',
 'production-template-update',
 'document-reference',
]);
export const D05_EVENT_TYPES=Object.freeze([
 'cehovod.result.saved',
 'cehovod.order.transitioned',
 'cehovod.operation.transitioned',
]);
/** Version-pinned and fail-closed original D2 source binding.
 * The objects are saved Result envelopes even if their names say Operation.
 * Only original Kernel relations can represent based_on links. Plain string
 * IDs in event payloads do NOT become OCEL qualified E2O references.
 * These reported events are not independent observation of physical work.
 */
export function createCehovodD05T3Bindings(){
 return {
  objects:D05_RESULT_TYPES.map(t=>({
   schema_id:D05_SOURCE_PIN.domain+'.'+t,
   schema_version:D05_SOURCE_PIN.version,
   semantic_kind:'Result',
  })),
  events:D05_EVENT_TYPES.map(event_type=>({
   event_type,semantic_kind:'Event',epistemic_status:'reported',
  })),
  relations:[{kind:'based_on',relation:'based_on'}],
  context_events:['workspace.created'],
 };
}
/** Trusted Host only. Uses original signed D1 activity.read and D2. */
export function createTrustedCehovodD05ReviewPort(config){
 return createTrustedT3ReviewPort({
  ...config,bindings:createCehovodD05T3Bindings(),
 });
}
