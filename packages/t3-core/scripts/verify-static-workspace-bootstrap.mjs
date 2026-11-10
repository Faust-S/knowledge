/**
 * Verify a local, static Capability 0.3.1 registration and its separate
 * workspace provisioner before copying either into a Host/Kernel bundle.
 * This validates a supplied declaration; it does not approve a policy,
 * create a grant, or authenticate the owner who supplied that declaration.
 * The independent Kernel remains the runtime authorization authority.
 */
const fail = (code) => { throw new Error('T2_BOOTSTRAP_' + code); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uniqueStrings = (v) => Array.isArray(v) && v.every(x => typeof x === 'string' && x.length > 0) && new Set(v).size === v.length;

function noAuthorityOutsideStaticDeclaration(plane, services) {
  if (!record(plane) || plane.schema_version !== '0.3.1' ||
      typeof plane.snapshot_id !== 'string' || !plane.snapshot_id ||
      typeof plane.resolver_id !== 'string' || !plane.resolver_id ||
      !Array.isArray(plane.trusted_issuers) || plane.trusted_issuers.length !== 0 ||
      !Array.isArray(plane.issuance_policies) || plane.issuance_policies.length !== 0 ||
      !Array.isArray(plane.services) || plane.services.length !== services.length ||
      !uniqueStrings(plane.services.map(d => d?.service_id))) fail('CONTROL_PLANE_INVALID');
  const got = plane.services.map(x => x.service_id).sort();
  if (!equal(got, [...services].sort())) fail('SERVICE_SET_MISMATCH');
  for (const d of plane.services) {
    if (!record(d) || d.schema_version !== '0.3.1' ||
        d.capability_control !== 'NONE' || !equal(d.capability_ceiling, []) ||
        !equal(d.activation_any_of, []) || !equal(d.operation_guards, []) ||
        !equal(Object.keys(d).sort(), ['schema_version','service_id','capability_control','capability_ceiling','activation_any_of','operation_guards'].sort())) {
      fail('UNAPPROVED_OR_GUARDED_DECLARATION');
    }
  }
}
function checkWorkspacePermissions(p, { create, objects }) {
  if (!record(p.permissions) || !record(p.permissions.workspace) ||
      !record(p.permissions.objects) || !record(p.permissions.packages) ||
      p.permissions.workspace.list !== true || p.permissions.workspace.read !== true ||
      p.permissions.workspace.create !== create ||
      p.permissions.workspace.soft_delete !== false || p.permissions.workspace.restore !== false ||
      p.permissions.workspace.purge !== false || p.permissions.packages.export !== false ||
      p.permissions.packages.import !== false || !equal(p.permissions.objects.read, objects) ||
      !equal(p.permissions.objects.write, objects) || !equal(p.permissions.objects.delete, [])) {
    fail('PASSPORT_PERMISSIONS_EXCEED_SCOPE');
  }
}
export function projectOwnerPassport(owner, workspaceServiceId) {
  if (!record(owner) || typeof workspaceServiceId !== 'string' || !workspaceServiceId.trim()) fail('INPUT_INVALID');
  // Projection changes routing identity only. Every permission and schema is preserved.
  return { ...structuredClone(owner), service_id: workspaceServiceId, base_path: '/workspace/' };
}
export function verifyStaticWorkspaceBootstrap({ plane, owner, workspace, provisioner, expected }) {
  if (!record(expected) || !uniqueStrings(expected.schemaIds) || expected.schemaIds.length === 0 ||
      !record(owner) || !record(workspace) || !record(provisioner) ||
      typeof expected.ownerId !== 'string' || typeof expected.workspaceId !== 'string' ||
      typeof expected.provisionerId !== 'string' ||
      expected.ownerId === expected.workspaceId || expected.workspaceId === expected.provisionerId ||
      expected.ownerId === expected.provisionerId) fail('INPUT_INVALID');
  noAuthorityOutsideStaticDeclaration(plane, [expected.workspaceId, expected.provisionerId]);
  if (owner.service_id !== expected.ownerId || workspace.service_id !== expected.workspaceId ||
      !equal(projectOwnerPassport(owner, expected.workspaceId), workspace)) fail('OWNER_PROJECTION_MISMATCH');
  if (workspace.base_path !== '/workspace/' ||
      !Array.isArray(workspace.supported_levels) || !workspace.supported_levels.includes('T1') ||
      !record(workspace.schemas) ||
      !equal(Object.keys(workspace.schemas).sort(), [...expected.schemaIds].sort()) ||
      !equal([...workspace.output_object_types].sort(), [...expected.schemaIds].sort()) ||
      !equal([...workspace.permissions.objects.read].sort(), [...expected.schemaIds].sort()) ||
      !equal([...workspace.permissions.objects.write].sort(), [...expected.schemaIds].sort())) fail('WORKSPACE_SCHEMA_SCOPE_INVALID');
  checkWorkspacePermissions(workspace, {create: false, objects: expected.schemaIds});
  if (provisioner.service_id !== expected.provisionerId || provisioner.base_path !== '/workspace/' ||
      !equal(provisioner.supported_levels, ['T0','T1']) ||
      !equal(provisioner.input_object_types, []) || !equal(provisioner.output_object_types, []) ||
      !record(provisioner.schemas) || Object.keys(provisioner.schemas).length !== 0) fail('PROVISIONER_SCOPE_INVALID');
  checkWorkspacePermissions(provisioner, {create: true, objects: []});
  if (own(provisioner, 'capabilities') || own(plane, 'grants') || own(plane, 'receipts')) fail('UNEXPECTED_HOLDER_AUTHORITY');
  return Object.freeze({status:'STATIC_REGISTRATION_VERIFIED_NOT_A_GRANT',
    workspaceServiceId: expected.workspaceId, provisionerServiceId: expected.provisionerId,
    schemaCount: expected.schemaIds.length, ownerGrantsCreated: false, productionActivation: false});
}
