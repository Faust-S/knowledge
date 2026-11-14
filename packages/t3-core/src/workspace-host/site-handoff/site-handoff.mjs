import {checkCandidateBytes, destinationUrl, exactOrigin, isMessage, HANDOFF_PROTOCOL} from './protocol.mjs';

/** Trigger synchronously inside the user's click handler. The sensitive backup
 * is collected only after an exact-origin reply from the opened Host window. */
export function launchT2SiteHandoff({siteWindow, hostUrl, collectRawBackup, onStatus = () => {}, onReceipt = null}) {
  if (!siteWindow || typeof siteWindow.open !== 'function' ||
      typeof siteWindow.addEventListener !== 'function' ||
      typeof siteWindow.removeEventListener !== 'function' ||
      typeof collectRawBackup !== 'function') throw new Error('T2_HANDOFF_CLIENT_INPUT_INVALID');
  const siteOrigin = exactOrigin(siteWindow.location.origin);
  const dest = destinationUrl(hostUrl, siteOrigin);
  const peer = siteWindow.open(dest.href, '_blank');
  if (!peer) throw new Error('T2_HANDOFF_WINDOW_BLOCKED');

  let finished = false;
  let awaitingReady = true;
  let receiptNonce = null;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    siteWindow.removeEventListener('message', onMessage);
  };
  const onMessage = event => {
    if (finished || event.source !== peer || event.origin !== dest.origin) return;
    if (awaitingReady && isMessage(event.data, 'ready')) {
      awaitingReady = false;
      receiptNonce = event.data.nonce;
      if (typeof onReceipt !== 'function') cleanup();
      try {
        const raw = checkCandidateBytes(collectRawBackup());
        peer.postMessage({protocol: HANDOFF_PROTOCOL, kind: 'candidate',
          nonce: receiptNonce, raw}, dest.origin);
        onStatus('CANDIDATE_SENT_REQUIRES_HOST_CONFIRMATION');
      } catch {
        cleanup();
        onStatus('CANDIDATE_FAILED_SOURCE_UNCHANGED');
      }
      return;
    }
    if (!awaitingReady && typeof onReceipt === 'function' &&
        isMessage(event.data, 'write-receipt') && event.data.nonce === receiptNonce) {
      cleanup();
      // A successful Promise settlement is not the same as an applied Result.
      // Preserve legacy void callbacks while refusing EXPLICIT owner failures.
      const explicitlyNotApplied = value => value === null ||
        (value !== undefined && value !== true &&
          (typeof value !== 'object' || Array.isArray(value) ||
            value.ok === false || value.applied === false ||
            (value.status !== undefined && value.status !== 'APPLIED')));
      const settle = value => {
        if (explicitlyNotApplied(value)) acknowledge('REJECTED', true);
        else acknowledge('APPLIED');
      };
      const acknowledge = (status, asynchronousFailure = false) => {
        try {
          peer.postMessage({protocol: HANDOFF_PROTOCOL, kind: 'write-receipt-status',
            nonce: receiptNonce, status}, dest.origin);
        } catch {
          // Lost acknowledgement cannot undo an already completed local write.
        }
        // A rejected asynchronous write may already have committed before
        // failing its readback. Never claim the original source is unchanged.
        onStatus(status === 'APPLIED' ? 'WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE' :
          asynchronousFailure ? 'WRITE_RECEIPT_APPLICATION_NOT_CONFIRMED' :
            'WRITE_RECEIPT_REJECTED_SOURCE_UNCHANGED');
      };
      let receipt;
      try {
        receipt = checkCandidateBytes(event.data.raw, 64 * 1024);
      } catch {
        // The local writer has not been called; this specific failure leaves
        // its own source unchanged.
        acknowledge('REJECTED');
        return;
      }
      try {
        const written = onReceipt(receipt);
        // A Kernel/Store receipt can be asynchronous. Do not acknowledge
        // APPLIED while an owning Host or local readback is still pending.
        if (written && typeof written.then === 'function') {
          Promise.resolve(written).then(settle,
            () => acknowledge('REJECTED', true));
        } else settle(written);
      } catch {
        // The writer could have committed before throwing during readback.
        // Never claim SOURCE_UNCHANGED after entering the owner callback.
        acknowledge('REJECTED', true);
      }
    }
  };
  siteWindow.addEventListener('message', onMessage);
  return {cancel: cleanup, get awaitingReady() { return !finished && awaitingReady; },
    get awaitingReceipt() { return !finished && !awaitingReady; }};
}
