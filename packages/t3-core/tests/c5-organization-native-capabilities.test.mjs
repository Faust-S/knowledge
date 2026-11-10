import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPLICATION_VIEW_CLASSES,
  FUNCTIONAL_PACK_IDS,
  OrganizationNativeCapabilityError,
  OrganizationNativeCapabilityRegistry,
} from '../src/modules/base/features/organization/organization-native-capabilities.mjs';

function evidenceLedger() {
  const known = new Set(['run-order-1', 'run-close-1']);
  return { get(id) { if (!known.has(id)) throw new Error('missing'); return { id }; } };
}

function registry() {
  const value = new OrganizationNativeCapabilityRegistry({ evidenceLedger: evidenceLedger() });
  value.registerFunctionalPack({ id: 'F00', title: 'Identity floor', capabilityRefs: ['identity'] });
  value.registerFunctionalPack({ id: 'F01', title: 'Work execution', capabilityRefs: ['work'] });
  value.registerFunctionalPack({ id: 'F02', title: 'Inventory', capabilityRefs: ['inventory'] });
  value.registerProcessPattern({ id: 'order-to-close', title: 'Order to close', requiredPackIds: ['F00', 'F01'] });
  value.registerCompanyArchetype({
    id: 'service-org', title: 'Service organization', materialClass: 'service',
    requiredPackIds: ['F00'], optionalPackIds: ['F01'],
  });
  value.registerCompanyArchetype({
    id: 'manufacturing-org', title: 'Manufacturing organization', materialClass: 'manufacturing',
    requiredPackIds: ['F00'], optionalPackIds: ['F01', 'F02'],
  });
  return value;
}

test('C5 Functional Pack substrate is explicitly bounded to F00-F23', () => {
  assert.equal(FUNCTIONAL_PACK_IDS.length, 24);
  assert.equal(FUNCTIONAL_PACK_IDS[0], 'F00');
  assert.equal(FUNCTIONAL_PACK_IDS.at(-1), 'F23');
  const value = new OrganizationNativeCapabilityRegistry();
  assert.throws(
    () => value.registerFunctionalPack({ id: 'F24', title: 'out of range' }),
    (error) => error instanceof OrganizationNativeCapabilityError && error.code === 'INVALID_FUNCTIONAL_PACK_ID',
  );
});

test('C5 OOM is an organization-specific specialization with explicit adopted packs and process patterns', () => {
  const value = registry();
  const model = value.registerOperatingModel({
    id: 'oom-service', organizationId: 'org-1', rootUnitId: 'org-root', archetypeId: 'service-org',
    packIds: ['F00', 'F01'], processPatternIds: ['order-to-close'],
  });
  assert.equal(model.semanticSpecialization, true);
  assert.equal(model.universalCompanyOntology, false);
  assert.deepEqual(model.packIds, ['F00', 'F01']);

  assert.throws(
    () => value.registerOperatingModel({ id: 'invalid', organizationId: 'org-2', rootUnitId: 'x', archetypeId: 'manufacturing-org', packIds: ['F01'] }),
    (error) => error instanceof OrganizationNativeCapabilityError && error.code === 'MISSING_ARCHETYPE_REQUIRED_PACK',
  );
});

test('C5 CRM/ERP/etc are derived application-class views, never canonical ontology or external authority', () => {
  const value = registry();
  value.registerOperatingModel({
    id: 'oom-service', organizationId: 'org-1', rootUnitId: 'org-root', archetypeId: 'service-org', packIds: ['F00', 'F01'],
  });
  const view = value.applicationClassView({ operatingModelId: 'oom-service', applicationClass: 'erp' });
  assert.ok(APPLICATION_VIEW_CLASSES.includes('ERP'));
  assert.equal(view.applicationClass, 'ERP');
  assert.equal(view.derivedView, true);
  assert.equal(view.sourceTruth, false);
  assert.equal(view.authorityRoot, false);
  assert.equal(view.canonicalOntology, false);
  assert.equal(view.externalSystemRequired, false);
});

test('C5 native capability floor does not depend on an external ERP/CRM product', () => {
  const value = registry();
  value.registerOperatingModel({
    id: 'oom-service', organizationId: 'org-1', rootUnitId: 'org-root', archetypeId: 'service-org', packIds: ['F00', 'F01'],
  });
  const floor = value.nativeCapabilityFloor('oom-service');
  assert.equal(floor.nativeCapability, true);
  assert.equal(floor.externalErpCrmRequired, false);
  assert.equal(floor.sourceTruthOwnedByExternalSystem, false);
});

test('C5 Product Line resolves only exact owner-scoped operation contracts into Workspace command descriptors', () => {
  const value = registry();
  value.registerOperatingModel({
    id: 'oom-service', organizationId: 'org-1', rootUnitId: 'org-root', archetypeId: 'service-org', packIds: ['F00', 'F01'],
  });
  value.registerProductLine({ id: 'pl-orders', title: 'Orders', operatingModelId: 'oom-service' });
  const operation = value.registerOperationBinding({
    id: 'orders.accept', productLineId: 'pl-orders', family: 'orders', ownerId: 'domain.orders',
    commandId: 'orders.accept', inputSchema: 'orders.accept.input.v1', outputSchema: 'orders.accept.output.v1',
  });
  assert.equal(operation.genericWorkspaceWrite, false);

  const command = value.workspaceCommandDescriptor('orders.accept', { workspaceId: 'w', input: { orderId: 'o-1' } });
  assert.equal(command.family, 'orders');
  assert.equal(command.ownerId, 'domain.orders');
  assert.equal(command.commandId, 'orders.accept');
  assert.equal(command.execute, false);
  assert.equal(command.genericPutObject, false);
});

test('C5 Domain Contribution remains an adoption requirement until exact binding and execution evidence both exist', () => {
  const value = registry();
  value.registerOperatingModel({
    id: 'oom-service', organizationId: 'org-1', rootUnitId: 'org-root', archetypeId: 'service-org', packIds: ['F00', 'F01'],
  });
  value.registerProductLine({ id: 'pl-orders', title: 'Orders', operatingModelId: 'oom-service' });
  value.registerOperationBinding({
    id: 'orders.accept', productLineId: 'pl-orders', family: 'orders', ownerId: 'domain.orders',
    commandId: 'orders.accept', inputSchema: 'orders.accept.input.v1',
  });
  value.registerContributionRequirement({ id: 'DC-001', title: 'Accept order', requiredPackIds: ['F01'] });

  assert.equal(value.contributionStatus('DC-001').state, 'ADOPTION_REQUIREMENT');
  assert.equal(value.bindContribution({ contributionId: 'DC-001', operationId: 'orders.accept' }).state, 'BOUND_PENDING_EXECUTION_EVIDENCE');
  value.recordExecutionEvidence({ operationId: 'orders.accept', evidenceRefs: ['run-order-1'] });
  const adopted = value.contributionStatus('DC-001');
  assert.equal(adopted.state, 'ADOPTED_BY_EVIDENCE');
  assert.deepEqual(adopted.evidenceRefs, ['run-order-1']);

  assert.throws(
    () => value.recordExecutionEvidence({ operationId: 'orders.accept', evidenceRefs: ['missing-run'] }),
    (error) => error instanceof OrganizationNativeCapabilityError && error.code === 'UNKNOWN_OPERATION_EVIDENCE',
  );
});

test('C5 anti-distortion common-substrate claim requires materially different archetypes', () => {
  const value = registry();
  value.registerOperatingModel({
    id: 'oom-service-a', organizationId: 'org-a', rootUnitId: 'root-a', archetypeId: 'service-org', packIds: ['F00'],
  });
  value.registerOperatingModel({
    id: 'oom-service-b', organizationId: 'org-b', rootUnitId: 'root-b', archetypeId: 'service-org', packIds: ['F00'],
  });
  assert.throws(
    () => value.proveCommonSubstrate({ packId: 'F00', operatingModelIds: ['oom-service-a', 'oom-service-b'] }),
    (error) => error instanceof OrganizationNativeCapabilityError && error.code === 'INSUFFICIENT_ARCHETYPE_DIVERSITY',
  );

  value.registerOperatingModel({
    id: 'oom-manufacturing', organizationId: 'org-c', rootUnitId: 'root-c', archetypeId: 'manufacturing-org', packIds: ['F00', 'F02'],
  });
  const claim = value.proveCommonSubstrate({ packId: 'F00', operatingModelIds: ['oom-service-a', 'oom-manufacturing'] });
  assert.equal(claim.commonClaimAccepted, true);
  assert.deepEqual(claim.materialClasses, ['manufacturing', 'service']);
});


test('C5 contribution binding requires the operation model to contain every required Functional Pack', () => {
  const value=registry();
  value.registerOperatingModel({
    id:'oom-service-min', organizationId:'org-min', rootUnitId:'root-min',
    archetypeId:'service-org', packIds:['F00'],
  });
  value.registerProductLine({id:'pl-min',title:'Minimal line',operatingModelId:'oom-service-min'});
  value.registerOperationBinding({
    id:'minimal.accept',productLineId:'pl-min',family:'orders',ownerId:'domain.orders',
    commandId:'orders.accept',inputSchema:'orders.accept.input.v1',
  });
  value.registerContributionRequirement({id:'DC-F01',title:'Requires work execution',requiredPackIds:['F01']});
  assert.throws(
    ()=>value.bindContribution({contributionId:'DC-F01',operationId:'minimal.accept'}),
    (error)=>error instanceof OrganizationNativeCapabilityError
      && error.code==='CONTRIBUTION_PACK_REQUIREMENT_MISMATCH',
  );
});

test('C5 contribution binding is immutable once exact operation authority is selected', () => {
  const value=registry();
  value.registerOperatingModel({
    id:'oom-service',organizationId:'org-1',rootUnitId:'root',archetypeId:'service-org',
    packIds:['F00','F01'],
  });
  value.registerProductLine({id:'pl-orders',title:'Orders',operatingModelId:'oom-service'});
  for(const id of ['orders.accept','orders.close']){
    value.registerOperationBinding({
      id,productLineId:'pl-orders',family:'orders',ownerId:'domain.orders',
      commandId:id,inputSchema:`${id}.input.v1`,
    });
  }
  value.registerContributionRequirement({id:'DC-IMM',title:'Immutable authority',requiredPackIds:['F01']});
  assert.equal(
    value.bindContribution({contributionId:'DC-IMM',operationId:'orders.accept'}).operationId,
    'orders.accept',
  );
  assert.throws(
    ()=>value.bindContribution({contributionId:'DC-IMM',operationId:'orders.close'}),
    (error)=>error instanceof OrganizationNativeCapabilityError
      && error.code==='CONTRIBUTION_BINDING_IMMUTABLE',
  );
});

test('C5 execution evidence is monotonic and cannot erase earlier proof', () => {
  const value=registry();
  value.registerOperatingModel({
    id:'oom-service',organizationId:'org-1',rootUnitId:'root',archetypeId:'service-org',
    packIds:['F00','F01'],
  });
  value.registerProductLine({id:'pl-orders',title:'Orders',operatingModelId:'oom-service'});
  value.registerOperationBinding({
    id:'orders.accept',productLineId:'pl-orders',family:'orders',ownerId:'domain.orders',
    commandId:'orders.accept',inputSchema:'orders.accept.input.v1',
  });
  assert.deepEqual(
    value.recordExecutionEvidence({operationId:'orders.accept',evidenceRefs:['run-order-1']}).evidenceRefs,
    ['run-order-1'],
  );
  const second=value.recordExecutionEvidence({operationId:'orders.accept',evidenceRefs:['run-close-1']});
  assert.deepEqual(second.evidenceRefs,['run-close-1','run-order-1']);
  assert.equal(second.monotonicEvidence,true);
});

test('C5 owner-scoped Workspace command descriptor snapshots caller input immutably', () => {
  const value=registry();
  value.registerOperatingModel({
    id:'oom-service',organizationId:'org-1',rootUnitId:'root',archetypeId:'service-org',
    packIds:['F00','F01'],
  });
  value.registerProductLine({id:'pl-orders',title:'Orders',operatingModelId:'oom-service'});
  value.registerOperationBinding({
    id:'orders.accept',productLineId:'pl-orders',family:'orders',ownerId:'domain.orders',
    commandId:'orders.accept',inputSchema:'orders.accept.input.v1',
  });
  const input={order:{id:'o-1'},lines:[{id:'l-1'}]};
  const descriptor=value.workspaceCommandDescriptor('orders.accept',{workspaceId:'w',input});
  input.order.id='mutated';
  input.lines[0].id='mutated';
  assert.equal(descriptor.input.order.id,'o-1');
  assert.equal(descriptor.input.lines[0].id,'l-1');
  assert.equal(Object.isFrozen(descriptor.input),true);
  assert.equal(Object.isFrozen(descriptor.input.order),true);
  assert.equal(Object.isFrozen(descriptor.input.lines),true);
  assert.throws(
    ()=>value.workspaceCommandDescriptor('orders.accept',{workspaceId:'w',input:{bad:undefined}}),
    (error)=>error instanceof OrganizationNativeCapabilityError
      && error.code==='INVALID_OWNER_COMMAND_INPUT',
  );
});


test('C5 owner command snapshot rejects accessors, hidden fields and symbols instead of dropping them', () => {
  const value=registry();
  value.registerOperatingModel({
    id:'oom-service',organizationId:'org-1',rootUnitId:'root',archetypeId:'service-org',
    packIds:['F00','F01'],
  });
  value.registerProductLine({id:'pl-orders',title:'Orders',operatingModelId:'oom-service'});
  value.registerOperationBinding({
    id:'orders.accept',productLineId:'pl-orders',family:'orders',ownerId:'domain.orders',
    commandId:'orders.accept',inputSchema:'orders.accept.input.v1',
  });
  const accessor={};
  Object.defineProperty(accessor,'value',{enumerable:true,get(){return 1;}});
  const hidden={visible:1};
  Object.defineProperty(hidden,'secret',{enumerable:false,value:2});
  const symbolic={visible:1};
  symbolic[Symbol('secret')]=2;
  for(const input of [accessor,hidden,symbolic]){
    assert.throws(
      ()=>value.workspaceCommandDescriptor('orders.accept',{workspaceId:'w',input}),
      (error)=>error instanceof OrganizationNativeCapabilityError
        && error.code==='INVALID_OWNER_COMMAND_INPUT',
    );
  }
});
