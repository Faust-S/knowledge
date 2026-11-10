import { plainDataSnapshot } from '../../../../foundation/plain-data-snapshot.mjs';
import { BitemporalFact } from '../../../../foundation/bitemporal.mjs';

const SOURCE_KINDS = new Set(['1C', 'GENERAL']);
const TARGET_ROLES = new Set(['identifier', 'artifact', 'domain-field']);
const RESERVED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new JurisdictionSourceProfileError(`${label} must be a non-empty string`, 'INVALID_JURISDICTION_SOURCE_FIELD');
  }
  return value.trim();
}

function normalizeCountryCode(value) {
  const code = requireText(value, 'countryCode').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new JurisdictionSourceProfileError('countryCode must be a two-letter uppercase code', 'INVALID_COUNTRY_CODE');
  }
  return code;
}

function normalizeDescriptorList(value, label) {
  if (!Array.isArray(value)) {
    throw new JurisdictionSourceProfileError(`${label} must be an array`, 'INVALID_JURISDICTION_SOURCE_FIELD');
  }
  const byId = new Map();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new JurisdictionSourceProfileError(`${label} entries must be objects`, 'INVALID_JURISDICTION_SOURCE_FIELD');
    }
    const id = requireText(entry.id, `${label}.id`);
    if (byId.has(id)) {
      throw new JurisdictionSourceProfileError(`duplicate ${label} id: ${id}`, 'DUPLICATE_PROFILE_DESCRIPTOR');
    }
    byId.set(id, Object.freeze({
      id,
      scheme: entry.scheme == null ? null : requireText(entry.scheme, `${label}.scheme`),
      label: entry.label == null ? null : String(entry.label),
    }));
  }
  return Object.freeze([...byId.values()].sort((a, b) => a.id.localeCompare(b.id)));
}

function assertEvidence(ledger, provenanceId) {
  const id = requireText(provenanceId, 'provenanceId');
  if (!ledger) return id;
  if (typeof ledger.get !== 'function') {
    throw new JurisdictionSourceProfileError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
  }
  try {
    const record=ledger.get(id);
    if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.then === 'function' || record.id !== id) {
      throw new Error('evidence record does not identify the requested provenance');
    }
  }
  catch {
    throw new JurisdictionSourceProfileError(`unknown provenance record: ${id}`, 'UNKNOWN_JURISDICTION_SOURCE_PROVENANCE');
  }
  return id;
}

function deepFreezeClone(value) {
  return plainDataSnapshot(value, {
    errorFactory: (message) => new JurisdictionSourceProfileError(message, 'INVALID_JURISDICTION_SOURCE_VALUE'),
  });
}

function stableCanonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonical).join(',')}]`;
  const keys=Object.keys(value).sort();
  return `{${keys.map((key)=>`${JSON.stringify(key)}:${stableCanonical(value[key])}`).join(',')}}`;
}

function candidateTargetKey(candidate) {
  if (candidate.targetRole === 'identifier') return `identifier:${candidate.targetRef}`;
  if (candidate.targetRole === 'artifact') return `artifact:${candidate.targetRef}`;
  return `domain-field:${candidate.targetFamily}:${candidate.targetField}`;
}

function requireSourcePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JurisdictionSourceProfileError('sourcePayload must be an object', 'INVALID_SOURCE_PAYLOAD');
  }
  const proto=Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new JurisdictionSourceProfileError('sourcePayload must be a plain record', 'INVALID_SOURCE_PAYLOAD');
  }
  return value;
}

function splitPath(path) {
  const normalized = requireText(path, 'sourcePath');
  const segments = normalized.split('.');
  if (segments.some((segment) => segment === '' || RESERVED_PATH_SEGMENTS.has(segment))) {
    throw new JurisdictionSourceProfileError(`unsafe or empty source path: ${normalized}`, 'INVALID_SOURCE_PATH');
  }
  return Object.freeze(segments);
}

function readPath(source, path) {
  const segments = splitPath(path);
  let current = source;
  for (const segment of segments) {
    if (current == null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return Object.freeze({ present: false, value: null });
    }
    current = current[segment];
  }
  return Object.freeze({ present: true, value: deepFreezeClone(current) });
}

function normalizeRulePayload(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new JurisdictionSourceProfileError('rule payload must be an object', 'INVALID_JURISDICTION_RULE_PAYLOAD');
  }
  return deepFreezeClone(value);
}

function compareRule(left, right) {
  const effective = left.fact.effective.from.compare(right.fact.effective.from);
  if (effective !== 0) return effective;
  const knowledge = left.fact.knowledge.from.compare(right.fact.knowledge.from);
  if (knowledge !== 0) return knowledge;
  return left.id.localeCompare(right.id);
}

function normalizeMapping(mapping, profile) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    throw new JurisdictionSourceProfileError('adapter mapping must be an object', 'INVALID_SOURCE_ADAPTER_MAPPING');
  }
  const id = requireText(mapping.id, 'mapping.id');
  const sourcePath = requireText(mapping.sourcePath, 'mapping.sourcePath');
  splitPath(sourcePath);
  const targetRole = requireText(mapping.targetRole, 'mapping.targetRole');
  if (!TARGET_ROLES.has(targetRole)) {
    throw new JurisdictionSourceProfileError(`unsupported targetRole: ${targetRole}`, 'INVALID_SOURCE_ADAPTER_TARGET');
  }
  const required = mapping.required === true;

  if (targetRole === 'identifier') {
    const targetRef = requireText(mapping.targetRef, 'mapping.targetRef');
    if (!profile.identifierKinds.some((entry) => entry.id === targetRef)) {
      throw new JurisdictionSourceProfileError(`identifier target is not declared by profile: ${targetRef}`, 'UNDECLARED_PROFILE_IDENTIFIER');
    }
    return Object.freeze({ id, sourcePath, targetRole, targetRef, targetFamily: null, targetField: null, required });
  }

  if (targetRole === 'artifact') {
    const targetRef = requireText(mapping.targetRef, 'mapping.targetRef');
    if (!profile.artifactKinds.some((entry) => entry.id === targetRef)) {
      throw new JurisdictionSourceProfileError(`artifact target is not declared by profile: ${targetRef}`, 'UNDECLARED_PROFILE_ARTIFACT');
    }
    return Object.freeze({ id, sourcePath, targetRole, targetRef, targetFamily: null, targetField: null, required });
  }

  return Object.freeze({
    id,
    sourcePath,
    targetRole,
    targetRef: null,
    targetFamily: requireText(mapping.targetFamily, 'mapping.targetFamily'),
    targetField: requireText(mapping.targetField, 'mapping.targetField'),
    required,
  });
}

export class JurisdictionSourceProfileError extends Error {
  constructor(message, code = 'JURISDICTION_SOURCE_PROFILE_ERROR') {
    super(message);
    this.name = 'JurisdictionSourceProfileError';
    this.code = code;
  }
}

export class JurisdictionSourceProfileRegistry {
  #profiles = new Map();
  #rules = new Map();
  #adapters = new Map();
  #evidenceLedger;

  constructor({ evidenceLedger = null } = {}) {
    if (evidenceLedger && typeof evidenceLedger.get !== 'function') {
      throw new JurisdictionSourceProfileError('evidenceLedger must provide get(id)', 'INVALID_EVIDENCE_LEDGER');
    }
    this.#evidenceLedger = evidenceLedger;
  }

  registerProfile({
    id,
    jurisdictionId,
    countryCode,
    authorityRef,
    identifierKinds = [],
    artifactKinds = [],
    profileClass = 'JURISDICTION_SOURCE',
  }) {
    const profileId = requireText(id, 'profile.id');
    if (this.#profiles.has(profileId)) {
      throw new JurisdictionSourceProfileError(`duplicate jurisdiction source profile: ${profileId}`, 'DUPLICATE_JURISDICTION_SOURCE_PROFILE');
    }
    const profile = Object.freeze({
      schema: 'IWXA_T2_JURISDICTION_SOURCE_PROFILE_V1',
      id: profileId,
      jurisdictionId: requireText(jurisdictionId, 'profile.jurisdictionId'),
      countryCode: normalizeCountryCode(countryCode),
      authorityRef: requireText(authorityRef, 'profile.authorityRef'),
      identifierKinds: normalizeDescriptorList(identifierKinds, 'identifierKinds'),
      artifactKinds: normalizeDescriptorList(artifactKinds, 'artifactKinds'),
      profileClass: requireText(profileClass, 'profile.profileClass'),
      sourceProfile: true,
      canonicalOntology: false,
      authorityRoot: false,
    });
    this.#profiles.set(profile.id, profile);
    return profile;
  }

  registerRuProfile(input) {
    if (!Array.isArray(input?.identifierKinds) || input.identifierKinds.length === 0) {
      throw new JurisdictionSourceProfileError('RU profile requires explicit identifier kinds', 'MISSING_RU_IDENTIFIER_KINDS');
    }
    if (!Array.isArray(input?.artifactKinds) || input.artifactKinds.length === 0) {
      throw new JurisdictionSourceProfileError('RU profile requires explicit artifact kinds', 'MISSING_RU_ARTIFACT_KINDS');
    }
    return this.registerProfile({
      ...input,
      countryCode: 'RU',
      profileClass: 'RU_JURISDICTION_SOURCE',
    });
  }

  specializationDescriptor(profileId) {
    const profile = this.profile(profileId);
    return Object.freeze({
      specializationId: profile.id,
      jurisdictionIds: Object.freeze([profile.jurisdictionId]),
      inferredParentApplicability: false,
    });
  }

  appendRule({ id, profileId, ruleKind, subjectRef, payload, effective, knowledge, provenanceId }) {
    const normalizedProfileId = requireText(profileId, 'rule.profileId');
    if (!this.#profiles.has(normalizedProfileId)) {
      throw new JurisdictionSourceProfileError(`unknown jurisdiction source profile: ${normalizedProfileId}`, 'UNKNOWN_JURISDICTION_SOURCE_PROFILE');
    }
    const ruleId = requireText(id, 'rule.id');
    if (this.#rules.has(ruleId)) {
      throw new JurisdictionSourceProfileError(`duplicate jurisdiction rule: ${ruleId}`, 'DUPLICATE_JURISDICTION_RULE');
    }
    const kind = requireText(ruleKind, 'rule.ruleKind');
    const subject = requireText(subjectRef, 'rule.subjectRef');
    const normalizedPayload = normalizeRulePayload(payload);
    const fact = new BitemporalFact({
      id: ruleId,
      payload: Object.freeze({ profileId: normalizedProfileId, ruleKind: kind, subjectRef: subject, payload: normalizedPayload }),
      effective,
      knowledge,
      provenanceId: assertEvidence(this.#evidenceLedger, provenanceId),
    });
    const rule = Object.freeze({
      id: fact.id,
      profileId: normalizedProfileId,
      ruleKind: kind,
      subjectRef: subject,
      payload: normalizedPayload,
      fact,
      provenanceId: fact.provenanceId,
    });
    this.#rules.set(rule.id, rule);
    return rule;
  }

  profile(id) {
    const profile = this.#profiles.get(requireText(id, 'profileId'));
    if (!profile) throw new JurisdictionSourceProfileError(`unknown jurisdiction source profile: ${id}`, 'UNKNOWN_JURISDICTION_SOURCE_PROFILE');
    return profile;
  }

  rulesAt({ profileId, effectiveAt, knownAt, ruleKind = null }) {
    const profile = this.profile(profileId);
    const kind = ruleKind == null ? null : requireText(ruleKind, 'ruleKind');
    return Object.freeze(
      [...this.#rules.values()]
        .filter((rule) => rule.profileId === profile.id)
        .filter((rule) => kind == null || rule.ruleKind === kind)
        .filter((rule) => rule.fact.isVisible({ effectiveAt, knownAt }))
        .sort(compareRule),
    );
  }

  snapshot({ profileId, effectiveAt, knownAt }) {
    const profile = this.profile(profileId);
    return Object.freeze({
      schema: 'IWXA_T2_JURISDICTION_SOURCE_PROFILE_SNAPSHOT_V1',
      profile,
      effectiveAt,
      knownAt,
      activeRules: this.rulesAt({ profileId: profileId, effectiveAt, knownAt }),
      selectedByPriority: false,
      inferredParentApplicability: false,
    });
  }

  registerAdapter({ id, sourceKind, sourceSchemaRef, profileId, mappings }) {
    const adapterId = requireText(id, 'adapter.id');
    if (this.#adapters.has(adapterId)) {
      throw new JurisdictionSourceProfileError(`duplicate source adapter profile: ${adapterId}`, 'DUPLICATE_SOURCE_ADAPTER_PROFILE');
    }
    const normalizedSourceKind = requireText(sourceKind, 'adapter.sourceKind').toUpperCase();
    if (!SOURCE_KINDS.has(normalizedSourceKind)) {
      throw new JurisdictionSourceProfileError('sourceKind must be 1C or GENERAL', 'INVALID_SOURCE_KIND');
    }
    const profile = this.profile(profileId);
    if (!Array.isArray(mappings) || mappings.length === 0) {
      throw new JurisdictionSourceProfileError('adapter requires at least one explicit mapping', 'MISSING_SOURCE_ADAPTER_MAPPING');
    }
    const normalizedMappings = mappings.map((mapping) => normalizeMapping(mapping, profile));
    const mappingIds = new Set();
    for (const mapping of normalizedMappings) {
      if (mappingIds.has(mapping.id)) {
        throw new JurisdictionSourceProfileError(`duplicate adapter mapping id: ${mapping.id}`, 'DUPLICATE_SOURCE_ADAPTER_MAPPING');
      }
      mappingIds.add(mapping.id);
    }
    const adapter = Object.freeze({
      schema: 'IWXA_T2_SOURCE_ADAPTER_PROFILE_V1',
      id: adapterId,
      sourceKind: normalizedSourceKind,
      sourceSchemaRef: requireText(sourceSchemaRef, 'adapter.sourceSchemaRef'),
      profileId: profile.id,
      mappings: Object.freeze(normalizedMappings),
      direction: 'READ_IMPORT',
      writeOwner: null,
      canonicalOntology: false,
      schemaInference: false,
      ontologyCapture: false,
    });
    this.#adapters.set(adapter.id, adapter);
    return adapter;
  }

  adapter(id) {
    const adapter = this.#adapters.get(requireText(id, 'adapterId'));
    if (!adapter) throw new JurisdictionSourceProfileError(`unknown source adapter profile: ${id}`, 'UNKNOWN_SOURCE_ADAPTER_PROFILE');
    return adapter;
  }

  readImportPreview({ adapterId, sourceRecordId, sourcePayload, effectiveAt, knownAt }) {
    const adapter = this.adapter(adapterId);
    const payload = deepFreezeClone(requireSourcePayload(sourcePayload));
    const profileSnapshot = this.snapshot({ profileId: adapter.profileId, effectiveAt, knownAt });
    const identifierCandidates = [];
    const artifactCandidates = [];
    const fieldCandidates = [];
    const missingRequiredMappingIds = [];
    const resolvedMappingIds = [];

    for (const mapping of adapter.mappings) {
      const resolved = readPath(payload, mapping.sourcePath);
      if (!resolved.present) {
        if (mapping.required) missingRequiredMappingIds.push(mapping.id);
        continue;
      }
      resolvedMappingIds.push(mapping.id);
      const candidate = Object.freeze({
        mappingId: mapping.id,
        sourcePath: mapping.sourcePath,
        value: resolved.value,
        targetRole: mapping.targetRole,
        targetRef: mapping.targetRef,
        targetFamily: mapping.targetFamily,
        targetField: mapping.targetField,
      });
      if (mapping.targetRole === 'identifier') identifierCandidates.push(candidate);
      else if (mapping.targetRole === 'artifact') artifactCandidates.push(candidate);
      else fieldCandidates.push(candidate);
    }

    const targetCandidates=new Map();
    for (const candidate of [...identifierCandidates, ...artifactCandidates, ...fieldCandidates]) {
      const key=candidateTargetKey(candidate);
      if (!targetCandidates.has(key)) targetCandidates.set(key,[]);
      targetCandidates.get(key).push(candidate);
    }
    const ambiguousTargetKeys=Object.freeze(
      [...targetCandidates.entries()]
        .filter(([,candidates])=>candidates.length > 1
          && new Set(candidates.map((candidate)=>stableCanonical(candidate.value))).size > 1)
        .map(([key])=>key)
        .sort(),
    );

    return Object.freeze({
      schema: 'IWXA_T2_SOURCE_READ_IMPORT_PREVIEW_V1',
      adapterId: adapter.id,
      sourceKind: adapter.sourceKind,
      sourceSchemaRef: adapter.sourceSchemaRef,
      jurisdictionProfileId: adapter.profileId,
      sourceEnvelope: Object.freeze({
        sourceRecordId: requireText(sourceRecordId, 'sourceRecordId'),
        payload,
      }),
      identifierCandidates: Object.freeze(identifierCandidates),
      artifactCandidates: Object.freeze(artifactCandidates),
      fieldCandidates: Object.freeze(fieldCandidates),
      qualification: Object.freeze({
        qualified: missingRequiredMappingIds.length === 0 && ambiguousTargetKeys.length === 0,
        missingRequiredMappingIds: Object.freeze(missingRequiredMappingIds.sort()),
        ambiguousTargetKeys,
        resolvedMappingIds: Object.freeze(resolvedMappingIds.sort()),
        activeRuleIds: Object.freeze(profileSnapshot.activeRules.map((rule) => rule.id)),
      }),
      writeRequested: false,
      writeAuthorized: false,
      ownerCommand: null,
      ownerCommandRequiredForCommit: true,
      sourcePayloadPreserved: true,
      undeclaredSourceFieldsPromoted: false,
      ontologyCapture: false,
      schemaInferred: false,
      ontologyMutationPlan: Object.freeze([]),
    });
  }
}
