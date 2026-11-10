import { CanonicalInstant } from '../../../../foundation/time.mjs';
import { ExactMoney, ExactQuantity } from '../../../../foundation/quantity-money.mjs';
import { ProjectProcessSemanticError } from './project-process.mjs';

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProjectProcessSemanticError(`${label} must be a non-empty string`, 'INVALID_PROJECT_PROCESS_FIELD');
  }
  return value.trim();
}

function optionalText(value, label) {
  return value == null ? null : requireText(value, label);
}

function uniqueTexts(values, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(values) || (nonEmpty && values.length === 0)) {
    throw new ProjectProcessSemanticError(`${label} must be ${nonEmpty ? 'a non-empty ' : 'an '}array`, 'INVALID_PROJECT_PROCESS_FIELD');
  }
  const normalized = values.map((value) => requireText(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new ProjectProcessSemanticError(`${label} must not contain duplicates`, 'DUPLICATE_PROJECT_PROCESS_REF');
  }
  return Object.freeze(normalized);
}

function base(kind, input) {
  return {
    sourceTruth: true,
    objectKind: kind,
    workspaceId: requireText(input.workspaceId, 'workspaceId'),
    domainApplicability: uniqueTexts(input.domainApplicability, 'domainApplicability', { nonEmpty: true }),
  };
}

function asInstant(value, label) {
  try {
    return value instanceof CanonicalInstant ? value : CanonicalInstant.parse(value);
  } catch {
    throw new ProjectProcessSemanticError(`${label} must be a canonical instant`, 'INVALID_PROJECT_PROCESS_TIME');
  }
}

function asQuantity(value, label) {
  try {
    const quantity = value instanceof ExactQuantity ? value : new ExactQuantity(value?.value, value?.unit);
    if (quantity.value.compare('0') < 0) {
      throw new ProjectProcessSemanticError(`${label} must not be negative`, 'NEGATIVE_CAPACITY');
    }
    return quantity;
  } catch (error) {
    if (error instanceof ProjectProcessSemanticError) throw error;
    throw new ProjectProcessSemanticError(`${label} must be an exact quantity`, 'INVALID_CAPACITY_QUANTITY');
  }
}

function asMoney(value, label) {
  try {
    return value instanceof ExactMoney ? value : new ExactMoney(value?.amount, value?.currency);
  } catch {
    throw new ProjectProcessSemanticError(`${label} must be exact money`, 'INVALID_PROJECT_ECONOMICS_AMOUNT');
  }
}

export function normalizeProgram(input) {
  return Object.freeze({
    schema: 'IWXA_T2_PROGRAM_V1',
    ...base('program', input),
    programId: requireText(input.programId, 'programId'),
    name: requireText(input.name, 'name'),
    status: requireText(input.status ?? 'planned', 'status'),
    projectIds: uniqueTexts(input.projectIds, 'projectIds', { nonEmpty: true }),
  });
}

export function normalizePortfolio(input) {
  const programIds = uniqueTexts(input.programIds ?? [], 'programIds');
  const projectIds = uniqueTexts(input.projectIds ?? [], 'projectIds');
  if (programIds.length === 0 && projectIds.length === 0) {
    throw new ProjectProcessSemanticError('portfolio requires at least one Program or Project member', 'EMPTY_PORTFOLIO');
  }
  return Object.freeze({
    schema: 'IWXA_T2_PORTFOLIO_V1',
    ...base('portfolio', input),
    portfolioId: requireText(input.portfolioId, 'portfolioId'),
    name: requireText(input.name, 'name'),
    status: requireText(input.status ?? 'active', 'status'),
    programIds,
    projectIds,
  });
}

export function normalizeResource(input) {
  return Object.freeze({
    schema: 'IWXA_T2_RESOURCE_V1',
    ...base('resource', input),
    resourceId: requireText(input.resourceId, 'resourceId'),
    name: requireText(input.name, 'name'),
    resourceType: requireText(input.resourceType, 'resourceType'),
    status: requireText(input.status ?? 'active', 'status'),
  });
}

export function normalizeCapacity(input) {
  if (!input.period || typeof input.period !== 'object' || Array.isArray(input.period)) {
    throw new ProjectProcessSemanticError('period must be an object', 'INVALID_CAPACITY_PERIOD');
  }
  const from = asInstant(input.period.from, 'period.from');
  const to = asInstant(input.period.to, 'period.to');
  if (from.compare(to) >= 0) {
    throw new ProjectProcessSemanticError('capacity period.from must be before period.to', 'INVALID_CAPACITY_PERIOD');
  }
  return Object.freeze({
    schema: 'IWXA_T2_RESOURCE_CAPACITY_V1',
    ...base('capacity', input),
    capacityId: requireText(input.capacityId, 'capacityId'),
    resourceId: requireText(input.resourceId, 'resourceId'),
    projectId: optionalText(input.projectId, 'projectId'),
    workId: optionalText(input.workId, 'workId'),
    capacityType: requireText(input.capacityType, 'capacityType'),
    quantity: asQuantity(input.quantity, 'quantity'),
    period: Object.freeze({ from, to }),
  });
}

function normalizeEconomicsEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectProcessSemanticError('project economics entry must be an object', 'INVALID_PROJECT_ECONOMICS_ENTRY');
  }
  return Object.freeze({
    entryId: requireText(value.entryId, 'entry.entryId'),
    kind: requireText(value.kind, 'entry.kind'),
    amount: asMoney(value.amount, 'entry.amount'),
    effectiveAt: asInstant(value.effectiveAt, 'entry.effectiveAt'),
    evidenceRefs: uniqueTexts(value.evidenceRefs ?? [], 'entry.evidenceRefs'),
  });
}

export function normalizeProjectEconomics(input) {
  if (!Array.isArray(input.entries) || input.entries.length === 0) {
    throw new ProjectProcessSemanticError('project economics requires at least one entry', 'EMPTY_PROJECT_ECONOMICS');
  }
  const entries = Object.freeze(input.entries.map(normalizeEconomicsEntry));
  const entryIds = entries.map((entry) => entry.entryId);
  if (new Set(entryIds).size !== entryIds.length) {
    throw new ProjectProcessSemanticError('project economics entryId values must be unique', 'DUPLICATE_PROJECT_ECONOMICS_ENTRY');
  }
  return Object.freeze({
    schema: 'IWXA_T2_PROJECT_ECONOMICS_V1',
    ...base('projectEconomics', input),
    economicsId: requireText(input.economicsId, 'economicsId'),
    projectId: requireText(input.projectId, 'projectId'),
    entries,
  });
}

export const PROJECT_PORTFOLIO_RESOURCE_NORMALIZERS = Object.freeze({
  program: normalizeProgram,
  portfolio: normalizePortfolio,
  resource: normalizeResource,
  capacity: normalizeCapacity,
  projectEconomics: normalizeProjectEconomics,
});

export function derivePortfolioProjectMembership({ portfolio, programs = [] }) {
  if (!portfolio || portfolio.objectKind !== 'portfolio') {
    throw new ProjectProcessSemanticError('normalized Portfolio is required', 'INVALID_PORTFOLIO_AGGREGATION_INPUT');
  }
  if (!Array.isArray(programs)) {
    throw new ProjectProcessSemanticError('programs must be an array', 'INVALID_PORTFOLIO_AGGREGATION_INPUT');
  }
  const byId = new Map();
  for (const program of programs) {
    if (!program || program.objectKind !== 'program' || program.workspaceId !== portfolio.workspaceId) {
      throw new ProjectProcessSemanticError('program aggregation must stay within the Portfolio workspace', 'CROSS_WORKSPACE_PROJECT_PROCESS_RELATION');
    }
    byId.set(program.programId, program);
  }
  const unresolvedProgramIds = portfolio.programIds.filter((programId) => !byId.has(programId));
  const projectIds = new Set(portfolio.projectIds);
  for (const programId of portfolio.programIds) {
    const program = byId.get(programId);
    if (program) for (const projectId of program.projectIds) projectIds.add(projectId);
  }
  return Object.freeze({
    schema: 'IWXA_T2_PORTFOLIO_PROJECT_MEMBERSHIP_V1',
    derived: true,
    sourceTruth: false,
    portfolioId: portfolio.portfolioId,
    complete: unresolvedProgramIds.length === 0,
    projectIds: Object.freeze([...projectIds].sort()),
    unresolvedProgramIds: Object.freeze([...unresolvedProgramIds].sort()),
  });
}

export function deriveProjectEconomicsTotals(economics) {
  if (!economics || economics.objectKind !== 'projectEconomics') {
    throw new ProjectProcessSemanticError('normalized ProjectEconomics is required', 'INVALID_PROJECT_ECONOMICS_INPUT');
  }
  const totals = new Map();
  for (const entry of economics.entries) {
    const key = `${entry.kind}\u0000${entry.amount.currency}`;
    const current = totals.get(key);
    totals.set(key, current ? current.add(entry.amount) : entry.amount);
  }
  const lines = [...totals.entries()].map(([key, amount]) => {
    const [kind, currency] = key.split('\u0000');
    return Object.freeze({ kind, currency, amount });
  }).sort((left, right) => left.kind.localeCompare(right.kind) || left.currency.localeCompare(right.currency));
  return Object.freeze({
    schema: 'IWXA_T2_PROJECT_ECONOMICS_TOTALS_V1',
    derived: true,
    sourceTruth: false,
    projectId: economics.projectId,
    economicsId: economics.economicsId,
    currencyConversionPerformed: false,
    lines: Object.freeze(lines),
  });
}
