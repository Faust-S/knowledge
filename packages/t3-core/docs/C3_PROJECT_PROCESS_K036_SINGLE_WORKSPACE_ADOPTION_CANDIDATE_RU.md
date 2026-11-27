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

The current native source runner is `packages/t3-core/scripts/run-c3-project-process-qualification.mjs`; native source qualification at a6c561ae60df88900d22b8ccc692407a9d7d7392 ([run 45957862833](https://github.com/Faust-S/knowledge/actions/runs/45957862833)) passed 141/141 C3 cases, 26/26 additional source cases, 93/93 targeted model/DOM cases and TypeScript/Vite. It is not D4 and does not authorize production writes.

## 6. Current-subject investigation, 27 November 2026

User confirms there are no legacy user records to move. Do not add a migration pipeline from the standalone canonical database. Original recovery and exact release acceptance still apply to newly created records; do not relabel the old migration/recovery gate as PASS.

Evidence from the retained K036 atomic-graph `ScopedWorkspaceApi.ts` (Git blob SHA-1 `2bc34d25d1f8cd8ae018c4e0606ee07a9f97429f`): original `getObject` and `listObjects` apply schema read permissions, whereas `listEventsSince(workspace_id,since?)` applies Workspace read and optionally service scope, not object-schema read. Nine extracted exact-source method checks with controlled LocalStore ports reproduce the boundary. This is not a native transport, IndexedDB or installed Kernel qualification. The same-store successor generator patches database and import keys, not these methods. The existing `by_object` event index is not exposed as a permission-aware revision read API.

- A. Full canonical snapshots in regular Event: rejected as the current unrestricted common mapping. A shared Workspace event reader could receive content of a schema it cannot read via getObject. Service-only events also cannot serve all authorised consumers of a common Workspace; need explicit current-subject proof, not assumption.
- B. Immutable revision objects and head/predecessor relations in the same existing Kernel: candidate remains technically possible, not implemented/approved. Schema visibility can be preserved, but first-write identity, head CAS, history lookup, tombstone, nested refs remap and catalog growth must be proved. Existing graph commit writes one object only. Do not duplicate current logical business objects in the ordinary catalog or enumerate all revisions on opening Workspace.
- C. If B cannot meet actual performance and history access requirements without duplication, narrowly extend the original Kernel/contract with addressed, permission-aware historical reads and original Exchange participation. This requires an explicit architecture/contract decision and current-subject qualification, not a second Core/Store or separate format. No Kernel changes made in W04.11–W04.14.

`listObjects(limit)` also forwards limit before the schema visibility filter; naive limited queries may underfill visible results. There is no cursor in this surface. Keep complete current catalog semantics until an authorised indexed page contract is available. W04.12–14 optimize existing Host lazy graph/journal and projection; full catalog payloads still fetched; explicit full history still fetched. The 12/12 native source-gate tests guard direct standalone adapter references in active source, not runtime persistence.

## 7. Exact released runtime witness (W04.18, 27 November 2026)

[Public run 45958342493, job 140369961808](https://github.com/Faust-S/knowledge/actions/runs/45958342493/job/140369961808) at a2c20a5bad8fa4b66c1485e4159b28d71252af59, receipt artifact 15179264320: 34/34 mandatory checks PASS_PRIMITIVES_ONLY, direct import of the exact published runtime bytes after matching both SHA-256 values above, native Node 22.23.5 and the original Kernel lockfile's fake-indexeddb dependency, synthetic fixture schemas/passports and Web Locks/fetch fixture. No production owner implementation, production permissions or browser persistence are inferred from it. Reproduction script: `packages/t3-core/scripts/probe-k036-c3-mapping.mjs`.

- The stable anchor is an empty bootstrap object with base_revision=0; first revision requires a separate atomic graph commit. A partial bootstrap anchor is not a committed business record. Concurrent first writes require a permanent origin relation that is NEVER removed. Merely reusing an initial head relation ID would permit a delayed initial create once that head is deleted. Exact runtime rejected a second anchor, rival first commit and delayed first commit after a successful advance.
- Later revision commit inserts one immutable revision object, replaces the exact expected head relation, creates the predecessor relation, appends a metadata-only event and original replay receipt. Exact runtime concurrent writers gave exactly one winner; stale predecessor, changed idempotency payload and delayed first create rejected with no leftover object/event. Repeat returns the original transaction even after a logical tombstone; tombstone and predecessor chain remain readable.
- Reader with only fixture anchor schema cannot get/list revision payloads; shared journal carries metadata only. This is not D1 qualification of original owner/families. One observed database: iwxa-local. Cache reset with the same fake factory preserves chain, not a physical cold restart.
- Complete original Exchange with all include flags produced 3,637 bytes in the fixture. Same-ID import in a fresh fake factory restored chain, original event IDs and matching semantic digest. Copy to another Workspace restored outer objects/relations and left source unchanged, **but all three nested refs.workspaceId values still pointed to source** (nestedRefsRemapped=false). Do not treat same-Workspace candidate as compatible with Workspace copy/import.
- Original C3 `projectProcessSourceObjectId(kind,workspaceId,id)` embeds the encoded Workspace ID, and owner live/history read verifies both payload.workspaceId and refs.workspaceId; canonicalHeads also embed scope. Method revision attempt digest includes workspaceId. Therefore simply reading the copied immutable bytes under a new Workspace ID, globally searching old record IDs, blindly rewriting arbitrary JSON or recomputing/replaying the old partial operation is not a valid remedy.
- Required design: separate immutable provenance from target-local bindings, with explicitly scoped owner adapter instance and bounded stable physical keys; qualify exact original record readback, nested reference and creation-plan semantics, partial attempt behavior, duplicate package import and target permissions before authorizing cross-Workspace writes. A new-Workspace import must remain unusable for methodology mutation until that mapping is accepted. Same-ID restoration and new-Workspace copying are distinct cases. If source-relative physical storage cannot preserve the original owner contract and full-catalog performance, return to option C; no second DB/parallel architecture. Fixture revision count contributes to original listObjects (four objects for one anchor and three revisions). Actual 100/1,000/10,000-object Host latency remains NOT_RUN; no claim of production speed or immutable history against all other writers.

## 8. Explicit owner decision requested

Approve or reject the following bounded change:

**Approve a K036 same-Workspace persistence adapter for the existing `iwxa.project-process.owner` and its original OwnerWriteGateway, using only the existing Kernel 0.3.6 / Runtime 1.3.0 T1 object, relation and event stores, with the same eight source families and unchanged Result/Acceptance exclusion. No new Store, Host, Graph, IAM, Task Engine, Router, generic business-object writer or .iwxa format.**

Approval would authorize implementation and qualification of this adapter only. It would not itself activate production writes, approve D1 rights, satisfy D4, authorize Result/Acceptance, or release any product. Those remain separate original owner gates.

## 9. W04.21: target-local physical identity and transfer investigation

The W04.18 witness used the exact K036 artifact but caught all failures of its new-Workspace observation, including failed assertions. W04.21 makes successful copy, chain preservation and source isolation mandatory while retaining nested-scope behavior as a reported observation. It additionally tests same-ID replay after import (actual original transaction identity versus rejected replay, with no mutation), repeated copying to different targets, copy-of-copy, and independent advancement in a separate live fixture. It checks actual copied head relation identity rather than assuming that re-deriving a key from the target workspace works. The released fixture is never resurrected. Reimport of an old package into a newer copy must not roll its history back. All changes are qualification-only; no new production persistence adapter or permission. New native CI evidence is pending until an exact completed run is inspected.

Candidate direction for further approval: physical anchor/revision keys scoped by the original Kernel workspace key, stable across copies; explicit immutable source record provenance; an owner-aware target-local binding for only known reference fields, never arbitrary JSON rewriting. The original source owner still requires the scoped logical object ID, payload.workspaceId and refs.workspaceId to agree. A target-local binding cannot be represented as the same exact canonical record unless its provenance and its target representation are kept distinct. Material revision pins and creation-plan record IDs must close within the target; incomplete imports or unknown reference versions must not fall back to the source. An interrupted same-ID restore and an independent copy have different operation identities; never replay an origin attempt in the target just because its record IDs were copied. Existing kernel replay receipts may differ from the exportable business audit; test rather than assume. If original contract cannot be preserved without catalog growth/duplicate source truth, choose the bounded original Kernel extension (option C) for owner decision. No migration of legacy user data, additional Store, format or execution authority.

## 10. W04.22: exact owner on the released K036, qualification only

W04.21 completed on 9c8c1d6fe2f543518415b855fb382ca336179995, public run [45962446273](https://github.com/Faust-S/knowledge/actions/runs/45962446273), runtime job 140383205592, artifact 15181565702. 54 mandatory primitive checks; direct logs show same-ID replay after import rejected CONFLICT (original graph receipt not restored); semantic digest unchanged; duplicate new-Workspace import rejected WORKSPACE_MAP_INVALID; copied physical relation ID is source-derived, not target-derived. Two copies, copy-of-copy and independent source/target advances preserve physical chains. Nested source scope remains unchanged. Original C3 151/151 and portable Node 990/990, Vitest 1195/1195, TypeScript/Vite PASS. No production approval inferred.

Added a qualification-only adapter under scripts, never imported by Host. It connects the ORIGINAL OwnerWriteGateway and Project/Work owner to released K036 T1 without using an additional persistent store or MemoryCanonicalAdapter. The fixture uses hashed bounded physical keys, original canonical wire record, derived head, metadata-only audit in original Event, permanent first-revision guard and exact existing head CAS. It verifies canonical identity, encoded knowledge time, predecessor relations and audit readback. Stable anchor identity derived from family and local business ID deliberately detects copied foreign-scope data rather than pretending it is absent or silently binding it to the target. Original permission-aware T1 is used but schemas/passports are synthetic fixtures; production D1, eight-family schema declaration, immutability against other writers, cross-Workspace owner binding and D4 remain unqualified. Ordinary read cost is measured by addressed-call count before/after 64 unrelated revisions; the actual unfiltered catalog growth is recorded separately. This is not Host latency or physical IndexedDB acceptance.

The exact-runtime witness now writes a planned four-stage method through original owner, loses a real graph acknowledgement, interrupts a second selective edit before its dependent, exports the partial state, resets the runtime into a fresh fake-indexeddb factory, restores same ID through original Exchange, compares original canonical record and audit bytes, resumes only the missing revision through a new owner and checks replay. It tests original scope isolation and explicit refusal to load an independently copied owner record until an approved target binding exists. CI results pending at publication. Qualification adapter is a disposable candidate witness, NOT approved production storage. If the full catalog burden cannot be solved within existing original access paths, advance option C (bounded original Kernel contract extension) rather than hiding growing history in a second store.
