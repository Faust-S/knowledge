# K05 / Agent 0.6 — исходные затраты, допуск экономического сравнения и ROI

Дата: 2026-11-15. Scope: только публичный \`Faust-S/knowledge@work/2026-11-15-agent06-effectiveness-evaluation\`, без изменений Agent/T3/Activity. Status: PUBLIC CONTRACT IMPLEMENTED; installed Agent 0.6 and real organization observations NOT_TESTED.

## Причина доработки

Ревизия обнаружила три допуска, неприемлемые для фактической экономики:

1. Прежний \`_verified_measurement\` разрешал \`owner.task_sha256=None\` и \`owner.result_sha256=None\`. Из-за этого счёт или рабочее время без явной связи с конкретным Task/Result могли попасть в стоимость результата.
2. \`compare_process_phases\` мог вернуть 300% «наблюдательного ROI» для двух переданных готовых словарей с флагом \`schema\`. Эти словари не проходили owner readback внутри самого компаратора, а равное количество работ не означает сопоставимую сложность, охват затрат или одинаковый период.
3. \`read_agent_execution_receipts\` называл дополнительную квитанцию с тем же \`idempotency_key\` повтором исполнения. Это может быть повторное прочтение/восстановление ответа без повторного реального запуска.

## Реализация исправлений

- \`k05_agent06_effectiveness.py\`: метрики \`actual_cost_minor\`, \`human_active_ms\`, \`elapsed_ms\`, \`retry_count\` и другие допускаются только при **точном** owner-validated \`task_sha256\` **и** \`result_sha256\`. Любой \`None\` в связях метрики: HOLD \`METRIC_NOT_OWNER_BOUND\`. Это не относится к отдельной квитанции о совокупных затратах на внедрение, которая привязана к cohort.
- Подтверждённая фактическая инвестиция теперь требует \`COST_INVOICE\`, совпадающую валюту, \`values.cohort_sha256\`, \`purpose=IWXA_IMPLEMENTATION\`, \`payment_status=PAID\`. Смета, финансовый прогноз, неоплаченный счёт или чужой cohort не являются инвестиционным платежом.
- \`compare_process_phases\` остаётся **проекцией** и выдаёт totals, accepted counts, unknown и расчётную стоимость принятого Result. Но больше не рассчитывает ROI по принятым извне словарям; \`roi_status=NOT_MEASURABLE\` до прохода исходных owner receipts через source replay.
- Новый **тонкий необязательный допуск, не второй evaluator** \`k05_agent06_admission.py\` переиспользует \`observe_run\`, \`compare_task_executors\`, \`compare_process_phases\`. \`compare_verified_task_runs\` повторно валидирует исходные bytes для двух выбранных исполнителей. \`compare_verified_process_runs\` повторно валидирует каждый original run, затем требует отдельный \`DOMAIN_FACT\` со следующим:
  - точные fingerprint массивов before/after (Task/Result/acceptance/run), полученные из уже валидированных наблюдений;
  - тот же process cohort, currency, case definition, case-mix digest;
  - непересекающиеся source-observed before/after UTC окна и полный наблюдаемый охват затрат;
  - owner-reported \`original_source_readback=True\` и отсутствие plan/forecast.
- После этих допусков возможно **только** \`observed_accounting_roi_percent\`, всегда \`roi_attributable_to_iwxa=NOT_MEASURABLE\`. Независимая атрибуция причин, контрольные группы, законодательные и рыночные изменения этим кодом НЕ доказаны.
- \`k05_agent06_owner_port.py\`: \`same_idempotency_key_additional_receipts\` показывает только корреляцию по ключу. \`retry_count=None\`, \`retry_status=UNKNOWN_WITHOUT_ORIGINAL_ATTEMPT_EVIDENCE\`. Реальный retry выводить только из original попыток/истории ToolRuntime.

## Формула наблюдательной экономики

При одинаковом количестве принятых и выполненных единиц, подтверждённом объёме, известной полной операционной стоимости и положительном оплаченном внедрении:

\`observed_accounting_net_minor = before_actual_spend_minor - after_actual_spend_minor - paid_implementation_minor\`

\`observed_accounting_roi_percent = 100 × observed_accounting_net_minor / paid_implementation_minor\`

Это бухгалтерское сравнение, **не** причинная оценка действия IWXA. Денежные единицы — integer minor units одной валюты, без автоматически предположенного курса. В реальном учёте необходимо проверить, что одинаковые статьи расходов включены в обе фазы, нет двойного счёта расходов на человека и модель и что инвестиции не включены одновременно в operational spend и paid implementation. Тестовая фикстура с 20,00 USD до, 12,00 USD после и 2,00 USD внедрения выдаёт 300% строго при подтверждённом owner-reported audit; она не является наблюдением реальных организаций.

## Подключение существующего Agent 0.6

Внутри установленного оригинального Agent Host:

\`\`\`python
from k05_agent06_admission import compare_verified_task_runs, compare_verified_process_runs

# Bytes and owner_verify are produced by real Agent/Core/domain owner ports.
pair = compare_verified_task_runs(
    raw_run_a, raw_run_b,
    source_bytes=trusted_owner_source_bytes,
    owner_verify=original_owner_verifier,
)
economics = compare_verified_process_runs(
    verified_before_runs, verified_after_runs,
    source_bytes=trusted_owner_source_bytes,
    owner_verify=original_owner_verifier,
    investment=original_paid_invoice_pin,
    comparison_evidence=original_comparable_population_pin,
)
\`\`\`

В этом публичном модуле нет исходников приватного Agent, сканирования папок пользователя, нового хранилища событий, сетевой отправки, фонового обработчика или системы принятия результатов. Текущий K05 не имеет права самостоятельно вызывать Task/Result/ToolRuntime write или выдавать доступ к чужим данным. \`original_owner_verifier\` должен проверять оригинальные immutable receipts и provenance через штатный Owner; словарь с \`verified=True\` не считается независимой проверкой без доверенного источника.

## Негативные сценарии публичного CI

- Чужой/непривязанный invoice, elapsed, human time — HOLD.
- Прогноз, не оплаченный счёт, иное назначение invoice или другой cohort — HOLD.
- Периоды пересекаются, изменился case mix, нет полного покрытия/выполнимой сверки population — HOLD.
- Скомпрометированы исходные bytes, подменена исходная стоимость, неверная валюта/Result — HOLD.
- В любой фазе отсутствует actual cost или investment/population source — ROI остаётся \`NOT_MEASURABLE\`.
- Две принятые Task могут быть сравнены по наблюдениям, но не по литературному качеству.
- Повтор receipts с одинаковым key не переводится в реально выполненный retry.

## Статусы приёмки

- Исходный код, тестовый owner port и воспроизводимые публичные фикстуры: квалифицируются в \`.github/workflows/k05-agent06-effectiveness.yml\`.
- Полный оригинальный установленный маршрут Agent Task→Human Review→Result→ToolRuntime→cold readback: \`NOT_TESTED\`.
- Реальный процесс Activity/T3 с business Event из разрешённого Workspace: \`NOT_TESTED\`.
- Реальные полные before/after данные организации и её оплата внедрения: \`NOT_MEASURABLE\`.
- Прогнозы отдельно от observed; никакой публикации пользовательских сырьевых данных.

Следующий практический этап: владелец Agent 0.6 подключает owner verifier к TaskCell и ToolRuntime, а домен/Atlas — к проверенной модели comparable population и actual plan/fact. Тогда K05 выдаёт достоверную стоимость принятых Result и сравнение фактических процессов, сохраняя UNKNOWN при недостаточном evidence.
