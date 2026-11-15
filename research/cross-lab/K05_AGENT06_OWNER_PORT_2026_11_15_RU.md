# K05 / Agent 0.6: исходный TaskCell и ToolRuntime без второго ядра

Дата 15.11.2026. Public development branch: \`work/2026-11-15-agent06-effectiveness-evaluation\`. Следующая интеграция в Agent 0.6 **ещё НЕ выполнена**; этот модуль является необязательным read-only adapter, который загружается только внутри доверенного установленного владельца Agent. Общая ветка Agent 0.6 не затронута.

## Почему потребовался отдельный owner readback

Существующий \`k05_agent05_final_result_binding.py\` проверяет точное соответствие **текста** Graph stop artifact и переданного финального текста. Однако у Agent TaskCell \`task_digest\` и \`result_ref.digest_sha256\` являются digest **канонического JSON**, поэтому текстовый SHA нельзя использовать как \`result_ref.digest_sha256\`. Нельзя также считать \`ExecutionInstance.COMPLETED\` равным Human Review \`approve_draft\`. Ложный статус \`ACCEPTED\` по host-reported usage или receipt запрещён.

Проверенные исходные владельцы 15.11:
- \`Faust-S/iwxa-personal-agent@work/2026-11-15-agent-0-6-development\`, HEAD \`6d6bbef57e33d5768bd9b4f4821af84d760ace8b\`, private read-only.
- \`Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection\`, HEAD \`43e9448621f11ac5ee35d9da53eaf5576a8ce5a8b\`, read-only.
- \`Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer\`, HEAD \`2383c58f88901f16aa2a5fa780de447dba3d4750\`, read-only.

## Готовые функции (не новый Agent runtime)

\`research/cross-lab/k05_agent06_owner_port.py\`:

1. \`read_agent_accepted_task(task_cell, task_id)\` вызывает существующие owner read-only methods \`TaskCell.read_task\`, \`TaskCell.task_digest\`, \`TaskCell.accepted_artifact\`. Именно оригинальный \`accepted_artifact\` вызывает \`core._verify_state_artifacts\` и проверяет связку closed Task, Review, Result, AcceptedArtifact и исходную цепочку. K05 дополнительно проверяет digest, ID и typed refs; возвращает только digest, без текста, ID, reviewer и notes. \`HUMAN_ACCEPTED_DRAFT\` не доказанный эффект внешнего инструмента.

2. \`observe_accepted_agent_run(run, task_cell=..., task_id=..., source_bytes=..., owner_verify=...)\` выполняет original readback, затем вызывает **существующий** K05 \`observe_run\` для строгих источников. Установленный Agent обязан передать \`run.task_sha256 = TaskCell.task_digest\` и \`run.result_sha256 = state.result_ref.digest_sha256\`, а не \`sha256(final_text)\`. Если K05 metric verifier и TaskCell расходятся, HOLD.

3. \`read_agent_execution_receipts(task_cell=..., task_id=..., tool_runtime=..., receipt_ids=[...])\` каждый раз заново проверяет исходную закрытую Task и вызывает **исходный** \`ToolRuntime.read_execution_receipt\` / \`read_execution_plan\`. Связывает план с тем же task digest, Task ID, принятой записью, accepted artifact ID/digest, provider binding, tool descriptor и idempotency key. Считает SUCCEEDED/FAILED/INPUT_REQUIRED, ACKNOWLEDGED/NONE/UNKNOWN, число повторных receipt по idempotency key, сумму длительностей в микросекундах без округления. Не делает ToolRuntime.execute, не читает внешние сервисы.

Записи \`TRR-\` не имеют самостоятельной привязки к Task, поэтому в этом адаптере НЕ принимаются как подтверждённая стоимость/эффект конкретной Task. Для их использования требуется source-bound Graph/Result reference, verified owner K05 readback и отдельное квалифицированное сопоставление. Квитанция \`TXR-...status=SUCCEEDED\` тоже не является подтверждением business Result: returned \`accepted_business_result=NOT_VERIFIED\`.

## Граница фактов и Telemetry

\`k05_agent06_otlp.py\` 0.2: отключён по умолчанию; даёт совместимый OTLP/JSON resourceMetrics только при \`enabled=True\` **и** исходном измеренном окне \`start_time_unix_nano / time_unix_nano\`. Если UTC-времени у владельца нет, экспорт \`MEASUREMENT_WINDOW_REQUIRED\`. Длительность передаётся gauge, счётчики как DELTA Sum с \`isMonotonic=true\`. Нет HTTP, OpenLIT SaaS, установки SDK, фонового процесса или передачи source refs. Отправка, collector destination и проверка доступности внешних сервисов решаются в интерфейсе Agent после разрешения пользователя.

**Внимание:** public mock owner port подтверждает только алгоритм потребителя. Он не доказывает настоящее состояние приватного Agent, не формирует фактический ROI и не даёт право опубликовать пользовательские сведения. Привязку конкретной стоимости должен проверять original COST_INVOICE reader с правильной валютой; человеческое время должно поступать из подтверждённого owner TIME_TRACKING, а не из elapsed_ms модели.

## Как подключить внутри Agent 0.6

Пример **псевдокода для штатного владельца**, не отдельный entrypoint и не задание на публикацию приватных данных:

\`\`\`python
# Agent host already instantiated its original TaskCell and ToolRuntime.
witness = k05_agent06_owner_port.read_agent_accepted_task(task_cell, task_id)
receipt_evidence = k05_agent06_owner_port.read_agent_execution_receipts(
    task_cell=task_cell,
    task_id=task_id,
    tool_runtime=tool_runtime,
    receipt_ids=owner_confirmed_txr_ids,
)
# For actual K05 result, supply canonical result JSON digest (not text hash),
# strictly verified measurement source bytes and the real owner_verify port.
accepted_observation = k05_agent06_owner_port.observe_accepted_agent_run(
    source_bound_run,
    task_cell=task_cell,
    task_id=task_id,
    source_bytes=authorized_owner_bytes,
    owner_verify=original_owner_evidence_verifier,
)
\`\`\`

Граничные данные остаются owner-local. Для сравнения действительных исполнителей вызывается существующая \`compare_task_executors\` над двумя такими проверенными наблюдениями. ROI проходит через \`compare_process_phases\` только при сопоставимых case definition, объёмах, полном spend и доказанном инвестиционном платеже. Отсутствующие входы остаются \`UNKNOWN/NOT_MEASURABLE\`.

## Испытания

\`python -W error::ResourceWarning -m unittest research/cross-lab/tests/test_k05_agent06_effectiveness.py -v\`
\`python -W error::ResourceWarning -m unittest research/cross-lab/tests/test_k05_agent06_owner_port.py -v\`
\`python -W error::ResourceWarning -m unittest research/cross-lab/tests/test_k05_agent05_final_result_binding.py -v\`
\`python -W error::ResourceWarning -m unittest research/cross-lab/tests/test_k05_agent05_graph_readback.py -v\`
\`python -W error::ResourceWarning -m unittest research/cross-lab/tests/test_k05_agent05_observations.py -v\`

В публичном Actions нет приватного checkout, PAT, EXE, пользовательских данных, workflow в закрытом Agent, реальной внешней отправки OTLP и вызовов моделей. Следующий пользовательский этап: owner-local фактическая Task→Human Review→accepted Result→verified TXR→cold readback, затем независимая сопоставимая пара; статус \`AGENT06_EFFECTIVENESS_ACTUAL_DATA=NOT_TESTED\` до такого эксперимента.


## Следующий этап: реальные функции T3 Process Intelligence без дублирования

Код: \`research/cross-lab/k05_agent06_t3_process.mjs\`. Тест: \`tests/test_k05_agent06_t3_process.test.mjs\`. K05 вызывает **оригинальный** \`deriveProcessIntelligence\` из \`Faust-S/knowledge/packages/t3-core/src/modules/base/features/project-process/process-intelligence.mjs\`, а не переписывает алгоритмы. Публичный CI получает актуальную исходную ветку T3 только для чтения через \`actions/checkout@v4\` и обязательно записывает фактические checkout HEAD/TREE перед тестом. Ранее наблюдавшийся SHA \`43e94486...\` стал недоступен при последующем checkout, поэтому не объявляется квалифицированной ревизией. Приватные репозитории, токены и workflow не затрагиваются.

Контракт K05 \`IWXA_K05_T3_PROCESS_DERIVED_METRICS/0.1\` сохраняет \`sourceTruth=false\`, \`operationalTruth=false\` и \`original_owner_evidence_readback=NOT_VERIFIED\`. Точное \`sum_activity_time_nanoseconds\` из T3 означает **сумму длительностей операций**, не elapsed времени процесса: параллельные операции могут перекрываться. \`process_cycle_time_ms\`, \`accepted_result_count\`, \`actual_cost_minor\` и \`actual_roi_status\` остаются \`null/NOT_MEASURABLE\`. Неполное покрытие времён, неизвестные исходные Activity, неверные denominators и пропущенные event.evidenceRefs запрещают повышение статуса. Вычисленные metrics без readback original Event не становятся наблюдаемыми фактами.

Публичная интеграционная проверка использует искусственные записи, но **исполняет настоящий T3 Process Intelligence** на зафиксированном owner коде. Этим подтверждается совместимость адаптера, а не реальная эффективность организации.

После прикладной интеграции Agent должен прочитать конкретный original T3 Task/Result/Activity/Events с разрешением владельца, получить незамаскированные provenance только внутри доверенного Host, проверить бизнес-статусы в доменном owner и фактический Atlas plan/fact. ТОЛЬКО после этого K05 вправе строить источник-связанные сравнения и экономику, не допуская синтетические записи к продуктовой приёмке.
