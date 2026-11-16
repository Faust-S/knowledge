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
