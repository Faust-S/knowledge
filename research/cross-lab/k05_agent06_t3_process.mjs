/** K05 read-only intake of existing T3 Process Intelligence output.
 * No process mining, new graph, event store or runtime. This is a
 * derived-only report; sourceTruth/operationalTruth remain false.
 */
export const CONTRACT = 'IWXA_K05_T3_PROCESS_DERIVED_METRICS/0.1';
const MAX = 1_000_000;
const need = (ok, code) => {
  if (!ok) throw Object.assign(new TypeError('K05_T3_' + code), {code: 'K05_T3_' + code});
};
const natural = v => Number.isSafeInteger(v) && v >= 0 && v <= MAX;
const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const duration = v => typeof v === 'bigint' && v >= 0n && v <= 10n**30n;

/** Preserve the meaning and completeness of the original owner projection.
 * The original input evidenceRefs need an authorized owner readback before
 * anyone can call this an observed real-world process duration.
 */
export function summarizeT3ProcessIntelligence(value) {
  need(obj(value) && value.schema === 'IWXA_T2_PROCESS_INTELLIGENCE_V1' &&
    value.derived === true && value.sourceTruth === false &&
    value.operationalTruth === false && value.prerequisite === 'COMMON_TIME_PROVENANCE',
    'OWNER_PROJECTION_REQUIRED');
  const {observation, metrics, conformance, unresolved} = value;
  need(obj(observation) && observation.schema === 'IWXA_T2_OBJECT_CENTRIC_PROCESS_OBSERVATION_V1' &&
    observation.derived === true && observation.sourceTruth === false &&
    observation.prerequisite === 'COMMON_TIME_PROVENANCE' &&
    observation.linearizationAuthority === 'NON_AUTHORITATIVE_TIME_THEN_ID',
    'OBJECT_CENTRIC_PROJECTION_REQUIRED');
  need(observation.workspaceId === value.workspaceId &&
    observation.runId === value.runId &&
    observation.definitionId === value.definitionId, 'OWNER_CONTEXT_CHANGED');
  need(obj(metrics) && obj(conformance) && obj(unresolved) &&
    natural(metrics.eventCount) && natural(metrics.activityCount) &&
    natural(metrics.caseCount) && Array.isArray(metrics.activityDurations) &&
    Array.isArray(observation.observations) &&
    observation.observations.length === metrics.eventCount, 'OWNER_METRICS_INVALID');
  need(observation.observations.every(event => obj(event) &&
    Array.isArray(event.evidenceRefs) && event.evidenceRefs.length > 0 &&
    event.evidenceRefs.every(ref => typeof ref === 'string' && ref.length > 0)),
    'MISSING_SOURCE_PROVENANCE');
  need(natural(conformance.evaluatedCaseCount) &&
    natural(conformance.unevaluableCaseCount) &&
    natural(conformance.conformantCaseCount) &&
    natural(conformance.nonconformantCaseCount) &&
    conformance.evaluatedCaseCount + conformance.unevaluableCaseCount === metrics.caseCount &&
    conformance.conformantCaseCount + conformance.nonconformantCaseCount === conformance.evaluatedCaseCount,
    'CONFORMANCE_DENOMINATOR_INVALID');
  let activities = 0, measured = 0, missing = 0, totalNs = 0n;
  const names = new Set();
  for (const metric of metrics.activityDurations) {
    need(obj(metric) && typeof metric.definitionActivityId === 'string' &&
      metric.definitionActivityId.length > 0 &&
      !names.has(metric.definitionActivityId) &&
      natural(metric.occurrenceCount) && natural(metric.measuredCount) &&
      metric.measuredCount <= metric.occurrenceCount &&
      Array.isArray(metric.unresolvedActivityIds) &&
      metric.unresolvedActivityIds.length === metric.occurrenceCount - metric.measuredCount &&
      duration(metric.totalNanoseconds) &&
      (metric.measuredCount === 0 ?
        metric.totalNanoseconds === 0n && metric.minNanoseconds === null &&
        metric.maxNanoseconds === null :
        duration(metric.minNanoseconds) && duration(metric.maxNanoseconds) &&
        metric.minNanoseconds <= metric.maxNanoseconds &&
        metric.totalNanoseconds >= metric.minNanoseconds * BigInt(metric.measuredCount) &&
        metric.totalNanoseconds <= metric.maxNanoseconds * BigInt(metric.measuredCount)),
      'ACTIVITY_DURATION_INVALID');
    names.add(metric.definitionActivityId);
    activities += metric.occurrenceCount;
    measured += metric.measuredCount;
    missing += metric.unresolvedActivityIds.length;
    totalNs += metric.totalNanoseconds;
  }
  need(activities === metrics.activityCount &&
    natural(measured) && natural(missing) &&
    Array.isArray(unresolved.activityCaseActivityIds) &&
    Array.isArray(unresolved.eventActivityEventIds) &&
    Array.isArray(observation.unresolvedRefs),
    'ACTIVITY_COVERAGE_MISMATCH');
  const complete = value.complete === true && observation.complete === true &&
    missing === 0 && unresolved.activityCaseActivityIds.length === 0 &&
    unresolved.eventActivityEventIds.length === 0 &&
    observation.unresolvedRefs.length === 0;
  return {
    schema: CONTRACT,
    status: complete ? 'OWNER_DERIVED_COMPLETE_NOT_OPERATIONAL_TRUTH' :
      'OWNER_DERIVED_PARTIAL',
    case_count: metrics.caseCount,
    event_count: metrics.eventCount,
    activity_count: activities,
    measured_activity_count: measured,
    missing_activity_time_count: missing,
    evaluable_case_count: conformance.evaluatedCaseCount,
    unevaluable_case_count: conformance.unevaluableCaseCount,
    sum_activity_time_nanoseconds: complete ? String(totalNs) : null,
    sum_activity_time_status: complete ? 'DERIVED_ONLY' : 'UNKNOWN',
    process_cycle_time_ms: null,
    process_cycle_time_status: 'NOT_MEASURABLE',
    accepted_result_count: null,
    accepted_result_status: 'NOT_VERIFIED',
    actual_cost_minor: null,
    actual_roi_status: 'NOT_MEASURABLE',
    original_owner_evidence_readback: 'NOT_VERIFIED',
    source_truth: false,
    business_truth: false,
  };
}

/** Only the selected original T3 owner derives Process Intelligence. */
export function projectT3ProcessFromOriginalOwner(ownerDerive, ownerInput) {
  need(typeof ownerDerive === 'function', 'OWNER_DERIVER_REQUIRED');
  return summarizeT3ProcessIntelligence(ownerDerive(ownerInput));
}
