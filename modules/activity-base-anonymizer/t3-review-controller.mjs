// UI lifecycle for an existing signed T3 Host-selected Activity read.
// It neither grants source access nor persists evidence. The Host owns the
// original T3 D1/D2 port and must signal grant/status invalidation.
import {inspectSelectedT3Activity, T3ActivityHold} from './t3-selected-host.mjs';

const safeCode = error => error instanceof T3ActivityHold &&
  /^T3_[A-Z0-9_]{2,100}$/.test(error.code ?? '') ?
  error.code : 'T3_REVIEW_UNAVAILABLE';

export function createT3ReviewController({host, onUpdate} = {}) {
  if (!host || typeof onUpdate !== 'function' ||
      typeof host.subscribeInvalidation !== 'function' ||
      typeof host.context?.currentWorkspace?.subscribe !== 'function') {
    throw new T3ActivityHold('T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
  }
  let generation = 0;
  let detached = false;
  const invalidate = () => {
    generation += 1;
    if (!detached) onUpdate({status: 'READY_TO_READ', review: null});
  };
  let unselect = null;
  let unowner = null;
  try {
    unselect = host.context.currentWorkspace.subscribe(invalidate);
    unowner = host.subscribeInvalidation(invalidate);
    if (typeof unselect !== 'function' || typeof unowner !== 'function') {
      throw new T3ActivityHold('T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
    }
  } catch {
    if (typeof unselect === 'function') unselect();
    throw new T3ActivityHold('T3_TRUSTED_HOST_INVALIDATION_REQUIRED');
  }
  onUpdate({status: 'READY_TO_READ', review: null});
  return Object.freeze({
    async readSelected() {
      if (detached) return {status: 'DETACHED'};
      const id = ++generation;
      onUpdate({status: 'READING', review: null});
      try {
        const review = await inspectSelectedT3Activity(host);
        if (detached || id !== generation) return {status: 'INVALIDATED'};
        onUpdate({status: 'REVIEW', review});
        return {status: 'REVIEW'};
      } catch (error) {
        if (detached || id !== generation) return {status: 'INVALIDATED'};
        onUpdate({status: 'HOLD', review: null, code: safeCode(error)});
        return {status: 'HOLD'};
      }
    },
    reset() {
      if (detached) return;
      invalidate();
    },
    dispose() {
      if (detached) return;
      detached = true;
      generation += 1;
      unselect();
      unowner();
    },
  });
}