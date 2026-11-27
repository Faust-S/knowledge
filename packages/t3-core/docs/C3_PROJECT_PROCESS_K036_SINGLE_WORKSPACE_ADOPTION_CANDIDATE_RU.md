# C3 Project/Process: K036 same-Workspace persistence adoption candidate

**Status: CANDIDATE_NOT_APPROVED. Production writes remain disabled.**

## 1. Decision boundary

The original approved receipt is [C3 Project/Process Owner Approval](https://github.com/Faust-S/T2/blob/39a0b3205ea45a55c3db45b99f5bcf4f0283aef1/t2/current/final-successor/product/approved/C3_PROJECT_PROCESS_OWNER_APPROVAL_RECEIPT_2026-09-18.json), exact Git blob SHA-1 identity `e1a57a77ff2368b2d2338d978b490ca529389f99`.

It adopts `iwxa.project-process.owner` for exactly eight source families and create/revise/release commands. It excludes Result and Acceptance writes. It does not authorize production writes until Bridge/D1, producer schemas, migration/recovery, same-Workspace history and exact D4 gates pass. It explicitly excludes Kernel 0.3.6 and requires a new owner decision if the canonical persistence boundary changes.

This document proposes a current-subject persistence mapping for the existing owner. It is not an approval, activation receipt, D1 grant, D4 evidence or release decision.

## 2. Verified current storage mismatch

- The current original `OwnerWriteGateway` uses `CanonicalPersistence`. Its `IndexedDbCanonicalAdapter` defaults to database `iwxa-t2-canonical` and owns records, heads and audit stores.
- The original atomic-graph source overlay uses `iwxa-local` DB_VERSION 7. The active qualified same-store history artifact `iwxa-kernel-k036-same-store-history-20261019-qualified.1` uses DB_VERSION 8, runtime SHA-256 `e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78`, archive SHA-256 `7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68`. Its original stores include Workspace, objects, relations, events, assets, schemas and atomic graph replay receipts. The [original same-store qualification](https://github.com/Faust-S/T2/blob/39a0b3205ea45a55c3db45b99f5bcf4f0283aef1/t2/current/final-successor/kernel-successors/k036-same-store-event-history-20261019/QUALIFICATION.md) reports 36/36 Kernel tests and physical Chromium Workspace roundtrip; it is not qualification of the new methodology records.
- K036 `t1.commitObjectGraph` writes one object, relation puts/deletes and one event in one read-write transaction. It enforces `base_revision`, idempotency, schema declaration and schema-specific permissions.
- The original Kernel Exchange exports a Workspace package with configurable history, assets, relations and schemas. It does not export an unrelated `iwxa-t2-canonical` database.

Therefore activating `IndexedDbCanonicalAdapter` directly in the product would split Project/Work history from the Workspace and its `.iwxa` lifecycle. This is rejected. Do not instantiate that adapter in the production Host.

## 3. Candidate technical direction

Retain the existing `iwxa.project-process.owner`, its eight family bindings, the original `OwnerWriteGateway` command boundary, source-head references and the existing T3/Kernel/Host/Exchange. Replace only the persistence adapter, subject to a new explicit owner decision, with an adapter over the original K036 T1 surface in the same Workspace.

Candidate mapping to prove, not assume:

1. Each logical Project/Work/Process source identity has a stable Workspace-scoped head anchor.
2. Each immutable canonical source revision has a revision object carrying exact ownerId, commandId, recordId, revision, previousRevisionId, knowledgeAt, operation and canonical references. The normalized source payload remains the object data.
3. Existing K036 relations carry the current-head pointer and predecessor chain. A revision commit creates the new revision object, changes the head relation and appends the predecessor relation in one `commitObjectGraph` transaction. The relation identifier is bound to the expected previous record so a stale concurrent writer cannot delete a newer head.
4. The existing K036 Event carries the exact append-only audit and write receipt. Idempotency uses the original canonical record identity and exact payload. A tombstone is a new immutable revision and never deletes prior history.
5. Readback follows the head and predecessor relations using the original Kernel API. It must reconstruct the exact original owner record and history without a second Store or a synthetic latest-only view.

The first-write anchor, revision object identity, relation CAS, tombstone representation, record lookup, audit enumeration, event retention and import remapping must be qualified with the exact K036 implementation. The K036 graph API is one-object-per-transaction; it is not a general multi-object transaction. No code in this candidate may claim atomic multi-object creation.

## 4. D1, schemas and Exchange

- The owner service needs the exact `t1.commitObjectGraph` operation and read permissions for the eight approved source schemas. K036 authorizes the operation and each endpoint schema. The D1 grant must be scoped to the active Workspace and the original owner service; an ordinary viewer or generic module permission is insufficient.
- The eight producer schemas must be declared in the original Kernel schema registry and validated by K036. The internal owner envelope must not weaken or bypass source payload validation.
- Complete Workspace export/import must include every revision object, relation, audit event and schema. Cross-Workspace import must remap Workspace IDs, object IDs and embedded `canonicalHeads` consistently. The existing Exchange cannot be presumed to rewrite arbitrary nested references. If it does not, a scoped owner-aware import reconciliation must be approved and qualified before release.
- Cold process restart must restore the exact head, history, tombstones and audit from the same `iwxa-local` database and imported Workspace package. No second IndexedDB, hidden file store, new object store, private browser cache or sidecar archive is allowed.

## 5. Required qualification before any activation

| Gate | Required proof |
| --- | --- |
| Owner identity | Exact original owner and eight families; Result/Acceptance remain excluded |
| First write | Concurrent create, exact source identity, no duplicate anchor |
| Revision | Exact base recordId/revision CAS; stale concurrent writer rejected |
| Relations | Exact current head and predecessor chain, same Workspace only |
| Lost acknowledgement | Same idempotency key returns exact receipt; no duplicate revision/event |
| Tombstone | Current read returns absent; historical read retains all prior records |
| D1 | Exact service, operation and per-schema rights; denied read/write tests |
| Cold restart | Fresh Host/Kernel process recovers identical history and head |
| Exchange | Full .iwxa export/import, assets/schemas/relations/events/history, identity remap and independent readback |
| Downgrade | Old client cannot silently overwrite or erase method metadata |
| D4 | Current Kernel 0.3.6 / Runtime Contract 1.3.0 exact release and source evidence, not the old K035 0.3.5 receipt |

The current native source runner is `packages/t3-core/scripts/run-c3-project-process-qualification.mjs`; it validates the exact clean HEAD, active runtime source contract and the current discovered C3/Workspace test set (97 cases at the earlier W04.10 revision; current full native count not yet qualified). It is not D4 and does not authorize production writes.

## 6. Current-subject investigation, 27 November 2026

User confirms there are no legacy user records to move. Do not add a migration pipeline from the standalone canonical database. Original recovery and exact release acceptance still apply to newly created records; do not relabel the old migration/recovery gate as PASS.

Evidence from the retained K036 atomic-graph `ScopedWorkspaceApi.ts` (Git blob SHA-1 `2bc34d25d1f8cd8ae018c4e0606ee07a9f97429f`): original `getObject` and `listObjects` apply schema read permissions, whereas `listEventsSince(workspace_id,since?)` applies Workspace read and optionally service scope, not object-schema read. Nine extracted exact-source method checks with controlled LocalStore ports reproduce the boundary. This is not a native transport, IndexedDB or installed Kernel qualification. The same-store successor generator patches database and import keys, not these methods. The existing `by_object` event index is not exposed as a permission-aware revision read API.

- A. Full canonical snapshots in regular Event: rejected as the current unrestricted common mapping. A shared Workspace event reader could receive content of a schema it cannot read via getObject. Service-only events also cannot serve all authorised consumers of a common Workspace; need explicit current-subject proof, not assumption.
- B. Immutable revision objects and head/predecessor relations in the same existing Kernel: candidate remains technically possible, not implemented/approved. Schema visibility can be preserved, but first-write identity, head CAS, history lookup, tombstone, nested refs remap and catalog growth must be proved. Existing graph commit writes one object only. Do not duplicate current logical business objects in the ordinary catalog or enumerate all revisions on opening Workspace.
- C. If B cannot meet actual performance and history access requirements without duplication, narrowly extend the original Kernel/contract with addressed, permission-aware historical reads and original Exchange participation. This requires an explicit architecture/contract decision and current-subject qualification, not a second Core/Store or separate format. No Kernel changes made in W04.11–W04.14.

`listObjects(limit)` also forwards limit before the schema visibility filter; naive limited queries may underfill visible results. There is no cursor in this surface. Keep complete current catalog semantics until an authorised indexed page contract is available. W04.12–14 optimize existing Host lazy graph/journal and projection; full catalog payloads still fetched; explicit full history still fetched. The 12/12 native source-gate tests guard direct standalone adapter references in active source, not runtime persistence.

## 7. Explicit owner decision requested

Approve or reject the following bounded change:

**Approve a K036 same-Workspace persistence adapter for the existing `iwxa.project-process.owner` and its original OwnerWriteGateway, using only the existing Kernel 0.3.6 / Runtime 1.3.0 T1 object, relation and event stores, with the same eight source families and unchanged Result/Acceptance exclusion. No new Store, Host, Graph, IAM, Task Engine, Router, generic business-object writer or .iwxa format.**

Approval would authorize implementation and qualification of this adapter only. It would not itself activate production writes, approve D1 rights, satisfy D4, authorize Result/Acceptance, or release any product. Those remain separate original owner gates.
