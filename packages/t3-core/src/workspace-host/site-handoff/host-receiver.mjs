import {checkCandidateBytes, exactOrigin, isMessage, HANDOFF_PROTOCOL, nonceFrom} from './protocol.mjs';

/** Host-owned preview transport. No command invocation, mutation or consent. */
export function mountT2SiteHandoffReceiver({hostWindow, expectedSiteOrigin, validateSource,
  onPreview, cryptoSource = hostWindow?.crypto, onStatus = () => {}}) {
  if (!hostWindow || typeof hostWindow.addEventListener !== 'function' ||
      typeof hostWindow.removeEventListener !== 'function' ||
      !hostWindow.opener || typeof hostWindow.opener.postMessage !== 'function' ||
      typeof validateSource !== 'function' || typeof onPreview !== 'function')
    throw new Error('T2_HANDOFF_HOST_INPUT_INVALID');
  const hostOrigin = exactOrigin(hostWindow.location.origin);
  const siteOrigin = exactOrigin(expectedSiteOrigin);
  if (hostOrigin === siteOrigin) throw new Error('T2_HANDOFF_ORIGIN_ISOLATION_REQUIRED');
  const trustedOpener = hostWindow.opener;
  const nonce = nonceFrom(cryptoSource);
  let consumed = false;
  let previewAccepted = false;
  let receiptSent = false;
  let disposed = false;
  let awaitingAck = false;
  const onAck = event => {
    if (!awaitingAck || event.source !== trustedOpener || event.origin !== siteOrigin ||
        !isMessage(event.data, 'write-receipt-status') || event.data.nonce !== nonce ||
        !['APPLIED', 'REJECTED'].includes(event.data.status)) return;
    awaitingAck = false;
    hostWindow.removeEventListener('message', onAck);
    onStatus('WRITE_RECEIPT_SITE_' + event.data.status);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    awaitingAck = false;
    hostWindow.removeEventListener('message', onMessage);
    hostWindow.removeEventListener('message', onAck);
  };
  const onMessage = event => {
    if (disposed || consumed || event.origin !== siteOrigin ||
        event.source !== trustedOpener || !isMessage(event.data, 'candidate') ||
        event.data.nonce !== nonce) return;
    consumed = true;
    hostWindow.removeEventListener('message', onMessage);
    try {
      const raw = checkCandidateBytes(event.data.raw);
      const preview = validateSource(raw);
      onPreview(preview); // Host UI must require separate explicit user consent
      previewAccepted = true;
      onStatus('CANDIDATE_READY_FOR_EXPLICIT_REVIEW');
    } catch {
      onStatus('CANDIDATE_REJECTED_NO_WRITE');
    }
  };
  hostWindow.addEventListener('message', onMessage);
  // React StrictMode may mount, dispose and immediately remount an owner
  // card. Defer readiness until the committed receiver still owns its listener,
  // so the opener never consumes a nonce from an already-disposed instance.
  queueMicrotask(() => {
    if(disposed)return;
    try {trustedOpener.postMessage({protocol: HANDOFF_PROTOCOL, kind: 'ready', nonce}, siteOrigin);}
    catch {dispose();onStatus('CANDIDATE_REJECTED_NO_WRITE');}
  });
  return {
    dispose,
    get consumed() { return consumed; },
    /** Host must verify its command receipt and independent Kernel readback
     * before returning this transport-only receipt to the originating site. */
    sendReceipt(raw) {
      if (disposed || !previewAccepted || receiptSent) throw new Error('T2_HANDOFF_RECEIPT_NOT_READY');
      const bytes = checkCandidateBytes(raw, 64 * 1024);
      receiptSent = true;
      awaitingAck = true;
      hostWindow.addEventListener('message', onAck);
      onStatus('WRITE_RECEIPT_SENT_NOT_SITE_ACKNOWLEDGED');
      try {
        trustedOpener.postMessage({
          protocol: HANDOFF_PROTOCOL, kind: 'write-receipt', nonce, raw: bytes,
        }, siteOrigin);
      } catch (error) {
        awaitingAck = false;
        receiptSent = false;
        hostWindow.removeEventListener('message', onAck);
        throw error;
      }
    },
  };
}
