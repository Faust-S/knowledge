import test from 'node:test';
import assert from 'node:assert/strict';
import { ExactMoney, ExactQuantity } from '../src/foundation/quantity-money.mjs';
import { MemoryCanonicalAdapter, OwnerWriteGateway } from '../src/persistence/canonical-persistence.mjs';
import {
  derivePortfolioProjectMembership,
  deriveProjectEconomicsTotals,
  normalizeCapacity,
  normalizePortfolio,
  normalizeProgram,
  normalizeProjectEconomics,
  normalizeResource,
} from '../src/modules/base/features/project-process/project-portfolio-resources.mjs';
import {
  PROJECT_PORTFOLIO_RESOURCE_OWNER,
  PROJECT_PORTFOLIO_RESOURCE_WRITE_BOUNDARY,
  ProjectPortfolioResourceOwner,
  ProjectPortfolioResourceOwnerError,
  isProjectPortfolioResourceRecord,
  registerProjectPortfolioResourceOwner,
} from '../src/modules/base/owners/project-portfolio-resources.mjs';

test('C3 Program and Portfolio remain bounded read semantics without inventing write authority', () => {
  const program = normalizeProgram({
    workspaceId: 'w', programId: 'program-1', name: 'Program 1', domainApplicability: ['generic'], projectIds: ['project-2', 'project-1'],
  });
  const portfolio = normalizePortfolio({
    workspaceId: 'w', portfolioId: 'portfolio-1', name: 'Portfolio 1', domainApplicability: ['generic'], programIds: ['program-1'], projectIds: ['project-3'],
  });
  const derived = derivePortfolioProjectMembership({ portfolio, programs: [program] });
  assert.equal(program.sourceTruth, true);
  assert.equal(portfolio.sourceTruth, true);
  assert.equal(derived.sourceTruth, false);
  assert.equal(derived.derived, true);
  assert.equal(derived.complete, true);
  assert.deepEqual(derived.projectIds, ['project-1', 'project-2', 'project-3']);
});

test('C3 Portfolio aggregation fails closed when a referenced Program is unavailable', () => {
  const portfolio = normalizePortfolio({
    workspaceId: 'w', portfolioId: 'portfolio-1', name: 'Portfolio 1', domainApplicability: ['generic'], programIds: ['missing-program'],
  });
  const derived = derivePortfolioProjectMembership({ portfolio, programs: [] });
  assert.equal(derived.complete, false);
  assert.deepEqual(derived.projectIds, []);
  assert.deepEqual(derived.unresolvedProgramIds, ['missing-program']);
  assert.throws(
    () => normalizeResource({ workspaceId: 'w', resourceId: 'r', name: 'R', resourceType: 'person', domainApplicability: [] }),
    (error) => error?.code === 'INVALID_PROJECT_PROCESS_FIELD',
  );
});

test('C3 Resource capacity preserves exact quantity as read semantics', () => {
  const resource = normalizeResource({ workspaceId: 'w', resourceId: 'resource-1', name: 'Engineer', resourceType: 'person', domainApplicability: ['generic'] });
  const capacity = normalizeCapacity({
    workspaceId: 'w', capacityId: 'capacity-1', resourceId: resource.resourceId, projectId: 'project-1', workId: 'work-1',
    capacityType: 'allocated', domainApplicability: ['generic'], quantity: new ExactQuantity('7.5', 'hour'),
    period: { from: '2026-09-16T00:00:00Z', to: '2026-09-17T00:00:00Z' },
  });
  assert.ok(capacity.quantity instanceof ExactQuantity);
  assert.equal(capacity.quantity.value.toString(), '7.5');
  assert.equal(capacity.quantity.unit, 'hour');
  assert.equal(capacity.sourceTruth, true);
});

test('C3 Project economics retains exact money and derived totals never perform implicit FX conversion', () => {
  const economics = normalizeProjectEconomics({
    workspaceId: 'w', economicsId: 'economics-1', projectId: 'project-1', domainApplicability: ['generic'],
    entries: [
      { entryId: 'actual-usd-1', kind: 'actual', amount: new ExactMoney('10', 'USD'), effectiveAt: '2026-09-15T00:00:00Z', evidenceRefs: ['invoice:1'] },
      { entryId: 'actual-usd-2', kind: 'actual', amount: new ExactMoney('2.50', 'USD'), effectiveAt: '2026-09-16T00:00:00Z', evidenceRefs: ['invoice:2'] },
      { entryId: 'actual-eur-1', kind: 'actual', amount: new ExactMoney('3', 'EUR'), effectiveAt: '2026-09-16T00:00:00Z', evidenceRefs: ['invoice:3'] },
    ],
  });
  const totals = deriveProjectEconomicsTotals(economics);
  assert.equal(totals.sourceTruth, false);
  assert.equal(totals.currencyConversionPerformed, false);
  assert.equal(totals.lines.length, 2);
  assert.equal(totals.lines.find((line) => line.currency === 'USD').amount.amount.toString(), '12.5');
  assert.equal(totals.lines.find((line) => line.currency === 'EUR').amount.amount.toString(), '3');
});

test('C3 Program/Portfolio/Resource write boundary is quarantined with the same unbound provisional owner', () => {
  assert.equal(PROJECT_PORTFOLIO_RESOURCE_WRITE_BOUNDARY.status, 'QUARANTINED_UNBOUND');
  assert.equal(PROJECT_PORTFOLIO_RESOURCE_WRITE_BOUNDARY.authorityBound, false);
  assert.equal(PROJECT_PORTFOLIO_RESOURCE_WRITE_BOUNDARY.writesAuthorized, false);
  assert.equal(PROJECT_PORTFOLIO_RESOURCE_WRITE_BOUNDARY.readModelAvailable, true);
  assert.equal(PROJECT_PORTFOLIO_RESOURCE_OWNER.ownerId, null);
  assert.equal(PROJECT_PORTFOLIO_RESOURCE_OWNER.provisionalOwnerId, 'iwxa.project-process.owner');
  assert.equal(Object.values(PROJECT_PORTFOLIO_RESOURCE_OWNER.kinds).every((kind) => kind.commands.length === 0), true);
});

test('C3 Program/Portfolio/Resource owner registration fails closed without registering persistent families', () => {
  const gateway = new OwnerWriteGateway({ adapter: new MemoryCanonicalAdapter() });
  assert.throws(
    () => registerProjectPortfolioResourceOwner(gateway),
    (error) => error instanceof ProjectPortfolioResourceOwnerError && error.code === 'PROJECT_PORTFOLIO_RESOURCE_WRITE_OWNER_UNBOUND',
  );
  for (const kind of Object.values(PROJECT_PORTFOLIO_RESOURCE_OWNER.kinds)) assert.equal(gateway.owners.registration(kind.family), null);
  assert.throws(
    () => new ProjectPortfolioResourceOwner({ gateway }),
    (error) => error instanceof ProjectPortfolioResourceOwnerError && error.code === 'PROJECT_PORTFOLIO_RESOURCE_WRITE_OWNER_UNBOUND',
  );
  assert.equal(isProjectPortfolioResourceRecord({ family: 'iwxa.program', ownerId: 'iwxa.project-process.owner' }), false);
});
