# IWXA T3 / Activity: public development routes for AI

Date 2026-11-13. Status: OWNER-DIRECTED PUBLIC ADOPTION GUIDE; does not grant access, mutate source facts, implement private contracts, or qualify a product.
Architecture owner: Faust-S/iwxa, branch knowledge/2026-10-02-system-atlas, architecture/IWXA_PROCESS_EVIDENCE_ACCESS_EXPERIENCE_PROFILE_2026_11_13_RU.md.
Machine owner route: Faust-S/iwxa, knowledge/system/AI_PROCESS_EVIDENCE_ACCESS_ROUTE.json.
42-repository registry: Faust-S/iwxa, coordination/repositories.json; 11 domain pairs: knowledge/system/DOMAIN_CODE_OWNERSHIP_RU.md. Those private sources are design navigation only and MUST NOT be fetched by this public build or CI.
Root instruction: AGENTS.md of this repository; D1–D7/G4 baseline and active T3 handoff in packages/t3-core/handoff.

## Source-of-truth boundaries

- Foundation semantics: Faust-S/T0 and Faust-S/T1; use four T0 concepts and seventeen T1 concepts, no invented primitives. Reuse exact source scopes and observed refs; the private architecture itself does not authorize a runtime read.
- Original T2 compatibility: Faust-S/T2@main/AGENTS.md. Preserve Runtime Contract 1.3.0 and existing methods (for example t1.getObject, t1.listEventsSince, t2.exportPackage). T3 is the successor and must retain original B0 operations. Never run a second T2 Core inside upgraded T3.
- **Only executable T3 owner**: this public repository at packages/t3-core/. Signed D1 Control/Access, selected Workspace, original Kernel/Host, D2 projection, Process Intelligence, original .iwxa Exchange, D3–D7/G4 and T3 CI are here, not private Faust-S/T3 and not Center.
- **IWXA Activity**: this public repository at modules/activity-base-anonymizer/ with desktop/ Tauri UI in the Activity development branch. It reads the original source Workspace through independently signed T3 Activity Read and may save a private owner-local review draft ONLY in a different Workspace of the same principal through separate signed Activity Derive, the SAME original Kernel and one Host-selected CurrentWorkspaceStore. It is NOT IAM, a second Store, source authority, or automatic disclosure right.
- Agent Task/Goal/Graph/Skills/ToolRuntime/Human Review belong to Faust-S/iwxa-personal-agent. Admin/Publisher/Setup belong to Faust-S/Center with private specifications in Faust-S/IWXA-Admin-Center. Atlas owns projects/plan-fact. Domain business logic belongs to non-web domain repo; its site owns routes, display and one dist. D12 IWXA main website is Faust-S/iwxa-ru-1.
- Old Faust-S/T3 is historical architecture only, no executable runtime or CI. No private checkout, secrets, token, hidden source or private GitHub Actions permitted for public knowledge builds.

## Six action routes

PROCESS_CAPTURE: actual domain operation -> original T3 Object/Event/Result -> D2 read-only, version-pinned T0/T1 projection -> Activity. Never reclassify an inferred event as observed or create a parallel Store.

MODEL_VERIFICATION: original Evidence/Provenance -> object-centric AS-IS, variants and conformance -> fit/precision/generalization/simplicity and explicit uncertainty -> subject-specific domain acceptance. Time ordering is not causality.

GRANT_OR_REVOCATION: authorized human or corporate representative -> original signed T3 Access/Authority/Rights -> exact actor, principal, subject, Workspace, resource, purpose and current grant/status -> JIT operation and receipt. Agent capability and Publisher entitlement do not provide business authority.

DERIVE_AND_ANONYMIZE: separately authorized read and analyze -> derived provenance -> privacy/linkage, rare trace, commercial IP risk -> authorized recipient-specific disclosure. If risk, source or grant is UNKNOWN, no public transfer. A derived structural preview is not anonymization certification.

TRANSFER_AND_REUSE: specific share/transfer permission -> original .iwxa Exchange, signed by authorized issuer -> independent recipient verification and target admission -> recipient-owned Workspace, Rights and execution -> new Result and cold readback. No second portable format, no copy of foreign Store or confidential grants.

OPTIMIZATION: evidence-based AS-IS -> proposed TO-BE -> authorized domain/human decision -> actual operation -> measured domain Result / plan-fact. Predicted savings are not observed improvements.

## Rights on process, RAG, Skills, agents

Treat read_source, analyze, derive, execute, modify_source, review, accept, anonymize, share_to_subject, publish, commercialize, import, reuse, revoke, audit as ROUTING CATEGORIES to existing T1 Rights and T3 operation-specific grants, not new public Kernel methods. Organization may grant an employee selected process, RAG or Skill and a narrowly tasked Agent, while personal household Agent, corporate source database, tools and other agents remain in their own subject contexts. Human accountability must remain traceable. An offline missing/late revocation is not evidence of grant validity; use the applicable currentness gate.

## Standards and implementation states

W3C PROV / RDF / JSON-LD / SHACL support provenance bindings and validation, not claim truth.
OCEL 2.0 requires explicit qualified many-to-many E2O/O2O; the Activity reader currently implements a restricted synthetic profile. T3 D2 supports a primary object_ref plus optional qualified object_refs from version-pinned event.object_links with exact revision and qualifier; it is a restricted E2O projection, NOT full OCEL 2.0 conformance. D2 version-pinned event bindings may carry epistemic_status (observed, reported, declared, inferred, proposed). An Event record is not proof that a reported/inferred/proposed business operation occurred; Activity excludes these from observed traces and holds verification. Missing epistemic_status in older records preserves old D2 behavior but does not certify truth.
XES trace projection can lose object-centric information. BPMN 2.0, DMN, CMMN require distinct parse, display, semantic conformance and real execution tests. ODRL/VC are interoperability patterns, not authorization overrides. Lean/Six Sigma/TOC/APQC PCF are optimization frameworks rather than core T1 primitives.
For each claimed standard track profile/version, supported subset, loss, structural/semantic/roundtrip/runtime qualification separately.

## Development order and acceptance

1. Check root AGENTS.md, fresh branch HEAD/TREE, D1–D7 handoff, real source modules and CI, then exact domain/Activity owner.
2. Reuse current T3 Access, D2 reader, Process Intelligence and original .iwxa. Close a concrete missing product behavior, not a new testing/authorization framework.
3. Implement in the single owning repo, test locally where possible, use public knowledge Actions for necessary public CI, never Actions in private IWXA repos; leave Codex to unavailable installed Windows GUI / independent acceptance.
4. Verify negative read/derive/share/revoke cases, MULTI-object Event references with qualifiers and revisions, source snapshot consistency, privacy HOLD, recipient admission and actual Result/readback/cold restart.
5. Qualify one domain at a time; first integrated proof target D05 CehoVod process with defect/rework, AS-IS -> TO-BE -> independent execution and measured plan/fact.
6. Mark source-level PASS and installed product PASS separately. T3_READY=false and Activity external .iwxa transfer NOT_ACCEPTED until real complete product evidence exists.

This guide is source-navigation and semantics only. It does not implement the six routes, grant permissions, publish a package or change the runtime readiness status.


## Signed owner-local Activity derivation: one original T3 Host

The installed product must provide an explicit original T2 KernelFacade from the EXISTING trusted T3 Host (not the already source-bound ModuleContext.kernel), one source CurrentWorkspaceStore, and two separately signed original Control operations: activity.read for the selected source, activity.derive for a different Workspace of the same actor/principal/realm/organization. The derive target Workspace ID is obtained only from the currently signed derive owner context and must be rechecked with the original signed Access and Kernel before material write.

The Activity host composition is `Faust-S/knowledge/modules/activity-base-anonymizer/t3-control-host-link.mjs`, `openOriginalT3ActivityReviewHost`; the original Kernel private draft writer is `t3-owner-review-stage.mjs`. Read remains available if derive is absent. The single Control invalidation stream is shared or its existing Host owner fan-outs notifications; a second Control SSE/Store/issuer is forbidden. The regular original T2 service passport for `iwxa.activity.reviewer` and typed `iwxa.activity.process-review` is prepared via `t3-owner-review-passport-registration.node.mjs` for normal Host build registration, not added by a new registry or renderer.

The native installed Host registration, cold-restart process readback, external privacy/disclosure approval and recipient .iwxa admission are NOT_ACCEPTED. A private OWNER_REVIEW_DRAFT is neither proven anonymous nor published; its service's export=false is not a universal Exchange prohibition for other services.
