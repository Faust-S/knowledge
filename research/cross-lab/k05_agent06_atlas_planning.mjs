/** K05 read-only bridge to the original Atlas CPM planning owner.
 *
 * A saved/revised plan is NEVER a measured execution duration, payment,
 * accepted domain Result, or causal benefit of Agent/IWXA.
 *
 * Use the actual public Atlas scheduleProject + scheduleChangeSummary;
 * this bridge contains no scheduler, project store or process engine.
 */
export const CONTRACT = 'IWXA_K05_ATLAS_PLANNED_CHANGE/0.1';
const need = (ok, code) => {
  if (!ok) throw Object.assign(new TypeError('K05_ATLAS_' + code), {
    code: 'K05_ATLAS_' + code,
  });
};
const natural = v => Number.isSafeInteger(v) && v >= 0 && v <= 36500;
const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 5000;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function summarizeAtlasPlannedChange(beforePlan, afterPlan, difference) {
  need(object(beforePlan) && object(afterPlan) && object(difference),
       'ORIGINAL_PLAN_REQUIRED');
  need(natural(beforePlan.durationDays) && natural(afterPlan.durationDays) &&
       Array.isArray(beforePlan.rows) && Array.isArray(afterPlan.rows) &&
       count(beforePlan.workItems) && count(afterPlan.workItems) &&
       beforePlan.workItems === beforePlan.rows.length &&
       afterPlan.workItems === afterPlan.rows.length,
       'PLAN_COVERAGE_INVALID');
  // The original owner explicitly describes a CPM estimate, not operational truth.
  need(typeof beforePlan.warning === 'string' &&
       beforePlan.warning.includes('Calendar-day CPM estimate') &&
       typeof afterPlan.warning === 'string' &&
       afterPlan.warning.includes('Calendar-day CPM estimate'),
       'OWNER_PLANNING_SEMANTICS_REQUIRED');
  need(difference.durationBefore === beforePlan.durationDays &&
       difference.durationAfter === afterPlan.durationDays &&
       count(difference.affectedTotal) &&
       count(difference.movedTotal) &&
       count(difference.criticalChangedTotal) &&
       difference.movedTotal <= difference.affectedTotal,
       'PLAN_COMPARISON_INCONSISTENT');
  const delta = afterPlan.durationDays - beforePlan.durationDays;
  return Object.freeze({
    schema: CONTRACT,
    status: 'PLAN_ONLY_NOT_EXECUTION',
    source: 'ORIGINAL_ATLAS_CPM_OWNER',
    before_planned_calendar_days: beforePlan.durationDays,
    after_planned_calendar_days: afterPlan.durationDays,
    planned_delta_calendar_days: delta,
    before_work_items: beforePlan.workItems,
    after_work_items: afterPlan.workItems,
    planned_affected_works: difference.affectedTotal,
    planned_moved_works: difference.movedTotal,
    planned_critical_changed_works: difference.criticalChangedTotal,
    observed_process_cycle_ms: null,
    observed_human_active_ms: null,
    observed_actual_cost_minor: null,
    accepted_business_result: 'NOT_VERIFIED',
    actual_roi_percent: null,
    actual_roi_status: 'NOT_MEASURABLE',
    source_event_provenance: 'NOT_VERIFIED',
    original_saved_project_readback: 'NOT_VERIFIED',
    t3_operational_truth: false,
    forecasts_used_for_roi: false,
  });
}

/** Called by an authorized Atlas owner consumer with original public functions.
 * No unsafe import, extra core, I/O, execution or Store mutation here.
 */
export function projectAtlasPlanningFromOriginalOwner(
  ownerScheduleProject, ownerScheduleChangeSummary, beforeProject, afterProject,
) {
  need(typeof ownerScheduleProject === 'function' &&
       typeof ownerScheduleChangeSummary === 'function',
       'ORIGINAL_ATLAS_OWNER_REQUIRED');
  const before = ownerScheduleProject(beforeProject);
  const after = ownerScheduleProject(afterProject);
  const difference = ownerScheduleChangeSummary(before, after);
  return summarizeAtlasPlannedChange(before, after, difference);
}
