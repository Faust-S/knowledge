import test from 'node:test';
import assert from 'node:assert/strict';
import * as longitudinal from '../src/modules/base/features/longitudinal/index.mjs';
import * as organization from '../src/modules/base/features/organization/index.mjs';
import * as specialization from '../src/modules/base/features/specialization/index.mjs';

test('C4 public feature surface exports longitudinal history and durable-context policy', () => {
  assert.equal(typeof longitudinal.LongitudinalContextIndex, 'function');
  assert.equal(typeof longitudinal.normalizeLongitudinalContextAdmission, 'function');
  assert.equal(typeof longitudinal.evaluateLongitudinalContextEligibility, 'function');
  assert.equal(typeof longitudinal.planLongitudinalContextInvalidation, 'function');
  assert.equal(typeof longitudinal.LongitudinalContextUniverse, 'function');
});

test('C5 public feature surface exports organization substrate and native capability model', () => {
  assert.equal(typeof organization.OrganizationSubstrate, 'function');
  assert.equal(typeof organization.OrganizationNativeCapabilityRegistry, 'function');
  assert.ok(Array.isArray(organization.FUNCTIONAL_PACK_IDS));
  assert.equal(organization.FUNCTIONAL_PACK_IDS.length, 24);
});

test('C6 public feature surface exports both specialization layers', () => {
  assert.equal(typeof specialization.SourceJurisdictionSpecializationIndex, 'function');
  assert.equal(typeof specialization.JurisdictionSourceProfileRegistry, 'function');
});
