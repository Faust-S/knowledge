import {checkCandidateBytes, exactOrigin, isMessage, HANDOFF_PROTOCOL, nonceFrom} from './protocol.mjs';

/** Host-owned preview transport. No command invocation, mutation or consent. */
export function mountT2SiteHandoffReceiver({hostWindow, expectedSiteOrigin, validateSource,
  onPreview, cryptoSource = hostWindow?.crypto, onStatus = () => {},
  verifyAppliedBeforeSend = null}) {
  if (!hostWindow || typeof hostWindow.addEventListener !== 'function' ||
      typeof hostWindow.removeEventListener !== 'function' ||
      !hostWindow.opener || typeof hostWindow.opener.postMessage !== 'function' ||
      typeof validateSource !== 'function' || typeof onPreview !== 'function' ||
      (verifyAppliedBeforeSend !== null &&
       typeof verifyAppliedBeforeSend !== 'function'))
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
  let verifyingReceipt = false;
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
    // Signed source inspection and Host preview may both be asynchronous.
    // A pending or rejected Promise must NEVER authorize a write receipt.
    const rejected = () => {
      if (!disposed) onStatus('CANDIDATE_REJECTED_NO_WRITE');
    };
    // The transport does not decide whether a signed Result is trusted.
    // It must, however, preserve an explicit refusal by the real owner.
    const refused = value => value === false ||
      (value && typeof value === 'object' &&
        (value.allowed === false || value.accepted === false ||
          value.verified === false || value.ok === false ||
          (typeof value.status === 'string' &&
            /(^|_)(BLOCKED|REJECTED|DENIED|FAILED|INVALID|UNTRUSTED|UNVERIFIED|UNKNOWN|UNRESOLVED|EXPIRED|STALE|HOLD|CANCELLED)(_|$)/i
              .test(value.status))));
    const ready = value => {
      if (disposed) return;
      // Legacy void callback can complete a PREVIEW, never an Apply.
      if (value === null || refused(value)) { rejected(); return; }
      previewAccepted = true;
      onStatus('CANDIDATE_READY_FOR_EXPLICIT_REVIEW');
    };
    const deniedPreview = value => value == null || refused(value);
    const present = preview => {
      if (disposed) return;
      // The owner validator must return a real, non-denied candidate before
      // the UI sees it. A returned refusal is NOT an exception, but still
      // must never unlock an eventual receipt.
      if (deniedPreview(preview)) { rejected(); return; }
      try {
        // Preview preparation is not Human Review or application approval.
        const shown = onPreview(preview);
        if (shown && typeof shown.then === 'function') {
          Promise.resolve(shown).then(ready, rejected);
        } else ready(shown);
      } catch { rejected(); }
    };
    try {
      const raw = checkCandidateBytes(event.data.raw);
      const preview = validateSource(raw);
      if (preview && typeof preview.then === 'function') {
        Promise.resolve(preview).then(value => {
          if (value === false) rejected();
          else present(value);
        }, rejected);
      } else if (preview === false) rejected();
      else present(preview);
    } catch { rejected(); }
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
  const dispatchReceipt = bytes => {
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
  };
  return {
    dispose,
    get consumed() { return consumed; },
    /** In a T3 signed owner Host, verifyAppliedBeforeSend MUST independently
     * read the committed original Kernel Result and check its exact receipt.
     * The legacy T2 calling convention stays synchronous when no verifier
     * is configured; it is transport-only and never proves application. */
    sendReceipt(raw) {
      if (disposed || !previewAccepted || receiptSent || verifyingReceipt)
        throw new Error('T2_HANDOFF_RECEIPT_NOT_READY');
      const bytes = checkCandidateBytes(raw, 64 * 1024);
      if (verifyAppliedBeforeSend === null) {
        dispatchReceipt(bytes);
        return;
      }
      verifyingReceipt = true;
      return (async () => {
        try {
          const result = await verifyAppliedBeforeSend(bytes);
          if (disposed || !previewAccepted || receiptSent) return false;
          if (result !== true) {
            onStatus('WRITE_RECEIPT_HOST_APPLICATION_NOT_CONFIRMED');
            return false;
          }
          dispatchReceipt(bytes);
          return true;
        } catch {
          if (!disposed) onStatus('WRITE_RECEIPT_HOST_APPLICATION_NOT_CONFIRMED');
          return false;
        } finally {
          verifyingReceipt = false;
        }
      })();
    },
  };
}
