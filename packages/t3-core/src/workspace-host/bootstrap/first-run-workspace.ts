/**
 * T2 Host-owned first-run workspace orchestration. This is NOT an authority
 * issuer, a Kernel substitute, or a user identity resolver. Runtime grants,
 * guarded operations, service passports, and persisted receipts remain Kernel
 * decisions. Only explicitly opted-in HTTPS loopback provisioners are used.
 */
export interface FirstRunDomainConfig {
  origin: string;
  modules: readonly {
    service_id: string;
    base_path: string;
    host_role?: unknown;
    provisioning_scope?: unknown;
  }[];
}
export interface WorkspaceSnapshot {
  workspace_id: string;
  profile: string;
  deleted_at?: string | null;
  read_only?: boolean;
}
export interface ReadWorkspaceApi {
  hasOperation: (operation: string) => boolean;
  listWorkspaces: () => Promise<WorkspaceSnapshot[]>;
  getWorkspace: (workspaceId: string) => Promise<WorkspaceSnapshot | null>;
}
export interface ProvisionWorkspaceApi extends ReadWorkspaceApi {
  createWorkspace: (input: { workspace_id: string; profile: string }) => Promise<WorkspaceSnapshot>;
}
export type ProvisionerSelection =
  | { status: 'disabled' }
  | { status: 'enabled'; serviceId: string }
  | { status: 'blocked'; reason: string };

const ROLE = 'workspace-first-run-provisioner';
const SCOPE = 'https-loopback-development-only';
const SERVICE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
const OPAQUE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REQUIRED_READS = ['t1.listWorkspaces', 't1.getWorkspace'];

export class FirstRunWorkspaceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super('T2_FIRST_RUN_' + code);
    this.code = code;
    this.name = 'FirstRunWorkspaceError';
  }
}
function denied(code: string): never { throw new FirstRunWorkspaceError(code); }
function isHttpsLoopback(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.origin === origin &&
      url.username === '' && url.password === '' && url.pathname === '/' &&
      url.search === '' && url.hash === '' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

/** Only an explicit host-role marker can opt into the local first-run UI. */
export function selectFirstRunProvisioner(
  domain: FirstRunDomainConfig,
  workspaceServiceId: string,
  currentOrigin: string,
): ProvisionerSelection {
  if (!domain || !Array.isArray(domain.modules)) return { status: 'blocked', reason: 'DOMAIN_MODULES_INVALID' };
  const matches = domain.modules.filter((entry) => entry.host_role === ROLE);
  if (matches.length === 0) return { status: 'disabled' };
  if (matches.length !== 1) return { status: 'blocked', reason: 'MULTIPLE_PROVISIONERS' };
  const provisioner = matches[0];
  if (!SERVICE_ID.test(provisioner.service_id) || provisioner.service_id === workspaceServiceId ||
      provisioner.base_path !== '/workspace/' || provisioner.provisioning_scope !== SCOPE ||
      !domain.modules.some((item) => item.service_id === workspaceServiceId)) {
    return { status: 'blocked', reason: 'PROVISIONER_BINDING_INVALID' };
  }
  if (!isHttpsLoopback(currentOrigin) || domain.origin !== currentOrigin) {
    return { status: 'blocked', reason: 'LOCAL_HTTPS_ORIGIN_REQUIRED' };
  }
  return { status: 'enabled', serviceId: provisioner.service_id };
}
function checkRecords(records: WorkspaceSnapshot[]): WorkspaceSnapshot[] {
  if (!Array.isArray(records)) denied('LIST_RESPONSE_INVALID');
  for (const record of records) {
    if (!record || typeof record.workspace_id !== 'string' || !record.workspace_id ||
        typeof record.profile !== 'string' || !record.profile) denied('LIST_RECORD_INVALID');
  }
  return records.filter(record => !record.deleted_at);
}
function checkReadable(api: ReadWorkspaceApi): void {
  for (const op of REQUIRED_READS) {
    if (!api.hasOperation(op)) denied('READ_OPERATION_NOT_GRANTED');
  }
}
function verifyRecord(record: WorkspaceSnapshot | null, id: string, profile: string): WorkspaceSnapshot {
  if (!record || record.workspace_id !== id || record.profile !== profile ||
      record.deleted_at || record.read_only) denied('READBACK_MISMATCH');
  return record;
}

/**
 * Non-mutating discovery for the configured profile. A Workspace of a
 * different profile, or a deleted/read-only Workspace, cannot satisfy the
 * new domain's onboarding. Read it back through the same domain service.
 */
export async function findExistingFirstRunWorkspace(
  primary: ReadWorkspaceApi,
  profile: string,
): Promise<boolean> {
  if (typeof profile !== 'string' || !profile.trim()) denied('PROFILE_REQUIRED');
  checkReadable(primary);
  const candidates = checkRecords(await primary.listWorkspaces())
    .filter(record => record.profile === profile && !record.read_only);
  for (const candidate of candidates) {
    verifyRecord(await primary.getWorkspace(candidate.workspace_id), candidate.workspace_id, profile);
  }
  return candidates.length > 0;
}

/**
 * Must only be called after an explicit user action. The caller supplies a
 * stable crypto-generated workspaceId and reuses it on uncertain outcomes.
 * A lost create acknowledgement is resolved by independent Kernel readback,
 * not by silently choosing another ID. Neither service obtains new grants.
 */
export async function provisionFirstRunWorkspace(input: {
  primary: ReadWorkspaceApi;
  provisioner: ProvisionWorkspaceApi;
  workspaceId: string;
  profile: string;
}): Promise<{ status: 'existing' | 'created' | 'recovered'; workspace: WorkspaceSnapshot }> {
  const { primary, provisioner, workspaceId, profile } = input;
  if (!OPAQUE_ID.test(workspaceId) || !workspaceId.startsWith('ws-') ||
      typeof profile !== 'string' || profile.length === 0) denied('INPUT_INVALID');
  checkReadable(primary);
  checkReadable(provisioner);
  if (!provisioner.hasOperation('t1.createWorkspace')) denied('CREATE_OPERATION_NOT_GRANTED');
  const visible = checkRecords(await primary.listWorkspaces())
    .filter(record => record.profile === profile && !record.read_only);
  if (visible.length > 0) {
    const candidate = visible[0];
    const verified = verifyRecord(await primary.getWorkspace(candidate.workspace_id), candidate.workspace_id, profile);
    return { status: 'existing', workspace: verified };
  }
  const provisionerExisting = checkRecords(await provisioner.listWorkspaces())
    .filter(record => record.profile === profile && !record.read_only);
  if (provisionerExisting.length > 0) {
    const candidate = provisionerExisting[0];
    const available = await primary.getWorkspace(candidate.workspace_id);
    if (!available) denied('WORKSPACE_NOT_VISIBLE_TO_DOMAIN');
    return { status: 'existing', workspace: verifyRecord(available, candidate.workspace_id, profile) };
  }
  const previouslyCreated = await provisioner.getWorkspace(workspaceId);
  if (previouslyCreated) {
    verifyRecord(previouslyCreated, workspaceId, profile);
    return { status: 'recovered', workspace: verifyRecord(await primary.getWorkspace(workspaceId), workspaceId, profile) };
  }
  let created: WorkspaceSnapshot | null = null;
  try {
    created = await provisioner.createWorkspace({ workspace_id: workspaceId, profile });
  } catch {
    // A failed call may have committed. Do not invent a second workspace ID.
    try {
      const maybe = await provisioner.getWorkspace(workspaceId);
      if (maybe) created = maybe;
    } catch { /* original write remains unconfirmed */ }
    if (!created) denied('CREATE_UNCONFIRMED_KEEP_WORKSPACE_ID');
  }
  verifyRecord(created, workspaceId, profile);
  const provisionerReadback = await provisioner.getWorkspace(workspaceId);
  verifyRecord(provisionerReadback, workspaceId, profile);
  const domainReadback = await primary.getWorkspace(workspaceId);
  return { status: 'created', workspace: verifyRecord(domainReadback, workspaceId, profile) };
}
