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

## Дополнение: подтверждена поставка K05 в продуктовый ZIP и холодный Python Core

Это новые данные после предыдущих 56/56, а не замена исходной матрицы.

- PRIVATE Agent exact code SHA `4317f19e5795ee9b4a78dbd12a7d3b6cbb5d0376`, TREE `162c07b281f8f294cf5ed6a4f3b1216daeb0db53`, изолированная ветка `work/2026-11-15-agent06-k05-installed-package`.
- PUBLIC K05 exact source pin `b2de1d6cd8dd1e660183c16febd18da9ac3b94a7` сохранён.
- PUBLIC Center runner `81b6e046c45564a1aab076bc385801b3f1b92c0e`, [Windows Actions #43742812935](https://github.com/Faust-S/Center/actions/runs/43742812935): **SUCCESS**, original owner Python 62/62, source UI Node tests 4 PASS, TypeScript/Vite PASS, ZIP/source receipt tests 7/7, **cold product Core test 1/1 PASS, 0 SKIP**.
- Последний test распаковал продуктовый ZIP, затем независимый Python процесс без внешнего `PYTHONPATH` создал/принял две синтетические Task, восстановил исходный Core и вызвал сравнение из **упакованного** K05. Подтверждён результат `TWO_ACCEPTED_TASKS_SOURCE_COMPARABLE` без нового inference.
- Найденный функциональный разрыв исправлен: прежний Setup builder не включал owner K05, хотя source tests проходили. Новый build-time source receipt и оригинальный package manifest связывают K05 с exact public source SHA; внутренний Python runtime остаётся исходным, K05 не становится обязательной фоновой службой.
- UI: выбранные человеком принятые Task, отдельные исходные ID при одинаковых названиях, корректный lifecycle React StrictMode, SOURCE_COMPARABLE только при исходной проверке.
- Приватность: публичный Center временно использовал разрешённый read-only доступ к точной приватной ревизии; public artifacts 0, private GitHub Actions 0; приватные логи, исходники, модельные ответы и пользовательские файлы не опубликованы.

**Границы приёмки:** `AGENT06_K05_PACKAGE_COLD_PYTHON=PASS`; `AGENT06_K05_INSTALLED_TAURI_GUI=NOT_TESTED`; `TWO_REAL_LLM_EXECUTORS=NOT_TESTED`; `ACTUAL_BUSINESS_ROI=NOT_MEASURABLE`; `PRODUCT_ACCEPTED=false`. Это источник и упаковка, а не установленный GUI и не доказанный экономический выигрыш. Следующий этап: установленный Setup Core/Windows GUI, две реальные модели, независимое качество и фактические invoices/domain receipts.

## Дополнение: Native UIA и Center Setup Core без вспомогательного установщика

- Private Agent исходный CODE SHA `5a9f264a91a30cdbf870acf5a139ebf94f0d9bc8`; отдельная ветка `work/2026-11-15-agent06-k05-installed-package`.
- [Public Center source Windows CI #43744525342](https://github.com/Faust-S/Center/actions/runs/43744525342) **SUCCESS**: 62/62 original-owner Python, UI Node-tests PASS, TypeScript/Vite PASS, K05 product ZIP tests 7/7 PASS, cold extracted-core 1/1 PASS, 0 SKIP. Windows PowerShell parser принял исходный native UIA сценарий и оба штатных сценария сборки.
- Исправлена граница Workspace в Interaction Surface: исходное сравнение двух принятых Task, если пользователь сменил Workspace, выдаёт `INVALID_QUERY` / 409, без оригинального Task ID в публичной ошибке.
- В исходный `tools/qualify_setup_core_native_gui.ps1` добавлен UIA-mode `k05-compare`. Он предусмотрен для явного выбора исходных двух Task и readback результата из Tauri; **сам режим ещё не исполнялся в установленном GUI**.
- Для конечного Center Setup Core добавлен режим `-ProductPackageOnly` в штатном нативном сборщике: не компилируется вспомогательный Setup stub, финальный Setup Core получает оригинальный ZIP с K05.
- Новый public Windows installed workflow [#43744525450](https://github.com/Faust-S/Center/actions/runs/43744525450) отправлен для настоящей компиляции Tauri, Setup Core и установленной квалификации, но **на момент записи результата ещё нет**. Этот прогон нельзя засчитывать как PASS.
- Public source CI artifacts = **0**; private Actions на кодовом SHA = **0**; прочие приватные файлы, полные логи и исполняемые артефакты в общедоступные материалы не публиковались.

**Статус:** `K05_SOURCE_WINDOWS=PASS`; `K05_PACKAGE_COLD_CORE=PASS`; `K05_NATIVE_SETUP_CORE=IN_PROGRESS_NOT_ACCEPTED`; `K05_INSTALLED_UI_PAIR=NOT_TESTED`; `REAL_MODEL_CAUSAL_EFFECT=NOT_MEASURABLE`; `PRODUCT_ACCEPTED=false`.

## Дополнение 15.11: реальная установленная Qwen Task и квалификация K05 UIA

Точный исходный код новой специализированной Agent-ветки:
`Faust-S/iwxa-personal-agent@8d902270b678eab5d6ec918165cec74ec2d22118`.
Общая Agent 0.6, T3 и нормативный K05-owner не изменены.

- [Center installed #43749502166](https://github.com/Faust-S/Center/actions/runs/43749502166): в установленном Setup Core прошли `IDENTITY`, `PREFLIGHT`, `INSTALL`, `VERIFY`, `LOCATIONS`. Реальная Qwen выполнила inference, Task, Human Review, экспорт и inspect `.iwxa`; последняя operation `EXCHANGE_INSPECT`, checkpoint `AGENT_REAL_QWEN_IWXA_EXPORT_INSPECT_PASS`. Итог всей установленной приёмки FAIL: witness проверял старый общий каталог реестра, а действующий Original Agent хранит полномочия в `IWXA/PersonalAgent/`.
- [Center installed #43750828997](https://github.com/Faust-S/Center/actions/runs/43750828997): после исправления всех пяти путей в `qualify_setup_core_runtime.ps1` установленная проверка продвинулась до `K03_TASK_EXECUTE`; статус FAIL. Это подтверждает устранение прежнего блокера Qwen witness, но не подтверждает приёмку K03, K05 GUI или всей установки.
- На точном исходном SHA выше [source Windows #43753287399](https://github.com/Faust-S/Center/actions/runs/43753287399) **SUCCESS**: original Agent Python 62 PASS, product/package tests 15/15 PASS, cold product Core 1/1 PASS без SKIP, TypeScript/Vite PASS, UI и Windows PowerShell parser PASS.
- В существующем установленном UIA `k05-compare` добавлен режим отрицательной сверки двух настоящих Human-accepted Task с разными условиями. Критерий PASS теперь включает не только видимую отметку NOT_COMPARABLE, но и независимую read-only сверку оригинального Core, неизменность обоих Task/Result и `provider_invocations_during_comparison=0`, `task_mutations=0`. Нативное исполнение этого нового критерия пока **NOT_RUN**.
- В установленном K03 owner witness сохранение конечного кодового семейства, последнего checkpoint и HTTP reason добавлено без выхода за допустимые публичные значения. [Center installed #43753145325](https://github.com/Faust-S/Center/actions/runs/43753145325) на момент фиксации продолжал исполнять Windows job; результат не объявлять PASS.

**Статусы:** `K05_SOURCE_WINDOWS=PASS`; `K05_PACKAGE_COLD_PYTHON=PASS`; `QWEN_REAL_INSTALLED_TASK_EXCHANGE=PARTIAL_PASS` (до export inspect, без полной приёмки); `K03_INSTALLED=FAIL` на предыдущем прогоне; `K05_NATIVE_UIA=NOT_ACCEPTED`; `TWO_REAL_EXECUTOR_QUALITY=NOT_MEASURABLE`; `PRODUCT_ACCEPTED=false`.

**Приватность:** единственный разрешённый исполнитель закрытого кода — временный public `Faust-S/Center` Windows runner с read-only secret. В source CI артефакты не выгружались; приватные Actions не запускались. Информация в публичном CI ограничена безопасными статусами SHA, receipt и конечными кодами, без публикуемых EXE, исходников, полных логов, ответов модели и пользовательских данных.

## Дополнение: диагностирована граница K05 GUI, 15.11.2026

- [Center installed #43753145325](https://github.com/Faust-S/Center/actions/runs/43753145325): **FAIL**, но `K05_NATIVE_ORIGINAL_SETUP_CORE_BUILT_PASS`, установленная проверка прошла реальный Qwen и K03, затем отказ `K05_GUI_NONCOMPARABLE`. Это первый подтверждённый нативный блокер именно K05; код модели и исходного K03 после предыдущих исправлений не менялся.
- Устранён диагностический пробел: штатный `tools/qualify_setup_core_native_gui.ps1` теперь записывает только allowlisted этапы `TASK_NAVIGATION` / `TASK_SELECTION` / `ACCEPTED_RESULT` / `ALTERNATIVE_SELECTION` / `COMPARE_BUTTON` / `COMPARISON_READBACK`, а также конечный вид отказа. `tools/qualify_setup_core_runtime.ps1` переносит эти значения в существующую закрытую квитанцию и не раскрывает тексты Task, model output или пользовательские данные в публичный Center.
- Private Agent source SHA `0964493558d82c84bd41e2ccb252f06643247d06` содержит защиту от `Set-StrictMode` при ранней ошибке и адресный тест этих диагностических полей; [Center source Windows #43755257445](https://github.com/Faust-S/Center/actions/runs/43755257445) **SUCCESS**. Публичных uploaded artifacts **0**, private Agent Actions **0**.
- [Center installed #43754962824](https://github.com/Faust-S/Center/actions/runs/43754962824) использует предшествующий кодовой SHA `ddd40e0e837aca73f234d388a22b257d591923a9` и соответствующий public Center workflow. На момент этой записи нативная сборка ещё выполнялась, поэтому `K05_INSTALLED_TAURI=NOT_ACCEPTED`.
- Отрицательная проверка не может объявлять PASS по одной надписи «Сопоставимость не подтверждена». Последующий вызов original Core обязан независимо подтвердить `TWO_ACCEPTED_TASKS_NOT_COMPARABLE`, неизменность двух принятых Task/Result, ноль новых model invocations и ноль mutations.

**Граница результата:** исходный K05 и пакет/cold Core PASS, но сам установленный Tauri/Task comparison пока не принят. Эффективность двух настоящих ИИ-исполнителей и бизнес-экономия не измерены. Следующее исправление — по фактическому безопасному UIA этапу, а не ослаблением проверок эквивалентности.

## Продолжение 15.11: устранена потеря кода K03 и принята исходная коррекция scheduler claim

- Предыдущий installed Windows прогон [#43754962824](https://github.com/Faust-S/Center/actions/runs/43754962824): **FAIL**, после настоящей установки на `K03_TASK_EXECUTE`, последний подтверждённый checkpoint `AGENT_K03_TASK_ACCEPTED`. Это ещё НЕ подтверждённая причина блокера, а точная граница наблюдения.
- В специализированную Agent 0.6 K05 ветку добавлен отдельный конечный status-sidecar `--failure-code-path` для установленного K03 witness. При переоформлении stderr Windows PowerShell не теряет идентификатор отказа; `HTTP_503`, `k03_task_model_execution_stopped` и прочие только заранее перечисленные коды не содержат исходных Task, prompts, модели или персональных данных.
- Из основной Agent 0.6 выборочно перенесён действующий фикс `retry_model(task_id, scheduler_claim_token=...)` из `0ac97d3fd48b0c21bf0db4378b39185448d81bc5`. Он относится к оригинальному `DurableAutomation`, а не к K05 как отдельному движку. Только владелец EXACT RUNNING claim может восстановить свою ожидающую Task; UI/manual или чужой/устаревший claim отклоняется.
- Код ветки K05: `Faust-S/iwxa-personal-agent@763583b306ca4a7896609a1c42e535e64b855c33`; общая Agent 0.6 **не изменялась**.
- [Public Center source Windows #43758490734](https://github.com/Faust-S/Center/actions/runs/43758490734): **SUCCESS**, 74/74 Python включая **12/12 INTERACTIVE_SCHEDULER**, 18/18 package/diagnostic tests, 1/1 cold packaged Core без SKIP, UI и TypeScript/Vite PASS, PowerShell parser PASS. Публичных uploaded artifacts = **0**; private Agent Actions на этом SHA = **0**.
- [Public Center installed Windows #43757865586](https://github.com/Faust-S/Center/actions/runs/43757865586) относится к предыдущему Agent SHA `12d8c5040e192fd21003d8152974ef3440cda406`, а не к перенесённому scheduler fix. На момент этой записи он ещё исполнял установленный сценарий, поэтому не является продуктовой приёмкой нового исправления.

**Итог:** `K05_SOURCE_WINDOWS=PASS`, `K05_PACKAGE_COLD_CORE=PASS`; `K03_INSTALLED_SCHEDULER_FIX=NOT_YET_QUALIFIED`; `K05_INSTALLED_GUI=NOT_ACCEPTED`; `REAL_EFFECTIVENESS=NOT_MEASURABLE`; `PRODUCT_ACCEPTED=false`. Нельзя делать вывод об экономической выгоде по source/CI-тестам и нельзя объявлять одинаковыми разные исходные Task без оригинальной owner-проверки.

## Дополнение: независимая installed-квалификация исправленного scheduler claim

- Public Center workflow HEAD: `545aa1fe3b52e66b3c29fe8ea13ecfdf8c85475e`.
- Новый установленный Windows-run [#43759235790](https://github.com/Faust-S/Center/actions/runs/43759235790) поставлен на выполнение c точным Agent SHA `763583b306ca4a7896609a1c42e535e64b855c33`. Его очередь не отменяет предыдущий [#43757865586](https://github.com/Faust-S/Center/actions/runs/43757865586), использующий старый Agent SHA; это сохраняет независимое сравнение и диагностику.
- `cancel-in-progress: false` установлен только в public Center installed-workflow. Запуск закрытых Actions, публикация EXE, приватных пакетов, полных логов или данных модели не выполнялись.
- По состоянию на момент фиксации `K03_INSTALLED_SCHEDULER_FIX=NOT_YET_ACCEPTED`, `K05_GUI_NEGATIVE=NOT_YET_ACCEPTED`, `PRODUCT_ACCEPTED=false`; исходные Windows 74/74, отдельный scheduler 12/12, пакет 18/18, cold Core 1/1 PASS. Эффективность двух разных реальных моделей и экономический результат не доказаны.


## Обновление 16.11: два установленных Windows FAIL и безопасная диагностика планировщика

Проверены завершившиеся оригинальные Windows CI:
- [Center #43757865586](https://github.com/Faust-S/Center/actions/runs/43757865586), private Agent SHA `12d8c504`: real Tauri/package/Setup Core and local installation PASS, K03 original Task accepted, execution FAIL (`k03_task_model_execution_stopped`).
- [Center #43759235790](https://github.com/Faust-S/Center/actions/runs/43759235790), private Agent SHA `763583b3` с scheduler claim fix: те же install/build PASS, тот же Task-after-acceptance FAIL. Следовательно фикс claim ещё не доказывает исправление installed K03.

Для следующей проверки изменён только одноразовый installed witness: private Agent [`0780a02d`](https://github.com/Faust-S/iwxa-personal-agent/commit/0780a02d147cdc21b4f94b49f34734b0af265159) берёт из исходного `interactive_submission_status` при STOP/TIMEOUT только заранее разрешённые `state`, `task_status`, `error_code` или `OTHER_REDACTED`, через приватный sidecar. Двойной PowerShell allowlist. Исходные Tasks, scheduler, модели и критерии K05 не изменялись. Добавлены регрессионные тесты. Публичный Center workflow [`aead2271`](https://github.com/Faust-S/Center/commit/aead2271b29e70ef2631127bc35fbe49cf54b571) закреплён на этом SHA. Два промежуточных CI запуска `240b6063`/`26652795` не создали jobs из-за ошибки YAML и не подтверждают отказ продукта; синтаксис в `aead2271` восстановлен. Новые прогоны: [installed #43772246827](https://github.com/Faust-S/Center/actions/runs/43772246827), [source #43772246817](https://github.com/Faust-S/Center/actions/runs/43772246817), на момент записи запущены, их PASS не утверждается.

Итог: `K03_INSTALLED=FAIL_AT_PREVIOUS_SHA`, `K03_SCHEDULER_ROOT_CAUSE=UNKNOWN`, `K05_INSTALLED_GUI=NOT_ACCEPTED`, `REAL_EFFECTIVENESS=NOT_MEASURABLE`, `PRODUCT_ACCEPTED=false`. Private Actions не использовались. В публичный Center не публиковались приватные исходники, пакеты, пользовательские данные или модельные ответы.


## 16.11: K03 прошёл установленный маршрут, K05 остановился на выборе Task в WebView2

Проверены оригинальные публичные Windows-квитанции [Center installed #43772246827](https://github.com/Faust-S/Center/actions/runs/43772246827) для private Agent `0780a02d147cdc21b4f94b49f34734b0af265159`:

- Собраны Tauri, product ZIP и оригинальный Center Setup Core. Локальные `IDENTITY/PREFLIGHT/INSTALL/VERIFY/LOCATIONS` PASS.
- Проверка впервые достигла `K05_GUI_NONCOMPARABLE`; это возможно только после исполнения K03 -> Human Review -> холодного Core readback по штатному `qualify_setup_core_runtime.ps1`.
- Конечный отказ `K05_NATIVE_UIA_STAGE=TASK_SELECTION`, `K05_NATIVE_UIA_REASON=UNKNOWN`. Нельзя объявлять `K05_NATIVE_UIA=PASS`.
- Независимый source Windows [#43772246817](https://github.com/Faust-S/Center/actions/runs/43772246817) завершился SUCCESS на ранее закреплённом Agent `763583b3`: 74/74 owner Python, 18/18 packaging, 1/1 cold Core, UI TypeScript/Vite PASS. Это не source evidence для следующего нового Agent SHA.

Анализ выявил конкретную хрупкость UIA: при поиске исходной K03 Task свидетель сравнивал SHA имени WebView2-кнопки с SHA оригинальной многострочной objective. Accessibility Name может нормализовать переносы строк и совпасть с названием другой Task. Обновлён private Agent [`6b9be470`](https://github.com/Faust-S/iwxa-personal-agent/commit/6b9be4704c5e3d7a79fc0561cb7df830ce71576e):
- Выбор первой Task через точный `AutomationId='saved-task-'+originalTaskId` (никакого выбора по одинаковым названиям для K05).
- После открытия UIA требует отдельный идентификатор `accepted-task-objective-` + exact TaskId, который React выводит только после оригинального принятого Core Task readback.
- В диагностике появились конечные коды отсутствия списка, целевой кнопки, отказа click или неподтверждённого принятого Task. Не выдаются модельные ответы, документы, UIA dump, токены или пути.
- Добавлен адресный регрессионный тест. Механика модели, Core, Task/Result, сравнительный K05 owner и защита источников не изменены.

Новая опубликованная ревизия разрешённого public Center Windows runner [`3d68932e`](https://github.com/Faust-S/Center/commit/3d68932e308bba2f940fcdfcc6f482ba477b9ddf) закрепляет этот SHA, в том числе в source workflow. Первоначальный Center `29ba4cf7` не создал installed job из-за ошибки генерации YAML; восстановлено из последнего валидного файла с проверкой ограниченного блока. Новые [installed #43779612658](https://github.com/Faust-S/Center/actions/runs/43779612658) и [source #43779612651](https://github.com/Faust-S/Center/actions/runs/43779612651) запущены; результат зафиксировать только по завершении.

**Статус:** `K03_INSTALLED_COLD_READBACK=PASS_ON_0780`; `K05_NATIVE_UIA=FAIL_TASK_SELECTION_ON_0780`, новый SHA `NOT_YET_ACCEPTED`; `TWO_REAL_EXECUTORS=NOT_MEASURED`; `PRODUCT_ACCEPTED=false`. Приватные GitHub Actions не запускались. Публичный Center содержит только статусы/allowlisted коды и exact SHA, не приватные архивы или содержимое Result.


### Source Windows acceptance for exact UIA-id correction

[Center source #43779612651](https://github.com/Faust-S/Center/actions/runs/43779612651) завершился `SUCCESS` на exact Agent `6b9be4704c5e3d7a79fc0561cb7df830ce71576e`. Публичный bounded job log: **74/74 original-owner Python**, **21/21 packaging + regression** (0 errors), **1/1 packaged cold Core** (0 errors, **0 SKIP**), `NATIVE_UIA_SYNTAX_PASS`, `DESKTOP_TYPESCRIPT_BUILD_PASS`, UI source tests PASS. Этот PASS относится к source/package и не подменяет installed K05.

[Center installed #43779612658](https://github.com/Faust-S/Center/actions/runs/43779612658) на этом exact SHA уже прошёл checkout и исходную проверку владельцев; установленное исполнение и K05 GUI на момент данной записи `IN_PROGRESS`. Артефакты публичного source CI, нового installed CI и предыдущего #43772246827 проверены через Actions API: **0 uploaded artifacts** в каждом. Приватные workflows не запускались.

`K05_SOURCE_WINDOWS=PASS`, `K05_PACKAGE_COLD_CORE=PASS`, `K05_INSTALLED_EXACT_TASK_UIA=IN_PROGRESS`, `REAL_EFFICIENCY=NOT_MEASURABLE`, `PRODUCT_ACCEPTED=false`.

## 17.11: installed K03 flake подтверждён, уточнение ModelProviderPort и интеграционный барьер

Последний установленный прогон до текущих исправлений, [Center #43779612658](https://github.com/Faust-S/Center/actions/runs/43779612658), private Agent `6b9be470`: Tauri, ZIP, original Setup Core и локальная установка PASS, но K03 после исходного `TASK_ACCEPTED` дал `K03_TASK_EXECUTE=FAIL`; первоначально сохранённый original scheduler state=`PAUSED`, Task=`awaiting_result`, `error_code=OTHER_REDACTED`. Это не K05 GUI ошибка и не разрешение безусловно повторять Task.

Сверка исходных ModelProviderPort и existing `BasicGGUF` показала, что многие их штатные, не содержащие данных коды отсутствовали в K03 allowlist (`PORT_UNAVAILABLE`, `PORT_PROTOCOL_ERROR`, `basic_runtime_timeout`, `basic_runtime_generation_failed`, `warm_engine_generation_failed` и т.д.). Без сырого stderr и содержимого модели опубликован диагностический Agent [`22d36bb`](https://github.com/Faust-S/iwxa-personal-agent/commit/22d36bb2060d05afe9653f4703fe0af723f9da7d): расширены только source-reviewed имена отказов и перечисление `error_family`. Никаких повторных model invocations, изменений Task/Review/Result, прав или K05 comparator. Public Center native + source закреплены на exact SHA в [`b66dacff`](https://github.com/Faust-S/Center/commit/b66dacff7ae3d8f4e633ab6907a09364a275a1a6).

Новый исходный Windows [#44105022007](https://github.com/Faust-S/Center/actions/runs/44105022007): SUCCESS, Python Agent/K05 74/74, packaging 21/21, packaged cold Core 1/1 (0 SKIP), UI/TypeScript/Vite и Windows native UIA syntax PASS. Exact installed [#44105022163](https://github.com/Faust-S/Center/actions/runs/44105022163) запущен; финальный native K03/K05 статус не заявлен.

Дополнительная проверка `Faust-S/iwxa-personal-agent@work/2026-11-16-agent06-original-t3-result-owner-d6`: эта центральная ветка и K05 diverged (в K05 ahead 69 / behind 109 на момент проверки), source bridge `runtime/public_k05/agent06_effectiveness_bridge.py` и K05 экран в центральном D6 отсутствуют. Запрещено merge всей K05 ветки, только адресная портировка изменений без регресса D3/D6/T3.

Для точной передачи опубликован публичный [K05_AGENT06_INTEGRATION_GATE_2026_11_17_RU.md](https://github.com/Faust-S/knowledge/blob/work/2026-11-15-agent06-effectiveness-evaluation/research/cross-lab/K05_AGENT06_INTEGRATION_GATE_2026_11_17_RU.md) с порогами source/installed, no-wholesale-merge и настоящей оценкой двух разных исполнителей.

Статус: `K05_SOURCE_INTEGRATION_CANDIDATE=true`, `K05_INSTALLED_STABLE=false`, `REAL_EFFECTIVENESS=NOT_MEASURABLE`, `PRODUCT_ACCEPTED=false`.

## 18.11: воспроизводимая конечная ошибка локального модельного вывода и отдельная протокольная диагностика

Завершившийся original installed Windows [Center №44105022163](https://github.com/Faust-S/Center/actions/runs/44105022163) на private Agent `22d36bb2060d05afe9653f4703fe0af723f9da7d`: `Build ZIP/Tauri/Setup Core=PASS`, `INSTALL/VERIFY/LOCATIONS=PASS`, `K03_TASK_ACCEPTED=PASS`, `K03_TASK_EXECUTE=FAIL`; exact owner scheduler: `PAUSED`, `awaiting_result`, `basic_runtime_output_invalid`, family `BASIC_RUNTIME`. Следовательно предыдущая гипотеза об ошибке scheduler claim недостаточна. Модельный путь не представил принятый Result. Не следует называть FAIL «временной проблемой UIA».

Разбор оригинального `adapters/iwxa_basic_model_provider.py` выявил диагностическое смешение разных случаев: некорректный/изменённый префикс `User→Assistant`, отсутствие или недоступность временного `-o` файла, незакрытый `<think>`, ошибочный формат reasoning и фактическое отсутствие финального ответа. Все они ранее выдавали общий `basic_runtime_output_invalid`; предположение о том, какой из случаев произошёл в установленном прогоне, **НЕ ДОКАЗАНО**.

В изолированной ветке K05 опубликован private Agent [`cbeb33d3`](https://github.com/Faust-S/iwxa-personal-agent/commit/cbeb33d344f1fc6f1f52b9e0fbe35dab2ea1eff0): настоящий llama-cli output admission сохраняет точную проверку начала `User: + actual prompt + Assistant:`, нормализуя только UTF-8 BOM и транспортные CRLF, и выдаёт отдельные заранее известные коды отказа. Незакрытые рассуждения, reasoning-only, неверный префикс и пустой результат **НЕ превращаются** в Result. Коды пропускаются через три одноразовых allowlist, но не передаются raw output, source bytes или пользовательские пути. Добавлены параметризованные тесты CRLF/BOM, полного исходного многострочного prompt, разных недопустимых reasoning-маркеров и двойной проверки безопасности публичной квитанции.

Изменение внесено строго в K05 isolated branch, не в центральную Agent 0.6. Public Center [`b6559ce6`](https://github.com/Faust-S/Center/commit/b6559ce6ebd685b16468da2a9da9fb81d172ddf9) закреплён на exact SHA, Windows [source №44348329999](https://github.com/Faust-S/Center/actions/runs/44348329999) и [installed №44348330057](https://github.com/Faust-S/Center/actions/runs/44348330057) запущены. Их результаты можно присвоить только после проверки final job conclusion. Ни T3/D3/D6, ни модельная маршрутизация/Task/Review/Result, ни критерии K05 здесь не изменены.

`PRODUCT_ACCEPTED=false`, `INSTALLED_K03_RELIABLE=false`, `K05_NATIVE=NOT_ACCEPTED`, `REAL_TWO_EXECUTOR_EFFECTIVENESS=NOT_MEASURABLE`.

### 18.11: проверен исходный формат настоящего llama.cpp b11827

В `ggml-org/llama.cpp@b11827`, `tools/cli/cli-context.cpp`, оригинальный `-o` записывает `User:\\n<exact input>\\n\\nAssistant:\\n`; при отдельном reasoning печатает `[Start thinking]` и `[End thinking]`, затем `content.content`. Перед этим `cli-context` убирает один конечный LF из переданного `-f` prompt. Следовательно строгая идентификация вывода `User→Assistant` в нашем CLI-adapter соответствует закреплённой версии. Если `content.reasoning` существует, а `content.content` пуст, формально успешный запуск процесса всё равно НЕ доказывает окончательный ответ модели. K05 должен фиксировать `basic_runtime_visible_answer_missing`, а не считать reasoning или echo ответом.

Новая source-qualifying Windows [Center №44348329999](https://github.com/Faust-S/Center/actions/runs/44348329999) для private Agent `cbeb33d344f1fc6f1f52b9e0fbe35dab2ea1eff0`: `SUCCESS`, original Agent/K05 `89/89 PASS` (15 протокольных тестов), packaging `22/22 PASS`, packaged cold Core `1/1 PASS`, 0 SKIP, TypeScript/Vite и native UIA parser PASS. Исходный PASS **не закрывает** installed native [№44348330057](https://github.com/Faust-S/Center/actions/runs/44348330057), который на момент записи выполняется на том же закреплённом SHA.

Отдельная готовящаяся к новой source-квалификации измерительная доработка private K05 [`7f65cf03`](https://github.com/Faust-S/iwxa-personal-agent/commit/7f65cf038307d96e8b8e4c5fe31491be09f9c34e) сохраняет реальные `prompt_tokens` и `completion_tokens` из существующего завершённого llama-server ответа, если они являются валидными неперепутанными целыми; иначе `UNKNOWN`. Результаты K05 UI показывает строго как подписанную арифметическую разницу `second - first`, а не оценку общей стоимости. В Node-тестах выполняется реальная скомпилированная TSX-проекция, сравнение запрещено для `NOT_COMPARABLE`. Публичный source runner [Center №44350970764](https://github.com/Faust-S/Center/actions/runs/44350970764) запущен с точным `7f65cf03`; его результат ещё не заявлен. Последний установленный candidate остаётся `cbeb33d3`, потому что обязательный native CI нельзя подменять source-only PASS.

Решение владельца от 18.11: `READY_FOR_AGENT_INTEGRATION=false`. Запрет на перенос K05 в центральную ветку записан также в `K05_AGENT06_INTEGRATION_GATE_2026_11_17_RU.md` (коммит `12cb7623`).

### Итог текущей исходной квалификации измерения, 18.11

Public Center [#44350970764](https://github.com/Faust-S/Center/actions/runs/44350970764) завершился `SUCCESS` на EXACT private Agent `7f65cf038307d96e8b8e4c5fe31491be09f9c34e`:
- original Agent/K05 Python `104/104 PASS`; K05 CLI protocol `15/15`, observed real server token count validation `15/15`, executor-comparison `19/19`;
- original package / static contracts `23/23 PASS`, cold packaged Core `1/1 PASS`, `0 SKIP`;
- desktop UI/TypeScript/Vite, native PowerShell/UIA parser `PASS`;
- Windows source CI and previous source [#44348329999](https://github.com/Faust-S/Center/actions/runs/44348329999) each have `0` published artifacts.

Измерение токенов в `adapters/iwxa_llm_warm_session.py` принимает **только реальные** `prompt_tokens` и `completion_tokens` из provider `usage`, отклоняет булевы, строки, отрицательные, нецелые, слишком большие и несовместимые `total_tokens`; никакого восстановления по `requested_output_tokens`. K05 UI показывает `second − first` по времени, токенам и доступной стоимости только для `SOURCE_BOUND_EQUIVALENT_DISTINCT_TASKS`; отдельный Node-тест исполняет скомпилированную TSX projection. На этом этапе это измерительный **путь**, но не доказательство real effectiveness между двумя настоящими исполнителями.

Нативный installed [#44348330057](https://github.com/Faust-S/Center/actions/runs/44348330057) использует прежний exact Agent `cbeb33d344f1fc6f1f52b9e0fbe35dab2ea1eff0` и ещё выполняется, не отменён source-only изменениями. На него не распространяется новый source PASS. `READY_FOR_AGENT_INTEGRATION=false`, `PRODUCT_ACCEPTED=false`, `REAL_TWO_EXECUTOR_EFFECTIVENESS=NOT_MEASURABLE`.

## 18.11: installed K03 прошёл, обнаружен точный блокер WebView2 accepted Result

Завершился original installed [Center #44348330057](https://github.com/Faust-S/Center/actions/runs/44348330057) на private Agent `cbeb33d344f1fc6f1f52b9e0fbe35dab2ea1eff0`, `FAIL`. Подтверждены original Tauri/product ZIP/Setup Core и локальное `IDENTITY/PREFLIGHT/INSTALL/VERIFY/LOCATIONS=PASS`. K03 перестал быть текущей точкой остановки: native дошёл до `K05_GUI_NONCOMPARABLE`. Первое `TaskId` выбрано (этап `TASK_SELECTION` пройден), конечная стадия `K05_NATIVE_UIA_STAGE=ACCEPTED_RESULT`, `K05_NATIVE_UIA_REASON=UNKNOWN`. Не утверждаем, какая конкретная подоперация внутри `ACCEPTED_RESULT` выбросила исключение, пока нет bounded owner reason.

Исходный K05 native UIA после правильного ID-based выбора выполнял дополнительный `Assert-ResultAccepted`, который требовал `SHA256(WebView2 accessible Name)==SHA256(original K03 objective)`. WebView2 может нормализовать переносы многострочного текста, поэтому этот критерий не является корректным доказательством совпадения исходного Task. Адресный код [Agent `3a8b579f`](https://github.com/Faust-S/iwxa-personal-agent/commit/3a8b579f575130e3b9fb0edb6dc4a5407c073459) только в `k05-compare`:
- Сначала по-прежнему проверяется точный `saved-task-<TaskId>`.
- Отдельно проверяется id `accepted-task-objective-<TaskId>`, появляющийся в React только после `accepted && detailFresh && detail.task_id===selected`.
- Одновременно подтверждается настоящий видимый UIA статус `Result accepted` / `Результат принят`; без двух совпадающих сигналов выдаётся FAIL.
- Для остальных `result`, `review`, `graph-k02` оставлен прежний строгий SHA UIA названия.
- Добавлены bounded причины `ACCEPTED_BADGE_NOT_VISIBLE` и `ACCEPTED_READBACK_NOT_COINCIDENT`. Private Task/objective, prompt, model output и UIA dump не сериализуются.
- Исходный Core readback до и после K05, включая полный Task/Result/source-digest и запрет повторного model call, остаётся обязательным.

Public Center закреплён на exact Agent SHA в [`8e3353f6`](https://github.com/Faust-S/Center/commit/8e3353f616c75e1f5d37c84c322a13df402f2156). Source Windows [#44359264302](https://github.com/Faust-S/Center/actions/runs/44359264302) завершился `SUCCESS`: original Python/K05 `104/104 PASS`, packaging `24/24 PASS`, packaged cold Core `1/1 PASS` (0 SKIP), TS/Vite/UI и Windows UIA PowerShell parser PASS. Installed [#44359264074](https://github.com/Faust-S/Center/actions/runs/44359264074) запущен, его final K05 native status на момент записи ещё не получен.

По требованию учитывать основной Agent 0.6: сверены main `1bf0847e`, D6 `34d8f1a1`, D3 `16a5062e`, Office `0f577736`. K05 base diverged на 75 ahead / 232 behind центрального Agent; его `approval.py` содержит дополнительные read-only historical owner методы, отсутствующие в центральном. Полный анализ и запрет механического переноса: `K05_AGENT06_MAIN_COMPATIBILITY_2026_11_18_RU.md` в этой же публичной ветке.

Итог: `K05_SOURCE_WINDOWS=PASS`, `K05_INSTALLED=NOT_ACCEPTED`, `AGENT_INTEGRATION=FORBIDDEN_UNTIL_PRODUCT_ACCEPTANCE`, `REAL_EFFECTIVENESS=NOT_MEASURABLE`, `PRODUCT_ACCEPTED=false`. Приватные Actions не запускались; публичные workflow не публиковали private исходники, EXE или QA-артефакты.

## 18.11: зафиксирован установленный отказ User/Assistant-протокола llama.cpp

[Center installed #44359264074](https://github.com/Faust-S/Center/actions/runs/44359264074), exact Agent `3a8b579f575130e3b9fb0edb6dc4a5407c073459`, завершился `FAIL`: реальный Tauri/ZIP, Setup Core, installation/ownership/locations `PASS`, original K03 Task принят, но `K03_TASK_EXECUTE=FAIL`; owner scheduler `PAUSED`, `awaiting_result`, exact `basic_runtime_turn_prefix_unverified`, family `BASIC_RUNTIME`. K05 GUI до сравнения в этом запуске не дошёл. Не путать этот отказ с ранее наблюдавшимся UIA `ACCEPTED_RESULT`.

Проверены **исходники закреплённого `ggml-org/llama.cpp@b11827`**: `common/arg.cpp` на `-f` удаляет **один завершающий LF, если он есть**; `tools/cli/cli-context.cpp` перед передачей `cur_msg` удаляет **ещё один LF, только если он остался**. Таким образом прежняя гипотеза «одного LF недостаточно» **опровергнута самим исходным кодом**: для неоканчивающегося LF запроса один или два завершающих LF дают одинаковую строку. Ошибочно моделировавший безусловное удаление символа тест исправлен. Нельзя считать double-LF причинным исправлением до аппаратного результата.

Первый ограниченный эксперимент Agent [`3e252fe7`](https://github.com/Faust-S/iwxa-personal-agent/commit/3e252fe7366d97a5607ca6ba62f4e0b5dcb631c8) заменил платформозависимую запись временного текста на строго бинарный UTF-8 и проверил оба допустимых варианта завершающего LF. Source Windows [#44365638568](https://github.com/Faust-S/Center/actions/runs/44365638568) `SUCCESS`: `110/110 Python`, `25/25 package`, `1/1 cold Core` (0 SKIP), TypeScript/Vite/UIA `PASS`. Native [#44365638561](https://github.com/Faust-S/Center/actions/runs/44365638561) запущен на exact `3e252fe7`; результат до завершения не утверждается.

Второй адресный эксперимент Agent [`a40d188a`](https://github.com/Faust-S/iwxa-personal-agent/commit/a40d188ab4b9d96352b44320c866e9371757d386) оставляет исходную admission проверку `record.startswith("User:\\n"+exact_prompt+"\\n\\nAssistant:\\n")` неизменной по строгости, но различает **шесть конечных видов** отказа: пустой transcript, отсутствующий заголовок User, отсутствующий заголовок Assistant, недостающий один символ echo, лишний LF echo и иной изменённый echo. Классы передаются через оригинальный scheduler/error и три ограниченных allowlist. Ни реальные исходные данные, ни текст модели, ни пути, ни хеши пользовательского промпта в public CI не попадают. Pinned Center [`1ce66573`](https://github.com/Faust-S/Center/commit/1ce665734b93e8dda7d0699604637afbb1560004), source Windows [#44366859567](https://github.com/Faust-S/Center/actions/runs/44366859567), installed [#44366859590](https://github.com/Faust-S/Center/actions/runs/44366859590). Пока не завершены.

С актуальным главным Agent 0.6 `1bf0847e` никаких merge/изменений не выполнялось. Его `iwxa_basic_model_provider.py` по-прежнему использует прежний путь, а две ветки расходятся на сотни коммитов; перенос `daily_driver_engine.py`/`workbench.tsx` не разрешён. `READY_FOR_AGENT_INTEGRATION=false`, `PRODUCT_ACCEPTED=false`, `REAL_EFFECTIVENESS=NOT_MEASURABLE`. Использован только разрешённый public Windows Center с временным private read-only checkout; private Actions запрещены, public artifacts с private кодом не загружались.

## 18.11: 117/117 PASS для изолированной диагностики K05, без повышения installed gate

Первый source Windows [#44366859567](https://github.com/Faust-S/Center/actions/runs/44366859567) на `a40d188a` честно завершился `FAIL`: `K05_CLI_OUTPUT_PROTOCOL=28`, `ERRORS=2`. Падения обусловлены старыми тестами, которые после введения конечной структурной классификации всё ещё ожидали общий код `basic_runtime_turn_prefix_unverified`. Остальные private owner тесты (historical Approval/ToolRuntime, source comparison, scheduler) прошли. Ожидаемые enum-коды приведены к реальному классификатору без изменения требования дословной привязки ответа к отправленному prompt.

Private Agent [`bafeb833`](https://github.com/Faust-S/iwxa-personal-agent/commit/bafeb8330f5d1649ad482bad7508137e77d616b6), public source pin Center [`069881b8`](https://github.com/Faust-S/Center/commit/069881b88f9cf0ee7fd5ad38d8276285444c198a). Независимый [source Windows #44367410691](https://github.com/Faust-S/Center/actions/runs/44367410691) **SUCCESS** на точном `bafeb833`: `117/117` original-owner Python (0 ошибок); `K05_CLI_OUTPUT_PROTOCOL=28/28`, `K05_EXECUTOR_COMPARISON=19/19`, `K05_OBSERVED_USAGE=15/15`, `PACKAGE=26/26`, `PACKAGED_COLD_CORE=1/1` (0 SKIP), TypeScript/Vite/UI source и Windows UIA parser PASS.

Оригинальный K05 установленный Windows `#44365638561` выполняется на коде `3e252fe7` с бинарной записью prompt; отдельная `#44366859590` на коде `a40d188a` с уточнением причин запущена, но её результат ещё нельзя объявлять PASS. Исполняемая модель/Task/Result на этих запусках одинаковы за исключением изолированной диагностики. Следующая диагностика позволит различить `User header missing`, `Assistant header missing`, `echo changed`, `echo one char missing`, `echo extra LF` без публикации исходных байтов.

Главный Agent `work/2026-11-15-agent-0-6-development` не изменён. K05 остаётся отдельным необязательным Kit: `SOURCE_PASS=true`, `INSTALLED_ACCEPTED=false`, `READY_FOR_AGENT_INTEGRATION=false`, `PRODUCT_ACCEPTED=false`, `REAL_EFFECTIVENESS=NOT_MEASURABLE`. У проверенных public Center source/native workflow `0` опубликованных артефактов private кода; private Actions не запускались.

## 18.11: завершились оба нативных прогона на binary-prompt и bounded-diagnostics

**Два независимых installed FAIL, не скрывать за source PASS:**

1. [Center #44365638561](https://github.com/Faust-S/Center/actions/runs/44365638561), exact private Agent `3e252fe7366d97a5607ca6ba62f4e0b5dcb631c8`: `K05_NATIVE_INSTALLED_FAILURE_STAGE=K03_TASK_EXECUTE`; owner scheduler `PAUSED / awaiting_result`, error `basic_runtime_turn_prefix_unverified`. Даже бинарный UTF-8 с двумя LF не гарантировал устойчивый настоящий `llama-cli -o`. Запрещено объявлять двойной LF причинным решением.
2. [Center #44366859590](https://github.com/Faust-S/Center/actions/runs/44366859590), exact private Agent `a40d188ab4b9d96352b44320c866e9371757d386`: K03 и модельная генерация прошли, затем `K05_NATIVE_INSTALLED_FAILURE_STAGE=K05_GUI_NONCOMPARABLE`, `K05_NATIVE_UIA_STAGE=ACCEPTED_RESULT`, `K05_NATIVE_UIA_REASON=ACCEPTED_BADGE_NOT_VISIBLE`. Идентификатор принятой Task проверен, но UIA не обнаружил отдельный статус. Это не свидетельство ошибочной Task или неподтверждённого исходного Result.

**Адресная доработка только K05:** [Agent `9c8a0eee`](https://github.com/Faust-S/iwxa-personal-agent/commit/9c8a0eee06f9fc9bda326c37f577e5cead923ec3) теперь присваивает `accepted-task-status-<TaskId>` и явное доступное имя `Результат принят / Result accepted` только когда `accepted && detailFresh && detail.task_id===selected`. Native UIA требует одновременно same-Task `accepted-task-objective-<TaskId>` и `accepted-task-status-<TaskId>` с тем же корректным именем. Старые штатные UIA-режимы `review/result/graph` не изменены. Пред- и постсверка оригинального Task/Result, source SHA и отсутствие дополнительного вызова модели сохраняются.

Центр [`1bc45dca`](https://github.com/Faust-S/Center/commit/1bc45dca90bad31c69e150c01cb90663ee8b97ef) закрепляет оба Windows workflow на exact private `9c8a0eee`. [Source #44372957951](https://github.com/Faust-S/Center/actions/runs/44372957951) **SUCCESS**: 117/117 Python, 28/28 CLI output, 19/19 comparison, 15/15 observed token usage, 26/26 packaging, 1/1 cold Core, 0 SKIP, TS/Vite/UIA PASS. [Native #44372957899](https://github.com/Faust-S/Center/actions/runs/44372957899) в процессе на момент записи; source-only PASS не переносить на установленный кандидат.

**Основной Agent не модифицирован.** K05 source всё ещё изолирован и отстаёт от центрального Agent/T3, поэтому любые изменения K05 должны переноситься после реальной продуктовой приёмки и новой сверки owner-контрактов. `SOURCE_PASS=true`, `NATIVE_ACCEPTED=false`, `REAL_EFFECTIVENESS=NOT_MEASURABLE`, `READY_FOR_AGENT_INTEGRATION=false`.

## 18.11: baseline Qwen GUI_RESULT также потребовал точной диагностики

Installed [Center #44372957899](https://github.com/Faust-S/Center/actions/runs/44372957899) на private Agent `9c8a0eee06f9fc9bda326c37f577e5cead923ec3` завершился **FAIL**. `TAURI/ZIP/SETUP_CORE=PASS`, `INSTALL/VERIFY/LOCATIONS=PASS`, но `K05_NATIVE_INSTALLED_FAILURE_STAGE=GUI_RESULT`. Это **базовый GUI-readback ранее принятой реальной Qwen Task**, а не K05 GUI comparison и не утверждение об ошибке модели. Непривязанный к источнику вывод «новый экран K05 сломан» запрещён: до его открытия прогон не дошёл. Старый installed script гасил точную UIA-ошибку под `AGENT_NATIVE_INSTALLED_GUI_RESULT_NOT_ACCEPTED`, поэтому причина пока не установлена.

Дополнительно доработан реальный необязательный интерфейс [Agent `59ea5616`](https://github.com/Faust-S/iwxa-personal-agent/commit/59ea5616c21965ceae65c485f4f2c95c109696f5): выбор второй Task и панель результата сравнения имеют явный `AutomationId`/доступный статус, привязанный к `TaskId`, вместо глобального поиска одинаковых labels во всём WebView2. Контракты K05 исходного Core и no-extra-inference не менялись. Source Windows [#44374733155](https://github.com/Faust-S/Center/actions/runs/44374733155) **SUCCESS**: Python 117/117, package 27/27, cold Core 1/1 (0 SKIP), TS/Vite/UIA PASS. Installed [#44374732818](https://github.com/Faust-S/Center/actions/runs/44374732818) выполняется на точном `59ea5616`, не засчитан.

Для неразличимого старого `GUI_RESULT` этапа в изолированной ветке K05 создана **только конечная диагностическая квитанция**, без изменения нормального Task/Result, модели и Human Review: private Agent [`54050a08`](https://github.com/Faust-S/iwxa-personal-agent/commit/54050a0821f340f2efd83ac17b2ebb934ccd5797) пишет в disposable local Windows profile безопасные `GUI_RESULT_STAGE` (навигация, выбор Task, принятый readback, receipt) и `GUI_RESULT_REASON` (не найден Work, Task ID, несовпадение заголовка, отсутствие accepted status, конфликт UIA). Исходные GUIA Name, текст модели/Task и пути не выгружаются. Public Center [`9a8675a8`](https://github.com/Faust-S/Center/commit/9a8675a8437c8e33abefdb400b52f06e77a06aee) с точным SHA запускает source [#44375606983](https://github.com/Faust-S/Center/actions/runs/44375606983) и native [#44375606995](https://github.com/Faust-S/Center/actions/runs/44375606995); их финалы на момент документа **НЕ ДОКАЗАНЫ**. Никаких частных Actions, публичных EXE/полных логов и кода.

Сохраняются `K05_NATIVE_ACCEPTED=false`, `PRODUCT_ACCEPTED=false`, `READY_FOR_AGENT_INTEGRATION=false`, `REAL_EFFECTIVENESS=NOT_MEASURABLE`. После GUI_RESULT требуется доказать K03→Review→две настоящие Task→K05 NOT_COMPARABLE, затем настоящую эквивалентную пару двух разных моделей с наблюдаемыми метриками.

### Исходная проверка bounded GUI_RESULT диагностики завершена

[Center source #44375606983](https://github.com/Faust-S/Center/actions/runs/44375606983) **SUCCESS** на exact private Agent `54050a0821f340f2efd83ac17b2ebb934ccd5797`: `117/117` Python, `28/28` CLI output, `19/19` compare, `15/15` observed tokens; package `28/28`, cold Core `1/1` при `0 SKIP`, TypeScript/Vite/UIA parser `PASS`. Публичных private artifact uploads по плану нет; не путать этот source PASS с Windows installed acceptance. Older native [#44374732818](https://github.com/Faust-S/Center/actions/runs/44374732818) остаётся на точном `59ea5616`, newer [#44375606995](https://github.com/Faust-S/Center/actions/runs/44375606995) закреплён на `54050a08` и ожидает/выполняет native qualification. `K05_NATIVE_ACCEPTED=false`.
