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
