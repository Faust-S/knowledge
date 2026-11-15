# IWXA K05 / Agent 0.6 — Windows source qualification and next integration

Date: 2026-11-15. Purpose: a precise owner handoff for source-bound Agent effectiveness, not an installation/product acceptance certificate.

## Exact checked code and clean ownership boundaries

| Owner | Tested revision | Branch | Scope |
| --- | --- | --- | --- |
| K05 (public) | \`bc1adbfeba45a18926ac755bd51dc5501ba97085\` | \`Faust-S/knowledge@work/2026-11-15-agent06-effectiveness-evaluation\` | Read-only K05 source/metric/Task/Tool owner projections |
| Agent 0.6 (private) | \`42ae3f2af01c02f2119344157a4ad6092b7a57a7\` | \`Faust-S/iwxa-personal-agent@work/2026-11-15-agent06-k05-owner-readback\` | Existing TaskCell, ApprovalCell, ToolRuntime and their source-level tests |
| Center runner (public) | \`625085f573e99f3bb5312241597127530a5f531a\` | \`Faust-S/Center@work/2026-11-15-agent06-k05-owner-source-qualification\` | Approved transient private checkout, Windows qualification |

Common Agent/T3/Activity branches are NOT modified. No new Task Engine, Store, Graph, business event ledger or external BI platform.

## Verified PUBLIC K05 qualification

\`https://github.com/Faust-S/knowledge/actions/runs/43731436185\`

**185/185 full Python K05 regression, 6/6 original T3, 6/6 original Atlas = 197/197 PASS**.

New boundary: K05 requires each original ToolRuntime plan \`candidate_ref\` to appear among **original Core-verified Human Review** \`TaskCell.accepted_artifact.action_candidate_refs\` by both \`ref_id\` and digest. An accepted text-only Result does not imply permission for a tool. Unknown cost, human effort, repeated execution, external business outcome and causal ROI are not invented.

## Verified private owner Python on approved public Windows Center CI

1. \`https://github.com/Faust-S/Center/actions/runs/43730670219\`: 37/37 PASS. Actual original private \`ApprovalCell\`, \`ToolRuntime\` and execution-intent regression. These are source-level tests, not installed desktop acceptance.
2. \`https://github.com/Faust-S/Center/actions/runs/43730955114\`: 40/40 PASS. Real original ToolPlanningCell/ApprovalCell/ToolExecutionCell/ToolRuntime create one synthetic durable Plan→Approval→TXR; **a separate Python process** re-opens it through original owner read methods. Modified receipt digest or revocation before execution causes HOLD. No second provider invocation.
3. \`https://github.com/Faust-S/Center/actions/runs/43731179379\`: 42/42 PASS. Exact PUBLIC K05 is imported at runtime by PRIVATE original Agent (not copied into the private product). A real synthetic demo-model Task is created by \`DailyDriverEngine.chat\`, Human Review approved by \`DailyDriverEngine.review\`, and K05 \`read_agent_accepted_task\` validates the **original** TaskCell, Result, Review, AcceptedArtifact and again after a new Agent Core instance. Unapproved/rejected Tasks are not accepted.
4. \`https://github.com/Faust-S/Center/actions/runs/43731536621\`: **43/43 PASS**. Same exact original owner readback plus a negative test with real accepted Task but **no accepted ActionCandidate** and a synthetic foreign Plan written directly through ToolPlanningCell. K05 rejects it with \`EXECUTION_CANDIDATE_NOT_HUMAN_ACCEPTED\`; no provider or external operation is invoked.

All runs use Windows runner, previously authorized **read-only temporary private source token**, pinned SHA, \`persist-credentials:false\`, private dependency logs/XML only on ephemeral runner, NO upload-artifact/cache from this workflow. GitHub Actions in PRIVATE Agent were never started. Verified artifacts API for each of the four public Center runs: **0 uploaded artifacts**. Public logs expose only run statuses, counts and pinned SHAs, not private source, responses or files. The public Center runner temporarily accesses private source as specifically authorized.

## Original owner changes

- \`cells/approval.py\`: strict **read-only** historical scans of original approval decisions/revocations. A later revocation cannot obscure an earlier one; invalid original records cause HOLD rather than silently disappearing. Existing authoritative create/revoke/validate paths remain untouched.
- \`runtime/tool_runtime.py\`: read-only \`read_historical_execution_approval\` binds exact original Plan/Approval/TXR, policies, candidate, provider/tool/idempotency key, scopes and dates, rejects old refusals/revocations and simultaneous active authorizations, checks stable second read; expires/revocations AFTER execution do not erase valid past authorization or grant new rights.
- \`tests/test_k05_historical_approval_readback.py\`: source, scope, ambiguity, drift, revocation and no-repeat tests (22 including parametrized).
- \`tests/test_k05_original_owner_cold_readback.py\`: persisted original Cells and independent process readback.
- \`tests/test_k05_original_task_accepted_readback.py\`: PUBLIC K05 on actual PRIVATE TaskCell after review/restart and foreign candidate denial.

## Actual measured cost and product acceptance: still unresolved

The Windows qualification uses synthetic owner data, a demo model and a no-effect provider. Consequently:
- \`AGENT06_K05_ORIGINAL_SOURCE=PASS\`;
- \`AGENT06_K05_OWNER_COLD_PYTHON_PROCESS=PASS\`;
- \`AGENT06_K05_INSTALLED_TAURI_GUI=NOT_TESTED\`;
- \`AGENT06_REAL_TASK_TWO_EXECUTORS=NOT_TESTED\`;
- \`ACTUAL_ORGANIZATION_ROI=NOT_MEASURABLE\`.
- A Human-accepted draft is **not** an externally accepted business result; \`TXR SUCCEEDED\` is also not business acceptance.

Next practical owner workflow:
1. In a new isolated Agent integration branch, import K05 as **optional read-only dependency**, do not duplicate it or add mandatory runtime.
2. Read two real human-accepted Task instances through original Core, verify task definition equivalence, actual ToolRuntime and Owner approval receipts; record measured usage only where source receipts actually exist.
3. Supply original domain/Atlas *actual* cost and human labor invoices, full process cohort/coverage and baseline/after populations to \`compare_verified_process_runs\`. Forecast/plan never counts as actual.
4. Display OBSERVED/UNKNOWN/NOT_MEASURABLE and evidence permissions in Agent UI; make OpenTelemetry opt-in and exclude source contents.
5. Qualify installed Tauri/Setup Core and independent .iwxa/cold restore before raising product acceptance. No private Actions and no publication of user data.
