import {plainDataSnapshot} from '../../../../foundation/plain-data-snapshot.mjs';

const FUNCTIONAL_PACK_IDS = Object.freeze(
  Array.from({ length: 24 }, (_, index) => `F${String(index).padStart(2, '0')}`),
);
const FUNCTIONAL_PACK_SET = new Set(FUNCTIONAL_PACK_IDS);
const APPLICATION_VIEW_CLASSES = Object.freeze([
  'CRM', 'ERP', 'WMS', 'MES', 'BPM', 'BI', 'DMS', 'PPM', 'TMS', 'FIN',
]);
const APPLICATION_VIEW_CLASS_SET = new Set(APPLICATION_VIEW_CLASSES);

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OrganizationNativeCapabilityError(`${label} must be a non-empty string`, 'INVALID_ORGANIZATION_NATIVE_FIELD');
  }
  return value.trim();
}

function requireStringList(value, label, { allowEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    throw new OrganizationNativeCapabilityError(`${label} must be an array`, 'INVALID_ORGANIZATION_NATIVE_FIELD');
  }
  value=plainDataSnapshot(value,{errorFactory:(message)=>new OrganizationNativeCapabilityError(message,'INVALID_ORGANIZATION_NATIVE_FIELD')});
  const normalized = [...new Set(value.map((entry) => requireText(entry, `${label} entry`)))].sort();
  if (!allowEmpty && normalized.length === 0) {
    throw new OrganizationNativeCapabilityError(`${label} must not be empty`, 'INVALID_ORGANIZATION_NATIVE_FIELD');
  }
  return Object.freeze(normalized);
}

function frozenRecord(value) {
  return Object.freeze(value);
}

function immutableSnapshot(value) {
  return plainDataSnapshot(value, {
    errorFactory: (message) => new OrganizationNativeCapabilityError(message, 'INVALID_OWNER_COMMAND_INPUT'),
  });
}

function assertUnique(map, id, code, label) {
  if (map.has(id)) throw new OrganizationNativeCapabilityError(`duplicate ${label}: ${id}`, code);
}

export { FUNCTIONAL_PACK_IDS, APPLICATION_VIEW_CLASSES };

export class OrganizationNativeCapabilityError extends Error {
  constructor(message, code = 'ORGANIZATION_NATIVE_CAPABILITY_ERROR') {
    super(message);
    this.name = 'OrganizationNativeCapabilityError';
    this.code = code;
  }
}

export class OrganizationNativeCapabilityRegistry {
  #packs = new Map();
  #patterns = new Map();
  #archetypes = new Map();
  #models = new Map();
  #productLines = new Map();
  #operations = new Map();
  #executionEvidence = new Map();
  #contributions = new Map();
  #contributionBindings = new Map();
  #evidenceLedger;

  constructor({ evidenceLedger = null } = {}) {
    if (evidenceLedger && typeof evidenceLedger.get !== 'function') {
      throw new OrganizationNativeCapabilityError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
    }
    this.#evidenceLedger = evidenceLedger;
  }

  registerFunctionalPack({ id, title, capabilityRefs = [] }) {
    const packId = requireText(id, 'pack.id');
    if (!FUNCTIONAL_PACK_SET.has(packId)) {
      throw new OrganizationNativeCapabilityError(`functional pack id must be F00..F23: ${packId}`, 'INVALID_FUNCTIONAL_PACK_ID');
    }
    assertUnique(this.#packs, packId, 'DUPLICATE_FUNCTIONAL_PACK', 'functional pack');
    const pack = frozenRecord({
      schema: 'IWXA_T2_FUNCTIONAL_PACK_V1',
      id: packId,
      title: requireText(title, 'pack.title'),
      capabilityRefs: requireStringList(capabilityRefs, 'pack.capabilityRefs'),
      nativeCapability: true,
      externalSystemRequired: false,
    });
    this.#packs.set(packId, pack);
    return pack;
  }

  registerProcessPattern({ id, title, requiredPackIds = [] }) {
    const patternId = requireText(id, 'pattern.id');
    assertUnique(this.#patterns, patternId, 'DUPLICATE_PROCESS_PATTERN', 'process pattern');
    const packs = this.#requireKnownPacks(requiredPackIds, 'pattern.requiredPackIds');
    const pattern = frozenRecord({
      schema: 'IWXA_T2_E2E_PROCESS_PATTERN_V1',
      id: patternId,
      title: requireText(title, 'pattern.title'),
      requiredPackIds: packs,
      reusablePattern: true,
      instanceData: false,
    });
    this.#patterns.set(patternId, pattern);
    return pattern;
  }

  registerCompanyArchetype({ id, title, materialClass, requiredPackIds = [], optionalPackIds = [] }) {
    const archetypeId = requireText(id, 'archetype.id');
    assertUnique(this.#archetypes, archetypeId, 'DUPLICATE_COMPANY_ARCHETYPE', 'company archetype');
    const required = this.#requireKnownPacks(requiredPackIds, 'archetype.requiredPackIds');
    const optional = this.#requireKnownPacks(optionalPackIds, 'archetype.optionalPackIds');
    if (required.some((packId) => optional.includes(packId))) {
      throw new OrganizationNativeCapabilityError('required and optional packs must not overlap', 'INVALID_ARCHETYPE_PACK_SET');
    }
    const archetype = frozenRecord({
      schema: 'IWXA_T2_COMPANY_ARCHETYPE_V1',
      id: archetypeId,
      title: requireText(title, 'archetype.title'),
      materialClass: requireText(materialClass, 'archetype.materialClass'),
      requiredPackIds: required,
      optionalPackIds: optional,
      referenceTemplate: true,
      authorityRoot: false,
      canonicalOntology: false,
    });
    this.#archetypes.set(archetypeId, archetype);
    return archetype;
  }

  registerOperatingModel({
    id,
    organizationId,
    rootUnitId,
    archetypeId,
    packIds,
    processPatternIds = [],
  }) {
    const modelId = requireText(id, 'operatingModel.id');
    assertUnique(this.#models, modelId, 'DUPLICATE_OPERATING_MODEL', 'operating model');
    const archetype = this.#requireArchetype(archetypeId);
    const selectedPacks = this.#requireKnownPacks(packIds, 'operatingModel.packIds');
    for (const requiredPackId of archetype.requiredPackIds) {
      if (!selectedPacks.includes(requiredPackId)) {
        throw new OrganizationNativeCapabilityError(
          `operating model ${modelId} is missing archetype-required pack ${requiredPackId}`,
          'MISSING_ARCHETYPE_REQUIRED_PACK',
        );
      }
    }
    const allowedPacks = new Set([...archetype.requiredPackIds, ...archetype.optionalPackIds]);
    for (const packId of selectedPacks) {
      if (!allowedPacks.has(packId)) {
        throw new OrganizationNativeCapabilityError(
          `pack ${packId} is outside archetype ${archetype.id}`,
          'PACK_OUTSIDE_ARCHETYPE',
        );
      }
    }
    const patternIds = requireStringList(processPatternIds, 'operatingModel.processPatternIds');
    for (const patternId of patternIds) {
      const pattern = this.#patterns.get(patternId);
      if (!pattern) {
        throw new OrganizationNativeCapabilityError(`unknown process pattern: ${patternId}`, 'UNKNOWN_PROCESS_PATTERN');
      }
      if (pattern.requiredPackIds.some((packId) => !selectedPacks.includes(packId))) {
        throw new OrganizationNativeCapabilityError(
          `process pattern ${patternId} requires packs not adopted by ${modelId}`,
          'PROCESS_PATTERN_PACK_MISMATCH',
        );
      }
    }
    const model = frozenRecord({
      schema: 'IWXA_T2_ORGANIZATION_OPERATING_MODEL_V1',
      id: modelId,
      organizationId: requireText(organizationId, 'operatingModel.organizationId'),
      rootUnitId: requireText(rootUnitId, 'operatingModel.rootUnitId'),
      archetypeId: archetype.id,
      materialClass: archetype.materialClass,
      packIds: selectedPacks,
      processPatternIds: Object.freeze([...patternIds]),
      semanticSpecialization: true,
      universalCompanyOntology: false,
      externalSystemRequired: false,
    });
    this.#models.set(modelId, model);
    return model;
  }

  registerProductLine({ id, title, operatingModelId }) {
    const productLineId = requireText(id, 'productLine.id');
    assertUnique(this.#productLines, productLineId, 'DUPLICATE_PRODUCT_LINE', 'product line');
    const model = this.#requireModel(operatingModelId);
    const productLine = frozenRecord({
      schema: 'IWXA_T2_PRODUCT_LINE_V1',
      id: productLineId,
      title: requireText(title, 'productLine.title'),
      operatingModelId: model.id,
      organizationId: model.organizationId,
    });
    this.#productLines.set(productLineId, productLine);
    return productLine;
  }

  registerOperationBinding({
    id,
    productLineId,
    family,
    ownerId,
    commandId,
    inputSchema,
    outputSchema = null,
  }) {
    const operationId = requireText(id, 'operation.id');
    assertUnique(this.#operations, operationId, 'DUPLICATE_PRODUCT_LINE_OPERATION', 'product line operation');
    const productLine = this.#productLines.get(requireText(productLineId, 'operation.productLineId'));
    if (!productLine) {
      throw new OrganizationNativeCapabilityError(`unknown product line: ${productLineId}`, 'UNKNOWN_PRODUCT_LINE');
    }
    if(typeof commandId==='string'&&/(^|[.:/])putObject$/i.test(commandId.trim())){
      throw new OrganizationNativeCapabilityError('generic putObject is not a domain operation','GENERIC_WORKSPACE_COMMAND_FORBIDDEN');
    }
    const operation = frozenRecord({
      schema: 'IWXA_T2_DOMAIN_NATIVE_OPERATION_BINDING_V1',
      id: operationId,
      productLineId: productLine.id,
      family: requireText(family, 'operation.family'),
      ownerId: requireText(ownerId, 'operation.ownerId'),
      commandId: requireText(commandId, 'operation.commandId'),
      inputSchema: requireText(inputSchema, 'operation.inputSchema'),
      outputSchema: outputSchema == null ? null : requireText(outputSchema, 'operation.outputSchema'),
      exactBinding: true,
      genericWorkspaceWrite: false,
    });
    this.#operations.set(operationId, operation);
    return operation;
  }

  recordExecutionEvidence({ operationId, evidenceRefs }) {
    const operation = this.#requireOperation(operationId);
    const refs = requireStringList(evidenceRefs, 'execution.evidenceRefs', { allowEmpty: false });
    for (const ref of refs) this.#assertEvidence(ref);
    const existing=this.#executionEvidence.get(operation.id);
    const accumulated=Object.freeze([...new Set([
      ...(existing?.evidenceRefs ?? []),
      ...refs,
    ])].sort());
    const proof = frozenRecord({
      schema: 'IWXA_T2_OPERATION_EXECUTION_EVIDENCE_V1',
      operationId: operation.id,
      evidenceRefs: accumulated,
      executionProven: true,
      monotonicEvidence: true,
    });
    this.#executionEvidence.set(operation.id, proof);
    return proof;
  }

  workspaceCommandDescriptor(operationId, { workspaceId, input }) {
    const operation = this.#requireOperation(operationId);
    return frozenRecord({
      schema: 'IWXA_T2_OWNER_SCOPED_WORKSPACE_COMMAND_V1',
      workspaceId: requireText(workspaceId, 'workspaceId'),
      operationId: operation.id,
      family: operation.family,
      ownerId: operation.ownerId,
      commandId: operation.commandId,
      inputSchema: operation.inputSchema,
      input: immutableSnapshot(input),
      execute: false,
      genericPutObject: false,
    });
  }

  registerContributionRequirement({ id, title, requiredPackIds = [] }) {
    const contributionId = requireText(id, 'contribution.id');
    assertUnique(this.#contributions, contributionId, 'DUPLICATE_DOMAIN_CONTRIBUTION', 'domain contribution');
    const contribution = frozenRecord({
      schema: 'IWXA_T2_DOMAIN_CONTRIBUTION_REQUIREMENT_V1',
      id: contributionId,
      title: requireText(title, 'contribution.title'),
      requiredPackIds: this.#requireKnownPacks(requiredPackIds, 'contribution.requiredPackIds'),
      adoptionRequirement: true,
    });
    this.#contributions.set(contributionId, contribution);
    return contribution;
  }

  bindContribution({ contributionId, operationId }) {
    const contribution = this.#requireContribution(contributionId);
    const operation = this.#requireOperation(operationId);
    const productLine=this.#requireProductLine(operation.productLineId);
    const model=this.#requireModel(productLine.operatingModelId);
    const missingPacks=contribution.requiredPackIds.filter((packId)=>!model.packIds.includes(packId));
    if (missingPacks.length > 0) {
      throw new OrganizationNativeCapabilityError(
        `operation ${operation.id} belongs to an operating model missing contribution packs: ${missingPacks.join(',')}`,
        'CONTRIBUTION_PACK_REQUIREMENT_MISMATCH',
      );
    }
    const existing=this.#contributionBindings.get(contribution.id);
    if (existing) {
      if (existing.operationId !== operation.id) {
        throw new OrganizationNativeCapabilityError(
          `contribution ${contribution.id} is already bound to ${existing.operationId}`,
          'CONTRIBUTION_BINDING_IMMUTABLE',
        );
      }
      return this.contributionStatus(contribution.id);
    }
    const binding = frozenRecord({ contributionId: contribution.id, operationId: operation.id });
    this.#contributionBindings.set(contribution.id, binding);
    return this.contributionStatus(contribution.id);
  }

  contributionStatus(contributionId) {
    const contribution = this.#requireContribution(contributionId);
    const binding = this.#contributionBindings.get(contribution.id) ?? null;
    if (!binding) {
      return frozenRecord({
        contributionId: contribution.id,
        state: 'ADOPTION_REQUIREMENT',
        exactOperationBound: false,
        executionEvidencePresent: false,
      });
    }
    const evidence = this.#executionEvidence.get(binding.operationId) ?? null;
    return frozenRecord({
      contributionId: contribution.id,
      operationId: binding.operationId,
      state: evidence ? 'ADOPTED_BY_EVIDENCE' : 'BOUND_PENDING_EXECUTION_EVIDENCE',
      exactOperationBound: true,
      executionEvidencePresent: Boolean(evidence),
      evidenceRefs: evidence?.evidenceRefs ?? Object.freeze([]),
    });
  }

  applicationClassView({ operatingModelId, applicationClass }) {
    const model = this.#requireModel(operatingModelId);
    const normalizedClass = requireText(applicationClass, 'applicationClass').toUpperCase();
    if (!APPLICATION_VIEW_CLASS_SET.has(normalizedClass)) {
      throw new OrganizationNativeCapabilityError(`unsupported application-class view: ${normalizedClass}`, 'UNKNOWN_APPLICATION_VIEW_CLASS');
    }
    const productLineIds = [...this.#productLines.values()]
      .filter((line) => line.operatingModelId === model.id)
      .map((line) => line.id)
      .sort();
    return frozenRecord({
      schema: 'IWXA_T2_APPLICATION_CLASS_VIEW_V1',
      applicationClass: normalizedClass,
      operatingModelId: model.id,
      organizationId: model.organizationId,
      packIds: model.packIds,
      processPatternIds: model.processPatternIds,
      productLineIds: Object.freeze(productLineIds),
      persisted: false,
      derivedView: true,
      sourceTruth: false,
      authorityRoot: false,
      canonicalOntology: false,
      externalSystemRequired: false,
    });
  }

  nativeCapabilityFloor(operatingModelId) {
    const model = this.#requireModel(operatingModelId);
    return frozenRecord({
      operatingModelId: model.id,
      packIds: model.packIds,
      processPatternIds: model.processPatternIds,
      nativeCapability: true,
      externalErpCrmRequired: false,
      sourceTruthOwnedByExternalSystem: false,
    });
  }

  proveCommonSubstrate({ packId, operatingModelIds }) {
    const pack = this.#requirePack(packId);
    const modelIds = requireStringList(operatingModelIds, 'operatingModelIds', { allowEmpty: false });
    const models = modelIds.map((id) => this.#requireModel(id));
    if (models.some((model) => !model.packIds.includes(pack.id))) {
      throw new OrganizationNativeCapabilityError(
        `common claim requires every adopter to contain ${pack.id}`,
        'COMMON_SUBSTRATE_NOT_ADOPTED_BY_ALL',
      );
    }
    const materialClasses = [...new Set(models.map((model) => model.materialClass))].sort();
    if (materialClasses.length < 2) {
      throw new OrganizationNativeCapabilityError(
        'common capability claim requires materially different archetypes',
        'INSUFFICIENT_ARCHETYPE_DIVERSITY',
      );
    }
    return frozenRecord({
      schema: 'IWXA_T2_COMMON_SUBSTRATE_CLAIM_V1',
      packId: pack.id,
      operatingModelIds: Object.freeze([...modelIds]),
      materialClasses: Object.freeze(materialClasses),
      multiArchetypeEvidenceRequired: true,
      commonClaimAccepted: true,
    });
  }

  #requireKnownPacks(packIds, label) {
    const normalized = requireStringList(packIds, label);
    for (const packId of normalized) this.#requirePack(packId);
    return normalized;
  }

  #requirePack(packId) {
    const id = requireText(packId, 'packId');
    const pack = this.#packs.get(id);
    if (!pack) throw new OrganizationNativeCapabilityError(`unknown functional pack: ${id}`, 'UNKNOWN_FUNCTIONAL_PACK');
    return pack;
  }

  #requireArchetype(archetypeId) {
    const id = requireText(archetypeId, 'archetypeId');
    const archetype = this.#archetypes.get(id);
    if (!archetype) throw new OrganizationNativeCapabilityError(`unknown company archetype: ${id}`, 'UNKNOWN_COMPANY_ARCHETYPE');
    return archetype;
  }

  #requireModel(operatingModelId) {
    const id = requireText(operatingModelId, 'operatingModelId');
    const model = this.#models.get(id);
    if (!model) throw new OrganizationNativeCapabilityError(`unknown operating model: ${id}`, 'UNKNOWN_OPERATING_MODEL');
    return model;
  }

  #requireProductLine(productLineId) {
    const id = requireText(productLineId, 'productLineId');
    const productLine = this.#productLines.get(id);
    if (!productLine) throw new OrganizationNativeCapabilityError(`unknown product line: ${id}`, 'UNKNOWN_PRODUCT_LINE');
    return productLine;
  }

  #requireOperation(operationId) {
    const id = requireText(operationId, 'operationId');
    const operation = this.#operations.get(id);
    if (!operation) throw new OrganizationNativeCapabilityError(`unknown operation binding: ${id}`, 'UNKNOWN_OPERATION_BINDING');
    return operation;
  }

  #requireContribution(contributionId) {
    const id = requireText(contributionId, 'contributionId');
    const contribution = this.#contributions.get(id);
    if (!contribution) throw new OrganizationNativeCapabilityError(`unknown domain contribution: ${id}`, 'UNKNOWN_DOMAIN_CONTRIBUTION');
    return contribution;
  }

  #assertEvidence(evidenceId) {
    if (!this.#evidenceLedger) throw new OrganizationNativeCapabilityError('execution proof requires an evidence ledger','EXECUTION_EVIDENCE_LEDGER_REQUIRED');
    try {
      const record=this.#evidenceLedger.get(evidenceId);
      if(!record||typeof record!=='object'||Array.isArray(record)||typeof record.then==='function'||record.id!==evidenceId){
        throw new Error('missing or mismatched evidence record');
      }
      return evidenceId;
    } catch {
      throw new OrganizationNativeCapabilityError(`unknown evidence record: ${evidenceId}`, 'UNKNOWN_OPERATION_EVIDENCE');
    }
  }
}
