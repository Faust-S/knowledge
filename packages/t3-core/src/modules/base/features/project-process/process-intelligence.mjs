import { ProjectProcessSemanticError, deriveProcessConformance } from './project-process.mjs';

function requireSource(value, kind, label) {
  if (!value || value.objectKind !== kind || value.sourceTruth !== true || typeof value.workspaceId !== 'string') {
    throw new ProjectProcessSemanticError(`${label} must be a normalized ${kind} source object`, 'INVALID_PROCESS_INTELLIGENCE_INPUT');
  }
  return value;
}

function compareInstant(left, right) {
  return left.compare(right);
}

function requireSameWorkspace(value, workspaceId, label) {
  if (value.workspaceId !== workspaceId) {
    throw new ProjectProcessSemanticError(`${label} crosses Workspace boundary`, 'CROSS_WORKSPACE_PROJECT_PROCESS_RELATION');
  }
}

function uniqueById(values, idField, label) {
  const byId = new Map();
  for (const value of values) {
    const id = value[idField];
    if (typeof id !== 'string' || id === '') {
      throw new ProjectProcessSemanticError(`${label}.${idField} must be present`, 'INVALID_PROCESS_INTELLIGENCE_INPUT');
    }
    if (byId.has(id)) {
      throw new ProjectProcessSemanticError(`duplicate ${label} ${id}`, 'DUPLICATE_PROJECT_PROCESS_REF');
    }
    byId.set(id, value);
  }
  return byId;
}

function countBy(values, keyOf) {
  const counts = new Map();
  for (const value of values) {
    const key = keyOf(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.freeze([...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => Object.freeze({ key, count })));
}

function validateInputs({ definition, run, cases = [], activities = [], events = [] }) {
  requireSource(definition, 'processDefinition', 'definition');
  requireSource(run, 'processRun', 'run');
  if (run.definitionId !== definition.definitionId) {
    throw new ProjectProcessSemanticError('run.definitionId must match definition.definitionId', 'PROCESS_DEFINITION_RUN_MISMATCH');
  }
  requireSameWorkspace(run, definition.workspaceId, 'run');
  if (!Array.isArray(cases) || !Array.isArray(activities) || !Array.isArray(events)) {
    throw new ProjectProcessSemanticError('cases, activities and events must be arrays', 'INVALID_PROCESS_INTELLIGENCE_INPUT');
  }
  for (const value of cases) {
    requireSource(value, 'case', 'case');
    requireSameWorkspace(value, run.workspaceId, 'case');
    if (value.runId !== run.runId) {
      throw new ProjectProcessSemanticError('case belongs to another run', 'PROCESS_INTELLIGENCE_RUN_MISMATCH');
    }
  }
  for (const value of activities) {
    requireSource(value, 'activity', 'activity');
    requireSameWorkspace(value, run.workspaceId, 'activity');
    if (value.runId !== run.runId) {
      throw new ProjectProcessSemanticError('activity belongs to another run', 'PROCESS_INTELLIGENCE_RUN_MISMATCH');
    }
  }
  for (const value of events) {
    requireSource(value, 'event', 'event');
    requireSameWorkspace(value, run.workspaceId, 'event');
    if (value.runId !== run.runId) {
      throw new ProjectProcessSemanticError('event belongs to another run', 'PROCESS_INTELLIGENCE_RUN_MISMATCH');
    }
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
      throw new ProjectProcessSemanticError('process intelligence requires event evidenceRefs', 'MISSING_PROCESS_INTELLIGENCE_PROVENANCE');
    }
  }
}

export function deriveObjectCentricProcessObservation(input) {
  const { definition, run, cases = [], activities = [], events = [] } = input;
  validateInputs(input);
  const caseById = uniqueById(cases, 'caseId', 'case');
  const activityById = uniqueById(activities, 'activityId', 'activity');
  uniqueById(events, 'eventId', 'event');
  const unresolvedRefs = [];
  const observations = events.map((event) => {
    const activity = event.activityId == null ? null : activityById.get(event.activityId) ?? null;
    const caseValue = event.caseId == null ? null : caseById.get(event.caseId) ?? null;
    if (event.activityId != null && !activity) unresolvedRefs.push(`activity:${event.activityId}`);
    if (event.caseId != null && !caseValue) unresolvedRefs.push(`case:${event.caseId}`);
    if (activity && event.caseId != null && activity.caseId != null && activity.caseId !== event.caseId) {
      throw new ProjectProcessSemanticError(`event ${event.eventId} case/activity relation is inconsistent`, 'INCONSISTENT_OBJECT_CENTRIC_RELATION');
    }
    const objects = [
      Object.freeze({ kind: 'processDefinition', id: definition.definitionId }),
      Object.freeze({ kind: 'processRun', id: run.runId }),
      Object.freeze({ kind: 'project', id: run.projectId }),
    ];
    if (run.workId) objects.push(Object.freeze({ kind: 'work', id: run.workId }));
    if (event.caseId) objects.push(Object.freeze({ kind: 'case', id: event.caseId }));
    if (event.activityId) objects.push(Object.freeze({ kind: 'activity', id: event.activityId }));
    return Object.freeze({
      eventId: event.eventId,
      eventType: event.eventType,
      occurredAt: event.occurredAt,
      definitionActivityId: activity?.definitionActivityId ?? null,
      objects: Object.freeze(objects),
      evidenceRefs: event.evidenceRefs,
    });
  }).sort((left, right) => compareInstant(left.occurredAt, right.occurredAt) || left.eventId.localeCompare(right.eventId));
  return Object.freeze({
    schema: 'IWXA_T2_OBJECT_CENTRIC_PROCESS_OBSERVATION_V1',
    derived: true,
    sourceTruth: false,
    prerequisite: 'COMMON_TIME_PROVENANCE',
    workspaceId: run.workspaceId,
    definitionId: definition.definitionId,
    runId: run.runId,
    complete: unresolvedRefs.length === 0,
    unresolvedRefs: Object.freeze([...new Set(unresolvedRefs)].sort()),
    linearizationAuthority: 'NON_AUTHORITATIVE_TIME_THEN_ID',
    observations: Object.freeze(observations),
  });
}

function orderedCaseActivities(caseId, activities) {
  const selected = activities.filter((activity) => activity.caseId === caseId);
  const unresolvedActivityIds = selected
    .filter((activity) => activity.startedAt == null)
    .map((activity) => activity.activityId)
    .sort();
  const ordered = selected
    .filter((activity) => activity.startedAt != null)
    .sort((left, right) => compareInstant(left.startedAt, right.startedAt) || left.activityId.localeCompare(right.activityId));
  return { selected, ordered, unresolvedActivityIds };
}

function deriveVariants({ cases, activities, definition }) {
  const conformance = [];
  const variants = new Map();
  for (const caseValue of cases) {
    const { selected, ordered, unresolvedActivityIds } = orderedCaseActivities(caseValue.caseId, activities);
    const sequence = ordered.map((activity) => activity.definitionActivityId);
    const evaluable = unresolvedActivityIds.length === 0;
    const result = evaluable ? deriveProcessConformance({ definition, observedActivityIds: sequence }) : null;
    conformance.push(Object.freeze({
      caseId: caseValue.caseId,
      evaluable,
      activityCount: selected.length,
      sequence: Object.freeze(sequence),
      unresolvedActivityIds: Object.freeze(unresolvedActivityIds),
      conformant: result?.conformant ?? null,
      missingActivityIds: result?.missingActivityIds ?? Object.freeze([]),
      unexpectedActivityIds: result?.unexpectedActivityIds ?? Object.freeze([]),
      orderConformant: result?.orderConformant ?? null,
    }));
    if (evaluable) {
      const signature = JSON.stringify(sequence);
      const current = variants.get(signature) ?? { sequence, caseIds: [] };
      current.caseIds.push(caseValue.caseId);
      variants.set(signature, current);
    }
  }
  return {
    conformance: Object.freeze(conformance.sort((left, right) => left.caseId.localeCompare(right.caseId))),
    variants: Object.freeze([...variants.values()]
      .map((variant) => Object.freeze({
        sequence: Object.freeze([...variant.sequence]),
        caseCount: variant.caseIds.length,
        caseIds: Object.freeze([...variant.caseIds].sort()),
      }))
      .sort((left, right) => JSON.stringify(left.sequence).localeCompare(JSON.stringify(right.sequence)))),
  };
}

function deriveActivityDurationMetrics(activities) {
  const groups = new Map();
  for (const activity of activities) {
    const key = activity.definitionActivityId;
    const group = groups.get(key) ?? {
      occurrenceCount: 0,
      measuredCount: 0,
      totalNanoseconds: 0n,
      minNanoseconds: null,
      maxNanoseconds: null,
      unresolvedActivityIds: [],
    };
    group.occurrenceCount += 1;
    if (activity.startedAt == null || activity.finishedAt == null) {
      group.unresolvedActivityIds.push(activity.activityId);
    } else {
      const duration = activity.finishedAt.epochNanoseconds - activity.startedAt.epochNanoseconds;
      if (duration < 0n) {
        throw new ProjectProcessSemanticError('activity duration must not be negative', 'INVALID_PROJECT_PROCESS_TIME');
      }
      group.measuredCount += 1;
      group.totalNanoseconds += duration;
      group.minNanoseconds = group.minNanoseconds == null || duration < group.minNanoseconds ? duration : group.minNanoseconds;
      group.maxNanoseconds = group.maxNanoseconds == null || duration > group.maxNanoseconds ? duration : group.maxNanoseconds;
    }
    groups.set(key, group);
  }
  return Object.freeze([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([definitionActivityId, group]) => Object.freeze({
      definitionActivityId,
      occurrenceCount: group.occurrenceCount,
      measuredCount: group.measuredCount,
      totalNanoseconds: group.totalNanoseconds,
      minNanoseconds: group.minNanoseconds,
      maxNanoseconds: group.maxNanoseconds,
      unresolvedActivityIds: Object.freeze(group.unresolvedActivityIds.sort()),
    })));
}

export function deriveProcessIntelligence(input) {
  const { definition, run, cases = [], activities = [], events = [] } = input;
  const observation = deriveObjectCentricProcessObservation(input);
  const caseById = uniqueById(cases, 'caseId', 'case');
  const activityById = uniqueById(activities, 'activityId', 'activity');
  const unresolvedActivityCaseIds = [];
  for (const activity of activities) {
    if (activity.caseId != null && !caseById.has(activity.caseId)) unresolvedActivityCaseIds.push(activity.activityId);
  }
  const unresolvedEventActivityIds = events
    .filter((event) => event.activityId != null && !activityById.has(event.activityId))
    .map((event) => event.eventId);
  const { conformance, variants } = deriveVariants({ cases, activities, definition });
  const evaluated = conformance.filter((item) => item.evaluable);
  return Object.freeze({
    schema: 'IWXA_T2_PROCESS_INTELLIGENCE_V1',
    derived: true,
    sourceTruth: false,
    prerequisite: 'COMMON_TIME_PROVENANCE',
    workspaceId: run.workspaceId,
    definitionId: definition.definitionId,
    versionId: definition.versionId,
    runId: run.runId,
    operationalTruth: false,
    complete: observation.complete && unresolvedActivityCaseIds.length === 0 && unresolvedEventActivityIds.length === 0,
    observation,
    variants,
    conformance: Object.freeze({
      cases: conformance,
      evaluatedCaseCount: evaluated.length,
      conformantCaseCount: evaluated.filter((item) => item.conformant).length,
      nonconformantCaseCount: evaluated.filter((item) => !item.conformant).length,
      unevaluableCaseCount: conformance.length - evaluated.length,
    }),
    metrics: Object.freeze({
      eventCount: events.length,
      activityCount: activities.length,
      caseCount: cases.length,
      eventTypeCounts: countBy(events, (event) => event.eventType),
      caseStatusCounts: countBy(cases, (caseValue) => caseValue.status),
      activityDurations: deriveActivityDurationMetrics(activities),
    }),
    unresolved: Object.freeze({
      activityCaseActivityIds: Object.freeze(unresolvedActivityCaseIds.sort()),
      eventActivityEventIds: Object.freeze(unresolvedEventActivityIds.sort()),
    }),
  });
}
