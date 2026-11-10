const PROVISIONAL_OWNER_ID = 'iwxa.project-process.owner';
const BOUNDARY_EVIDENCE = 'OWNER_COMMAND_BOUNDARY_EVIDENCE_2026-09-13';

const SPECS = Object.freeze({
  program: Object.freeze({ family: 'iwxa.program', idField: 'programId' }),
  portfolio: Object.freeze({ family: 'iwxa.portfolio', idField: 'portfolioId' }),
  resource: Object.freeze({ family: 'iwxa.resource', idField: 'resourceId' }),
  capacity: Object.freeze({ family: 'iwxa.resource.capacity', idField: 'capacityId' }),
  projectEconomics: Object.freeze({ family: 'iwxa.project.economics', idField: 'economicsId' }),
});

export class ProjectPortfolioResourceOwnerError extends Error {
  constructor(message, code = 'PROJECT_PORTFOLIO_RESOURCE_OWNER_ERROR') {
    super(message);
    this.name = 'ProjectPortfolioResourceOwnerError';
    this.code = code;
  }
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function specFor(kind) {
  const spec = SPECS[kind];
  if (!spec) throw new ProjectPortfolioResourceOwnerError(`unsupported project aggregation kind ${String(kind)}`, 'UNKNOWN_PROJECT_AGGREGATION_KIND');
  return spec;
}

function writeOwnerUnbound() {
  return new ProjectPortfolioResourceOwnerError(
    'Program/Portfolio/Resource business write owner is not bound by current product authority',
    'PROJECT_PORTFOLIO_RESOURCE_WRITE_OWNER_UNBOUND',
  );
}

export const PROJECT_PORTFOLIO_RESOURCE_WRITE_BOUNDARY = Object.freeze({
  status: 'QUARANTINED_UNBOUND',
  authorityBound: false,
  writesAuthorized: false,
  readModelAvailable: true,
  ownerModuleFound: false,
  ownerCommandFound: false,
  schemaProducerBindingFound: false,
  provisionalOwnerId: PROVISIONAL_OWNER_ID,
  evidence: BOUNDARY_EVIDENCE,
});

export const PROJECT_PORTFOLIO_RESOURCE_OWNER = Object.freeze({
  ownerId: null,
  provisionalOwnerId: PROVISIONAL_OWNER_ID,
  schemaVersion: null,
  headKind: null,
  authorityBound: false,
  writesAuthorized: false,
  status: 'QUARANTINED_UNBOUND',
  evidence: BOUNDARY_EVIDENCE,
  kinds: Object.freeze(Object.fromEntries(Object.entries(SPECS).map(([kind, spec]) => [
    kind,
    Object.freeze({ ...spec, commands: Object.freeze([]), headKind: null, authorityBound: false, writesAuthorized: false }),
  ]))),
});

export function projectAggregationObjectId(kind, workspaceId, objectId) {
  specFor(kind);
  return `${kind}:${encodeURIComponent(requireText(workspaceId, 'workspaceId'))}:${encodeURIComponent(requireText(objectId, 'objectId'))}`;
}

export function registerProjectPortfolioResourceOwner(gateway) {
  if (!gateway || typeof gateway.registerOwner !== 'function' || !gateway.owners) {
    throw new TypeError('OwnerWriteGateway-compatible gateway is required');
  }
  throw writeOwnerUnbound();
}

export class ProjectPortfolioResourceOwner {
  constructor({ gateway }) {
    registerProjectPortfolioResourceOwner(gateway);
  }
  async create() { throw writeOwnerUnbound(); }
  async revise() { throw writeOwnerUnbound(); }
  async release() { throw writeOwnerUnbound(); }
  async load() { throw writeOwnerUnbound(); }
}

export function isProjectPortfolioResourceRecord() {
  return false;
}
