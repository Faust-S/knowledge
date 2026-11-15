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


## Дополнение 15.11.2026: сравнительная квалификация двух исполнителей и Operational Skills

Эта запись **дополняет**, а не отменяет приведённую выше матрицу ранее проверенных SHA. Новая узкая ветка PRIVATE Agent: `work/2026-11-15-agent06-k05-executor-comparison`, exact CODE HEAD `42c2afe6e305e239c3efe07f2172a4f96bd853aa`, TREE `7fea0643560c935d2aed869ffe60b7d5d894c136`. В этой ветке Agent повторно использует прежний PUBLIC K05 исходный код (тестовый checkout `b2de1d6cd8dd1e660183c16febd18da9ac3b94a7`).

Точный approved PUBLIC Center runner `bf5362b71f5f8d4ad07f741b7145902555fdbb01`: [Actions #43736861890](https://github.com/Faust-S/Center/actions/runs/43736861890) **SUCCESS, 56/56**. Группы: original K05 historical 22, original ToolRuntime cold reopen 3, original Task accepted readback 3, Agent comparator / operational Skill 13, Approval owner 8, Approval admission 2, intent recovery 5. Public uploaded artifacts = **0**. Private workflow не запускался, private исходники, полные логи, EXE и ответы моделей не публиковались.

Новый read-only `runtime/public_k05/agent06_effectiveness_bridge.py` квалифицирует две реально созданные через original Agent TaskCell **синтетические** Task, каждая из которых имеет собственные Human Review / Result. Owner повторно проверяет original model-run-record, ProviderRegistry history, Skill descriptor/source revision, модельную привязку и original Task/Review chain, затем передаёт в исходный PUBLIC K05 только source-bound evidence. При равных verified Task definitions и **разных** исполнителях: `TWO_ACCEPTED_TASKS_SOURCE_COMPARABLE`. При другом goal или одинаковом исполнителе: `NOT_COMPARABLE`. Отдельные original Task digest не переименовываются. После cold reopen сравнение не вызывает модель/ToolRuntime.

Найден и исправлен дефект original `OperationalSkillRuntime.route`: совпадение одного stopword с trigger example (например, `the` или `and`) случайно активировало Skill в обычной задаче. После source fix single stopword не выбирает Skill; явные trigger terms и значимые совпадения сохранены. Для задач с **настоящим** Skill activation создан owner-verified semantic admission digest: original activation receipt (ID, digest, query), descriptor и точный instruction body по-прежнему валидируются, но случайный receipt ID/время не объявляются изменением содержательной ревизии. При отсутствии исходного activation receipt: `HOLD`. Все 13/13 адресных интеграционных проверок PASS.

Уровни доказательства не повышены: в синтетических сравнениях `prompt_digest_equal=False`, что допускается лишь при owner-verified равенстве канонических условий Task и источников, но не означает идентичные provider prompts. Платёжная стоимость, human active time, real LLM quality и business effect остаются `UNKNOWN/NOT_MEASURABLE`. Нет установленного Tauri GUI и независимого реального A/B; `PRODUCT_ACCEPTED=false`. Код K05, T3, Activity и общая ветка Agent в этом этапе не менялись.
