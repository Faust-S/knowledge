import { packageSha256 } from './webdav-package-transfer.mjs';

export class T4OriginalExchangeHandoffError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'T4OriginalExchangeHandoffError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const fail = (code, details) => { throw new T4OriginalExchangeHandoffError(code, details); };
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const same = (a, b) => Array.isArray(a) && Array.isArray(b) &&
  a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
const fullContent = options => options?.include_history === true &&
  options.include_assets === true && options.include_relations === true &&
  options.include_schemas === true;
const fullSingleWorkspace = (selection, workspaceId) =>
  same(selection?.workspaces, [workspaceId]) && fullContent(selection);

export function createT4OriginalExchangeHandoff({
  transport, originalKernel, currentWorkspace, readOriginalExportState, workspaceId,
} = {}) {
  if (!transport || typeof transport.putSnapshot !== 'function' ||
    typeof transport.getSnapshot !== 'function' ||
    !originalKernel || typeof originalKernel.hasOperation !== 'function' ||
    typeof currentWorkspace?.get !== 'function' ||
    typeof currentWorkspace?.subscribe !== 'function' ||
    typeof readOriginalExportState !== 'function' || !nonempty(workspaceId)) {
    fail('ORIGINAL_T3_HOST_PORTS_REQUIRED');
  }

  function focusGuard(requireSelected) {
    const initial = currentWorkspace.get();
    if (requireSelected && initial?.workspace_id !== workspaceId) fail('ORIGINAL_WORKSPACE_NOT_SELECTED');
    let changed = false;
    const unsubscribe = currentWorkspace.subscribe(() => { changed = true; });
    if (typeof unsubscribe !== 'function') fail('ORIGINAL_SELECTION_SUBSCRIPTION_REQUIRED');
    const check = (details) => {
      if (changed || currentWorkspace.get() !== initial ||
        (requireSelected && initial?.workspace_id !== workspaceId)) {
        fail('ORIGINAL_WORKSPACE_FOCUS_CHANGED', details);
      }
    };
    return {check, release: unsubscribe};
  }

  function confirmedPackage(state) {
    if (state?.status !== 'confirmed' || state.fileSavedConfirmed !== true ||
      state.ackSensitive !== true) fail('ORIGINAL_EXPORT_NOT_CONFIRMED');
    const artifact = state.artifact, receipt = state.receipt, manifest = artifact?.manifest;
    if (!fullSingleWorkspace(state.selection, workspaceId) ||
      !fullSingleWorkspace(state.previewSnapshot, workspaceId) ||
      !fullSingleWorkspace(state.packageSnapshot, workspaceId) ||
      !fullContent(manifest?.options) ||
      !same(state.preview?.workspaces, [workspaceId])) {
      fail('ORIGINAL_EXCHANGE_FULL_WORKSPACE_REQUIRED');
    }
    if (!(artifact?.bytes instanceof Uint8Array) || !artifact.bytes.byteLength ||
      artifact.size !== artifact.bytes.byteLength ||
      !nonempty(artifact.filename) || !artifact.filename.endsWith('.iwxa') ||
      !nonempty(artifact.package_digest) || !nonempty(artifact.semantic_digest) ||
      manifest?.format !== 'iwxa.package' ||
      !['1.0', '1.1'].includes(manifest.format_version) ||
      manifest.encryption !== 'none' ||
      manifest.package_digest !== artifact.package_digest ||
      manifest.semantic_digest !== artifact.semantic_digest ||
      artifact.validation?.format !== 'iwxa.package.validation' ||
      artifact.validation.ok !== true ||
      !Number.isSafeInteger(artifact.validation.file_count) ||
      artifact.validation.file_count < 0 ||
      !Number.isSafeInteger(artifact.validation.object_count) ||
      artifact.validation.object_count < 0 ||
      !Array.isArray(artifact.validation.schema_issues) ||
      !Array.isArray(artifact.validation.path_issues) ||
      artifact.summary == null ||
      !same(manifest.workspaces, [workspaceId]) ||
      !same(state.packageSnapshot?.workspaces, [workspaceId]) ||
      !receipt || receipt.package_digest !== artifact.package_digest ||
      !same(receipt.workspace_ids, [workspaceId]) ||
      !Number.isFinite(Date.parse(receipt.confirmed_at)) ||
      !Number.isSafeInteger(receipt.confirmations) ||
      receipt.confirmations < 1) {
      fail('ORIGINAL_EXPORT_RECEIPT_MISMATCH');
    }
    return artifact;
  }

  async function publishConfirmedExport() {
    if (!originalKernel.hasOperation('t2.exportPackage') ||
      !originalKernel.hasOperation('t2.confirmExport')) fail('ORIGINAL_EXPORT_OPERATION_UNAVAILABLE');
    const focus = focusGuard(true);
    try {
      const state = await readOriginalExportState();
      focus.check();
      const artifact = confirmedPackage(state);
      const bytes = Uint8Array.from(artifact.bytes);
      const sha256 = packageSha256(bytes);
      if (readOriginalExportState() !== state) fail('ORIGINAL_EXPORT_STATE_CHANGED');
      focus.check();
      const transferReceipt = await transport.putSnapshot({
        key: sha256 + '.iwxa', bytes, expectedSha256: sha256, createOnly: true,
      });
      focus.check({networkMayHavePublished: true, key: sha256 + '.iwxa', sha256});
      if (readOriginalExportState() !== state) {
        fail('ORIGINAL_EXPORT_STATE_CHANGED_AFTER_NETWORK',
          {networkMayHavePublished: true, key: sha256 + '.iwxa', sha256});
      }
      return Object.freeze({
        schema: 'IWXA_T4_ORIGINAL_EXCHANGE_HANDOFF_V1',
        workspaceId, originalPackageDigest: artifact.package_digest, sha256,
        originalExportConfirmed: true, originalImportCommitted: false,
        transportReceipt: transferReceipt,
      });
    } finally { focus.release(); }
  }

  async function previewRemoteImport({key, expectedSha256, expectedETag} = {}) {
    if (!originalKernel.hasOperation('t2.importPreview') ||
      typeof originalKernel.importPreview !== 'function') fail('ORIGINAL_IMPORT_PREVIEW_UNAVAILABLE');
    const focus = focusGuard(false);
    try {
      const received = await transport.getSnapshot({key,expectedSha256,expectedETag});
      focus.check();
      const preview = await originalKernel.importPreview(Uint8Array.from(received.bytes));
      try {
        focus.check();
        if (!nonempty(preview?.preview_token)) fail('ORIGINAL_IMPORT_PREVIEW_INVALID');
      } catch (error) {
        if (nonempty(preview?.preview_token) && originalKernel.hasOperation('t2.importCancel') &&
          typeof originalKernel.importCancel === 'function') {
          await originalKernel.importCancel(preview.preview_token).catch(() => {});
        }
        throw error;
      }
      return Object.freeze({
        schema: 'IWXA_T4_ORIGINAL_IMPORT_PREVIEW_HANDOFF_V1',
        originalPreview: preview, transportReceipt: received.receipt,
        originalImportPreviewed: true, originalImportCommitted: false,
      });
    } finally { focus.release(); }
  }

  return Object.freeze({publishConfirmedExport, previewRemoteImport});
}
