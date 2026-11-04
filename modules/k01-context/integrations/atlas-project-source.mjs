// K01 read-only binding to an existing Atlas project/source. No Atlas storage or writes.
import { createAtlasPublicRepoObservationPort } from './atlas-public-source.mjs';

const valid = value => typeof value === 'string' && value.length > 0
  && value.length <= 512 && value.trim() === value && !/[\x00-\x1f]/.test(value);
const sha = /^[a-f0-9]{40}$/i;

export function atlasProjectSourceRef(projectId, sourceId) {
  if (!valid(projectId) || !valid(sourceId)) throw new TypeError('invalid Atlas source identity');
  return `atlas-project:${encodeURIComponent(projectId)}:${encodeURIComponent(sourceId)}`;
}

export function createAtlasProjectObservationPort({
  projectId, sourceId, repository, branch, pinnedItems,
  getSnapshot, observeRepository, readEvidence,
}) {
  const sourceRef = atlasProjectSourceRef(projectId, sourceId);
  if (!valid(repository) || !valid(branch) || !Array.isArray(pinnedItems)
      || pinnedItems.length === 0 || typeof getSnapshot !== 'function'
      || typeof observeRepository !== 'function' || typeof readEvidence !== 'function') {
    throw new TypeError('invalid Atlas project binding');
  }
  const stillAttached = async () => {
    try {
      const snapshot = await getSnapshot();
      if (snapshot?.schema !== 'atlas.project/1'
          || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0
          || !Array.isArray(snapshot.projects)) return false;
      const project = snapshot.projects.find(item => item?.id === projectId);
      const source = project?.sources?.find(item => item?.id === sourceId);
      const summary = source?.summary;
      return source?.kind === 'github' && source.locator === repository
        && source.status === 'ok' && summary?.scope === 'repository'
        && summary.repository === repository && summary.complete === true
        && summary.branchHeads != null && typeof summary.branchHeads === 'object'
        && Object.hasOwn(summary.branchHeads, branch)
        && typeof summary.branchHeads[branch] === 'string'
        && sha.test(summary.branchHeads[branch]);
    } catch {
      // No host credential, path or exception text leaves this boundary.
      return false;
    }
  };
  const delegate = createAtlasPublicRepoObservationPort({
    sourceRef, repository, branch, pinnedItems,
    observeRepository: async request => (await stillAttached())
      ? observeRepository(request) : null,
    readEvidence: async request => (await stillAttached())
      ? readEvidence(request) : null,
  });
  return {
    async query(request) {
      return (await stillAttached()) ? delegate.query(request) : [];
    },
    async observe(request) {
      if (!(await stillAttached())) {
        return {sourceRef, currentRevision: 'unavailable', complete: false};
      }
      return delegate.observe(request);
    },
  };
}
