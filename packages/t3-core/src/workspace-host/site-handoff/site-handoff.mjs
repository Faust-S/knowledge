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
      let result = 'REJECTED';
      try {
        onReceipt(checkCandidateBytes(event.data.raw, 64 * 1024));
        result = 'APPLIED';
      } catch {
        // The local source remains available for retry or manual inspection.
      }
      try {
        peer.postMessage({protocol: HANDOFF_PROTOCOL, kind: 'write-receipt-status',
          nonce: receiptNonce, status: result}, dest.origin);
      } catch {
        // Lost transport acknowledgement cannot roll back an already applied source.
      }
      onStatus(result === 'APPLIED' ? 'WRITE_RECEIPT_APPLIED_TO_LOCAL_SOURCE' :
        'WRITE_RECEIPT_REJECTED_SOURCE_UNCHANGED');
    }
  };
  siteWindow.addEventListener('message', onMessage);
  return {cancel: cleanup, get awaitingReady() { return !finished && awaitingReady; },
    get awaitingReceipt() { return !finished && !awaitingReady; }};
}
