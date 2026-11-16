# IWXA T3 D6: Agent 0.6 accepted Result → Atlas 0.9, native publisher

Date: 2026-11-17. Status: SOURCE_CONTRACT_PASS; INSTALLED_D6_NOT_ACCEPTED.

## Exact owner split

Original executable T3: Faust-S/knowledge, packages/t3-core.
Original Agent Task/Result/Human Review: Faust-S/iwxa-personal-agent, work/2026-11-16-agent06-original-t3-result-owner-d6.
Private corporate signer and Reconciliation: Faust-S/T3, work/2026-11-16-t3-agent06-original-export-ledger-readback.
Original Atlas native recipient: Faust-S/Atlas, work/2026-11-16-atlas-0-9-t3.

Public T3 source adapter: src/t3/native-agent-atlas-source-publisher.mjs
Public source contract test: tests/t3-d6-native-agent-source-publisher.test.mjs
Public source CI: .github/workflows/t3-agent-atlas-original-publisher.yml

Do not create or install another signer, Kernel, Exchange, IAM, Reconciliation ledger or Task Engine.
Do not upload private signer, Agent sources, archives or native builds to public Actions.

## Original installed owner ports still required

The adapter only composes trusted installed owners. It never simulates an original issuer or treats tests as an authority.

- originalLedger: read, reserve, finalize, findByObject, findByWork, findLatestWork. Must be the **same durable original Reconciliation** as the installed signer, with a verified negative UNISSUED answer, immutable operation binding, and preserved PREPARED/COMMITTED/OUTCOME_UNKNOWN after two cold restarts. An absent row is not verified UNISSUED.
- originalEmployee: verifySignedTask, authorizeAtlasExport. Must verify exact current corporate identity, task revision, live grants, and independent recipient iwxa.atlas. Grant for organization's interop.result.v2 is not permission to publish to Atlas.
- acceptedSource: readAccepted. Must return persisted human-accepted Result from the running Agent Core. Caller must not supply model text or any purported accepted digest.
- prepareOriginalGraph: prepare the canonical original T2 Kernel schema/graph command; original Kernel must persist an Object/Event with signed task id, signed revision, package digest, context digest, Agent task/result IDs, human-accepted digest, and exact Atlas WorkRef.
- originalExchange: publishSelectedResult and verifySelectedResult. Must use original signed T2 Exchange, original persisted bytes, original recipient proof and the original archive's exact SHA-256, not a synthetic carrier or organisation-addressed export.
- kernel/access: the original signed T3 D1 Host and original T2 contract 1.3.0, with t1.commitObjectGraph, t1.getObject, t1.listEventsSince; independent JIT rights and persisted Object/Event readback.
- confirmDisclosure: independent native Human disclosure consent, distinct from accepting the AI draft and independent of Atlas write review.
- isHostActive: trusted installed lifecycle; no UI-selected substitute.

Installed Agent's `original_source_owner=` must receive this native adapter via its trusted bootstrap. Public T3 JS code must be packaged into the *same* installed original Host, not another localhost service. The module uses Node crypto and therefore belongs on the trusted native Host side, never in the browser bundle.

## Transaction and recovery

1. Derive operationId from the original accepted Task/Result, signed task revision, recipient and WorkRef in Agent. The sender recomputes it independently.
2. Read original durable ledger. UNISSUED requires positive ledger/no-prior-dispatch proof; any other result is recover-only.
3. Check live employee rights for **iwxa.atlas**, original accepted source, independent Human consent, JIT rights and no earlier operation.
4. Prepare original graph; reserve exact operation in the original ledger **before** the original Kernel write.
5. Write **one** original Kernel Object/Event, call original signed Exchange for iwxa.atlas, and finalize in original ledger. All post-reservation exceptions are OUTCOME_UNKNOWN, never automatic retry.
6. After COMMITTED, independently read original Kernel Object/Event, original signed Exchange bytes/recipient/receipt and the original ledger, then expose sourceObjectRef to Agent. The installed Atlas must separately verify its native Store receipt and two cold reopen reads.

Tests cover successful source publication, original owner readback, human refusal, revoked export permission, reserve lost ACK, Kernel lost ACK, finalize lost ACK and cold-original-ledger recovery. Tests use boundary fixtures; they do not prove a real original signer, native Exchange or installed Atlas.

## Mandatory next product verification

- Connect the actual private original ledger, signer and T2 Exchange to the adapter in the installed native T3 Host without copying them to public knowledge.
- Run an authentic signed corporate Task → installed Agent Task → genuine Result and Human Review → native original T2 Object/Event → signed iwxa.atlas .iwxa → Atlas native write/receipt → **two cold readbacks**.
- Repeat with consent denial, grant revocation, unknown ACK at each durable boundary, changed Task revision, changed WorkRef, and cross-organization/recipient mismatch.
- Run native installed Windows qualification and full Setup Core separately from source CI.
- Set D6_END_TO_END=PASS only after all original receipts, archive bytes and installed Atlas native Store readbacks are independently witnessed. Current status D6_END_TO_END=NOT_ACCEPTED and T3_READY=false.

## Privacy boundary

This branch runs only in public Faust-S/knowledge Linux Actions with public source. No private Actions, no temporary private checkout, no private artifact uploads, no signer, secrets or real account output. A successful public adapter test is not a claim of installed product acceptance.

## Update: 2026-11-17 private original Reconciliation owner

Private original owner integration now exists on
`Faust-S/T3@work/2026-11-17-t3-original-agent-atlas-d6-publication-ledger`,
with `reconciliation/atlas-source-publication-ledger.mjs` plus
`openInterop(...).originalAgentAtlasPublicationLedger()` bound to the original
Control employee's signed Task, corporate context epoch and owner lifetime.
It reuses **exactly the original ReconciliationLedger store**, generation chain,
atomic HEAD and writer.lock; no second ledger or signer is created.

Public source update `0d1cd46` verifies original Kernel Object/Event
**before signing** the recipient-specific Atlas Exchange, and original signed
archive bytes, recipient and source **before durable COMMITTED**.
Public CI #43968414777 SUCCESS. The existing D6 signed continuation tests
also passed.

Private new ledger tests have NOT been executed against the original private
Reconciliation runtime. Do not call them Windows/native PASS. Original private
corporate `interop.result.v2` is organization-addressed by its validator:
a distinct signed employee grant and original recipient-specific
`iwxa.atlas` Exchange carrier remain necessary. Do not weaken that validator
or relabel an organization archive.

Native product composition (signed issuer, trusted Agent accepted source,
original T2 Kernel and original T3 Exchange) is still not installed or
qualified. The Node-only sender module must be packaged for the original
**native Host**, not emitted into publicly served browser assets. Atlas's
native Store and two cold readbacks are still required.

Status: `PRIVATE_ORIGINAL_LEDGER_SOURCE_IMPLEMENTED`,
`PUBLIC_SENDER_CI=PASS`, `D6_INSTALLED=NOT_ACCEPTED`.


## 2026-11-17: separate original Atlas issuer and native Host composition

The original private T3 branch has advanced beyond its earlier missing-grant state:
\`Faust-S/T3@work/2026-11-17-t3-original-agent-atlas-d6-publication-ledger\`.

Original employer issuer can now **optionally** issue a separately signed DATA
\`package.export\` grant to \`recipient:iwxa.atlas\` using
\`admin.invite({workspaceRead:true,workspaceWrite:true,atlasResultExport:true})\`.
The default is false. Employee import verifies enrollment and original signed
grant. The original issuer can revoke the Atlas grant independently. Existing
organization-only interop.result.v2 export remains unchanged.

Native private T3 has an Atlas recipient-specific Ed25519 .iwxa Exchange over
its **existing** Reconciliation quarantine and original transfer ledger. It
signs only the accepted source reference, digest and Task/Work provenance;
original signature, archived bytes, manifest, recipient and original Kernel
Object/Event must all be reverified. The original private native Host
composition factory now connects original employee authority, original T2
Kernel/signed D1 Access, original Reconciliation, original Exchange and the
public sender factory as existing product ports.

Public sender revision \`6fd1bdb1\` passed public source CI
[№43976818522](https://github.com/Faust-S/knowledge/actions/runs/43976818522),
including native T2 graph input shape and original Exchange receipt evidence.

**Private T3 qualification remains blocked:** public Center CI
[№43976161978](https://github.com/Faust-S/Center/actions/runs/43976161978)
could not checkout private T3 (HTTP 403, read-grant unavailable for that repo).
This is not a test failure. Private Actions were not run, and no private
artifacts were uploaded. The Center workflow's SHA is the previous private
snapshot; update its exact pin only after authorized T3 read access exists.

Next required product work: mount the composition factory inside the genuinely
installed original T3 Host, connect its sourceOwner to Agent
InstalledOriginalAgentResultOwner through the existing native bridge, qualify
private issuer and real signed .iwxa, and run Atlas's native Store with two
cold readbacks. D6_END_TO_END remains NOT_ACCEPTED.


## 2026-11-17 native continuation: concurrency and separate original D1 grants

The existing private original T3 Reconciliation owner now returns
\`newReservation:true\` only from the fresh atomic PREPARED commit. A raced or
cold existing PREPARED returns false. Public source sender REQUIRES true
before starting original Kernel commitObjectGraph. A successful PREPARED
response without this fresh proof is OUTCOME_UNKNOWN and recovery-only.

The public sender now accepts an optional trusted, native-only
\`trustedSignedKernelForOperation(operation)\` selector, never a UI-provided
grant. Installed private T3 composition uses its **existing**
\`signedKernelAccess(originalKernelAccessPortFactory)\` to independently
enforce read authorization for original getWorkspace/getObject/listEventsSince
and write authorization for original commitObjectGraph. A valid writable
T2 Workspace is checked BEFORE reservation. The original source Event type
is pinned to \`iwxa.agent.result.published\` in source and private Exchange.

The original private Exchange gained READ-ONLY \`readRecordedTransfer\` for
recovery of an already signed archive after a lost ACK. The private trusted
Host gained explicit native maintenance method
\`reconcileRecordedPublication\`: only positively verified original signed
archive bytes, transfer, recipient and exact Kernel Object/Event may cause
the EXISTING Reconciliation ledger to finalize. This does NOT repeat Kernel
writes, re-sign a package or change Agent's read-only publication readback.
The existing prepared-only/unknown cases remain held.

Evidence: public source CI
[#43980356992](https://github.com/Faust-S/knowledge/actions/runs/43980356992)
SUCCESS on \`47d93a05\`; public CI
[#43979867539](https://github.com/Faust-S/knowledge/actions/runs/43979867539)
SUCCESS on \`72b0be6c\`. Four private composition tests also passed a
bounded V8 test-double execution, which does NOT replace the genuine
private Node/Ed25519 tests or actual installed Windows E2E.
Private original signer tests remain NOT_RUN due existing Center read
token failure (HTTP 403 for Faust-S/T3).

D6_INSTALLED=NOT_ACCEPTED; T3_READY=false.
