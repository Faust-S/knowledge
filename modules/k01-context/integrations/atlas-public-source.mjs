// Host binding for the public Atlas observePublicRepo() result shape.
// All network access, evidence bytes, permissions and persistence stay with Atlas.
import { createRevisionedObservationPort } from '../adapters/revisioned-source.mjs';

const valid = value => typeof value === 'string' && value.length > 0
  && value.length <= 512 && value.trim() === value && !/[\x00-\x1f]/.test(value);
const commitSha = /^[a-f0-9]{40}$/i;

export function createAtlasPublicRepoObservationPort({
  sourceRef, repository, branch, pinnedItems, observeRepository, readEvidence,
}) {
  if (![sourceRef, repository, branch].every(valid)
      || !Array.isArray(pinnedItems) || pinnedItems.length === 0
      || typeof observeRepository !== 'function' || typeof readEvidence !== 'function') {
    throw new TypeError('invalid Atlas public source binding');
  }
  return createRevisionedObservationPort({
    sourceRef, pinnedItems,
    getCurrentRevision: async () => {
      // An old Atlas source.summary is NOT sufficient: request a current host observation.
      const fresh = await observeRepository({ repository });
      if (!fresh || fresh.scope !== 'repository' || fresh.complete !== true
          || fresh.repository !== repository || !fresh.branchHeads
          || typeof fresh.branchHeads !== 'object'
          || !Object.hasOwn(fresh.branchHeads, branch)) return null;
      const revision = fresh.branchHeads[branch];
      return typeof revision === 'string' && commitSha.test(revision) ? revision : null;
    },
    readEvidence: async request => readEvidence({ ...request, repository, branch }),
  });
}
