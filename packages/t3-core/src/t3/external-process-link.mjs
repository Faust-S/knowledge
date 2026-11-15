// Agent 0.6 external process admission in the ORIGINAL selected T3 Host.
// Not an ERP client, a process engine, a credential store, or a new Kernel.
import { createSubjectKernelBinding } from './subject-access-binding.mjs';

export const EXTERNAL_PROCESS_LINK_SCHEMA = 'iwxa.agent06.external-process-link';
export const EXTERNAL_PROCESS_LINK_EVENT = 't3.external-process.record.reported';
export const EXTERNAL_PROCESS_LINK_DECLARATION = Object.freeze({
  schema_version: '1.0.0', preserve_unknown: false,
  json_schema: {
    type: 'object', additionalProperties: false,
    required: ['source_owner', 'record_kind', 'record_id', 'source_revision',
      'source_digest', 'source_receipt', 'source_state', 'epistemic_status', 'record_authority'],
    properties: {
      source_owner: {type: 'string', minLength: 1, maxLength: 160},
      record_kind: {type: 'string', minLength: 1, maxLength: 160},
      record_id: {type: 'string', minLength: 1, maxLength: 160},
      source_revision: {type: 'string', minLength: 1, maxLength: 160},
      source_digest: {type: 'string', pattern: '^[a-f0-9]{64}$'},
      source_receipt: {type: 'string', minLength: 1, maxLength: 160},
      source_state: {type: 'string', minLength: 1, maxLength: 160},
      epistemic_status: {const: 'reported'},
      record_authority: {const: 'EXTERNAL_OWNER'},
    },
  }, embedded: {},
});

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const DIGEST = /^[a-f0-9]{64}$/;
// ERPNext uses names such as 'Sales Order'; these are provider type labels,
// not signed T3 object identifiers. Whitespace is allowed here only.
const KIND = /^[A-Za-z][A-Za-z0-9 _.-]{0,159}$/;
function deny(code, context) {
  throw Object.assign(new Error(code), {code, ...(context || {})});
}
function requireId(value, code) {
  if (typeof value !== 'string' || !ID.test(value)) deny(code);
  return value;
}
function requireKind(value) {
  if (typeof value !== 'string' || !KIND.test(value)) deny('T3_EXT_KIND_INVALID');
  return value;
}
function requireDigest(value) {
  if (typeof value !== 'string' || !DIGEST.test(value)) deny('T3_EXT_SOURCE_DIGEST_INVALID');
  return value;
}
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function normalizeReference(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) deny('T3_EXT_REFERENCE_REQUIRED');
  return Object.freeze({
    expected_workspace_id: requireId(input.expected_workspace_id, 'T3_EXT_WORKSPACE_REQUIRED'),
    record_kind: requireKind(input.record_kind),
    record_id: requireId(input.record_id, 'T3_EXT_RECORD_ID_INVALID'),
  });
}
function normalizeSource(ownerId, reference, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      value.source_owner !== ownerId || value.record_kind !== reference.record_kind ||
      value.record_id !== reference.record_id) deny('T3_EXT_SOURCE_IDENTITY_MISMATCH');
  return Object.freeze({
    source_owner: ownerId, record_kind: reference.record_kind, record_id: reference.record_id,
    source_revision: requireId(value.source_revision, 'T3_EXT_SOURCE_REVISION_REQUIRED'),
    source_digest: requireDigest(value.source_digest),
    source_receipt: requireId(value.source_receipt, 'T3_EXT_OWNER_RECEIPT_REQUIRED'),
    source_state: requireId(value.source_state, 'T3_EXT_SOURCE_STATE_REQUIRED'),
    epistemic_status: 'reported', record_authority: 'EXTERNAL_OWNER',
  });
}
async function objectIdFor(ownerId, ref) {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function')
    deny('T3_EXT_SHA256_UNAVAILABLE');
  const key = JSON.stringify([ownerId, ref.record_kind, ref.record_id]);
  const bytes = new TextEncoder().encode(key);
  const hash = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
  return 'external-link:' + [...hash].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function matches(object, workspaceId, objectId, data) {
  return object && !object.deleted && !object.deleted_at &&
    object.workspace_id === workspaceId && object.object_id === objectId &&
    object.schema_id === EXTERNAL_PROCESS_LINK_SCHEMA &&
    object.schema_version === '1.0.0' &&
    Number.isSafeInteger(object.revision) && object.revision > 0 && equal(object.data, data);
}

/** Only a TRUSTED original T3 Host can supply the signed D1 owner, the original
 * T2 KernelFacade and a verified ERP/workflow read port. A renderer may supply
 * a record ID but can neither choose the principal nor choose the owner.
 * The real source owner is authoritative for its record and revision; this
 * link is deliberately only REPORTED evidence, not an observed production step.
 * The normal T2 service passport must explicitly declare the link schema.
 */
export function createTrustedExternalProcessLink({
  kernel, accessForWrite, currentWorkspace, externalOwner, confirmHuman, isHostActive,
} = {}) {
  if (kernel?.sessionInfo?.contract_version !== '1.3.0' ||
      typeof kernel.hasOperation !== 'function' ||
      !['t1.getWorkspace','t1.getObject','t1.putObject'].every(op=>kernel.hasOperation(op)) ||
      typeof accessForWrite !== 'function' ||
      typeof currentWorkspace?.get !== 'function' ||
      typeof currentWorkspace?.subscribe !== 'function' ||
      !externalOwner || !ID.test(externalOwner.ownerId || '') ||
      typeof externalOwner.readExact !== 'function' ||
      typeof confirmHuman !== 'function' || typeof isHostActive !== 'function')
    deny('T3_EXT_TRUSTED_HOST_REQUIRED');

  const pending = new Set();
  async function withSelected(input, callback) {
    const reference = normalizeReference(input);
    if (isHostActive() !== true) deny('T3_HOST_DISPOSED');
    const choice = currentWorkspace.get();
    if (!choice || choice.workspace_id !== reference.expected_workspace_id || choice.deleted_at)
      deny('T3_EXT_SELECTED_WORKSPACE_MISMATCH');
    let invalidated = false;
    const unsubscribe = currentWorkspace.subscribe(()=>{invalidated = true;});
    const live = () => {
      if (isHostActive() !== true) deny('T3_HOST_DISPOSED');
      if (invalidated || currentWorkspace.get() !== choice)
        deny('T3_EXT_WORKSPACE_CHANGED');
    };
    try {
      live();
      const access = await accessForWrite('t1.putObject');
      live();
      if (typeof access?.currentContext !== 'function')
        deny('T3_EXT_SIGNED_OWNER_REQUIRED');
      const initialContext = JSON.stringify(await access.currentContext());
      live();
      const signedContext = JSON.parse(initialContext);
      if (signedContext.workspace_id !== choice.workspace_id ||
          signedContext.resource !== choice.workspace_id)
        deny('T3_EXT_SIGNED_SCOPE_MISMATCH');
      const check = async () => {
        live();
        if (JSON.stringify(await access.currentContext()) !== initialContext)
          deny('T3_EXT_SIGNED_CONTEXT_CHANGED');
        live();
      };
      const signed = createSubjectKernelBinding({kernel, access,
        isHostActive:()=>isHostActive() === true && !invalidated && currentWorkspace.get() === choice});
      await check();
      const workspace = await signed.getWorkspace(choice.workspace_id);
      await check();
      if (!workspace || workspace.deleted_at || workspace.workspace_id !== choice.workspace_id)
        deny('T3_EXT_WORKSPACE_NOT_ACTIVE');
      const objectId = await objectIdFor(externalOwner.ownerId, reference);
      await check();
      const readLink = async () => {
        await check();
        const detail = await signed.getObject(choice.workspace_id, objectId);
        await check();
        return detail?.object ?? null;
      };
      const readExternal = async () => {
        await check();
        // Do not persist raw ERP data, invoices, contact details or credentials.
        const actual = normalizeSource(externalOwner.ownerId, reference,
          await externalOwner.readExact({record_kind: reference.record_kind,
            record_id: reference.record_id}));
        await check();
        return actual;
      };
      return await callback({reference, workspaceId: choice.workspace_id,
        objectId, signed, readLink, readExternal, check});
    } finally {
      unsubscribe();
    }
  }

  async function link(input) {
    return withSelected(input, async ctx => {
      if (pending.has(ctx.objectId)) deny('T3_EXT_LINK_IN_PROGRESS');
      pending.add(ctx.objectId);
      try {
        const source = await ctx.readExternal();
        const existing = await ctx.readLink();
        if (existing) {
          if (!matches(existing, ctx.workspaceId, ctx.objectId, source))
            deny('T3_EXT_REVISION_OR_SOURCE_CONFLICT');
          return Object.freeze({status:'ALREADY_LINKED',workspace_id:ctx.workspaceId,
            object_id:ctx.objectId,revision:existing.revision,source_revision:source.source_revision});
        }
        const approved = await confirmHuman(Object.freeze({
          workspace_id:ctx.workspaceId, object_id:ctx.objectId,
          source_owner:source.source_owner, record_kind:source.record_kind,
          record_id:source.record_id, source_revision:source.source_revision,
          epistemic_status:'reported',
        }));
        await ctx.check();
        if (approved !== true) return Object.freeze({status:'USER_CANCELLED'});
        const after = await ctx.readExternal();
        if (!equal(source, after)) deny('T3_EXT_SOURCE_CHANGED_BEFORE_WRITE');
        // Avoid overwriting a concurrent link. The original Kernel enforces
        // base_revision=0; a conflict MUST NOT be retried here.
        if (await ctx.readLink()) deny('T3_EXT_CONCURRENT_LINK_CONFLICT');
        const command = {
          workspace_id:ctx.workspaceId, object_id:ctx.objectId,
          schema_id:EXTERNAL_PROCESS_LINK_SCHEMA, schema_version:'1.0.0',
          base_revision:0, data:source, extensions:{},
          event:{event_type:EXTERNAL_PROCESS_LINK_EVENT,payload:{
            source_owner:source.source_owner, record_kind:source.record_kind,
            record_id:source.record_id, source_revision:source.source_revision,
            epistemic_status:'reported',
          }},
        };
        // Set uncertain status before calling the ORIGINAL Kernel. Never
        // automatically replay a lost write or a revision conflict.
        let dispatched = false;
        try {
          dispatched = true;
          const receipt = await ctx.signed.putObject(command);
          await ctx.check();
          const persisted = await ctx.readLink();
          if (!matches(persisted,ctx.workspaceId,ctx.objectId,source) ||
              receipt?.object?.revision !== persisted.revision ||
              receipt?.object?.object_id !== ctx.objectId ||
              typeof receipt?.event?.event_id !== 'string')
            deny('T3_EXT_KERNEL_READBACK_MISMATCH');
          return Object.freeze({status:'LINK_PERSISTED',workspace_id:ctx.workspaceId,
            object_id:ctx.objectId,revision:persisted.revision,
            event_id:receipt.event.event_id,source_revision:source.source_revision,
            epistemic_status:'reported'});
        } catch (error) {
          // These original D1 denials are conclusively pre-dispatch. Keep
          // the real authorization error instead of disguising it as a write.
          if (['T3_ACCESS_NOT_PERMITTED','T3_ACCESS_DECISION_BINDING_INVALID',
              'T3_SUBJECT_CONTEXT_UNAVAILABLE','T3_SUBJECT_WORKSPACE_OUT_OF_SCOPE',
              'T3_KERNEL_OPERATION_NOT_GRANTED','T3_KERNEL_INPUT_SCOPE_MISMATCH']
              .includes(error?.code)) throw error;
          if (dispatched) return Object.freeze({status:'OUTCOME_UNKNOWN',
            workspace_id:ctx.workspaceId,object_id:ctx.objectId,
            cause_code:error?.code || 'WRITE_ACK_OR_READBACK_LOST'});
          throw error;
        }
      } finally { pending.delete(ctx.objectId); }
    });
  }
  async function recover(input) {
    return withSelected(input,async ctx => {
      const source = await ctx.readExternal();
      const persisted = await ctx.readLink();
      if (!persisted) return Object.freeze({status:'NOT_FOUND',
        workspace_id:ctx.workspaceId,object_id:ctx.objectId});
      if (!matches(persisted,ctx.workspaceId,ctx.objectId,source))
        return Object.freeze({status:'REVISION_CONFLICT',
          workspace_id:ctx.workspaceId,object_id:ctx.objectId,
          saved_revision:persisted.revision,source_revision:source.source_revision});
      return Object.freeze({status:'LINK_PERSISTED',workspace_id:ctx.workspaceId,
        object_id:ctx.objectId,revision:persisted.revision,
        source_revision:source.source_revision,epistemic_status:'reported'});
    });
  }
  return Object.freeze({link,recover});
}
