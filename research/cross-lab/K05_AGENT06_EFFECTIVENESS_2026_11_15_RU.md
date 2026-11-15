# IWXA K05 / Agent 0.6: оценка фактической эффективности

> **Актуализация 15.11.2026:** расчёт ROI из готовых проекций был признан недостаточно обоснованным. Действующий строгий маршрут: `k05_agent06_admission.py`, документ `K05_AGENT06_SOURCE_REPLAY_ROI_2026_11_15_RU.md`. Привязка метрик к Task/Result обязательная, invoice требует оплаты и назначения; без source replay, проверки comparable population и доказанного платежа ROI = `NOT_MEASURABLE`.

Дата: 2026-11-15. Статус: PUBLIC SOURCE IMPLEMENTATION; установленная продуктовая приёмка Agent 0.6 не выполнялась.

## Владение и проверенные исходники

- K05: `Faust-S/knowledge@work/2026-11-05-k05-evidence-context-evaluation`, исходный HEAD `6d16d43ce6d6c118ba9a430ee308e020095a7974`, TREE `5a2534d91e3c17658d2cbbabc468bd27978cb508`.
- T3: `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`, HEAD `0877f6ffc690621231ce7246c0bf604af441ae1c`, TREE `948bfe4529385fb8dec9afc8978b28da624e7a7d`.
- Activity: `Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer`, HEAD `2383c58f88901f16aa2a5fa780de447dba3d4750`, TREE `414e125cacfca1d87ac429f84d31c00f3e279893`.
- Agent 0.6: `Faust-S/iwxa-personal-agent@work/2026-11-15-agent-0-6-development`, HEAD `978b28d6690aeee7f17cc263a563ec1a5d025cbe`, TREE `c6ba3d5bb0f9a9c558dec7d8799e722b1f3823c3` (только read-only, общая ветка не изменена).
- Новая отдельная ветка K05: `work/2026-11-15-agent06-effectiveness-evaluation`.

## Не дублировать существующее

| Измерение | Где уже есть | Граница достоверности |
| --- | --- | --- |
| Модель: input/output tokens, elapsed_ms | `Agent runtime/public_k05/model_execution_evaluation.py` | Host-reported из Graph artifact; cost и качество UNKNOWN |
| Связь финального текста и Graph | `k05_agent05_final_result_binding.py` | Точное совпадение digest, не доказанное принятие Task |
| Пары наблюдений | `k05_agent05_observations.py` | Строгий same-model gate для абляции; НЕ использовать для сравнения разных исполнителей |
| Инструменты | `Agent runtime/tool_runtime.py` | `TRR-` read receipts и `TXR-` execution receipts, original owner readback |
| Task acceptance | `Agent cells/task.py`, `schemas/task-state.schema.json`, `schemas/review-decision.schema.json` | Закрытая Task, `accepted_artifact_ref`, исходный approve_draft; обязательно owner-verified |
| Процесс: events, variants, conformance, activity duration | `T3 process-intelligence.mjs` | Только `sourceTruth`, evidenceRefs, входные связи и общая шкала времени |
| T3 Activity | `src/t3/activity/index.mjs`; Activity `engine.mjs` | observed vs reported/inferred/proposed; restricted OCEL 2, не весь стандарт |
| Доменные бизнес-факты и Atlas plan/fact | Доменные owners / Atlas | Не считать plan прогнозом actual без подтверждённого readback |
| Реальные invoices, трудозатраты человека, возвраты, потери, внедрение | Частично или НЕИЗВЕСТНО | Нужны дополнительные подтверждённые записи источников, без оценки из токенов |

## Новый необязательный адаптер K05

`k05_agent06_effectiveness.py`: read-only верификация отдельных наблюдений через **внешний доверенный owner_verify** + точные исходные bytes, sha256 и schema. Owner-порт обязан проверить оригинальные TypedRefs, immutable review/accepted refs, epoch/revision, actor/authority, Task/Result и ToolRuntime receipts, исходные Activity evidenceRefs и provenance, реальное происхождение и epistemic статус, currency/units, verified readback после перезапуска, где требуется. K05 не может это доказать самостоятельно по хешам. **Проверка на фикстурах с mock verifier не является реальным бизнес-результатом**.

`observe_run` не принимает `accepted=True` из произвольного текста. Для `ACCEPTED` обязательно подтверждённое владельцем evidence `HUMAN_REVIEW` или `DOMAIN_ACCEPTANCE`, привязанное к тем же sha256 Task/Result. Graph final binding допускается как дополнительная проверка, а не замена Human Review. Неизвестные метрики возвращаются `null` с `UNKNOWN`. Неверифицированные квитанции, несовпадение хешей, валют, source types и owner facts вызывают HOLD.

`compare_task_executors` позволяет сравнить двух исполнителей одной Task / одинаковых input и cohort, сохраняя известные duration, human effort, retries, costs и Tool receipts. Ранжирование литературного качества отсутствует.

`compare_process_phases` сравнивает процесс по одинаковой версии определения case/cohort и валюте; сумма фактических затрат, число принятых результатов и стоимость принятого Result отражаются только при полном покрытии. Сам `compare_process_phases` не выдаёт ROI по готовым проекциям. Только `compare_verified_process_runs` после source replay, owner-verified population и paid investment может вывести наблюдательный бухгалтерский ROI без причинной атрибуции IWXA. Не следует масштабировать средние по неизвестному объёму.

`k05_agent06_otlp.py`: **отключённый по умолчанию** генератор OTLP/JSON technical metrics. Никакого HTTP, SDK, коллектора, скрытой отправки или новых журналов в K05. Только после явного разрешения пользователя Agent может передать полученный документ в существующий OpenTelemetry Collector. Из вывода исключены Task/Result/source hashes, текст, модель, user IDs, названия инструментов, деньги, receipts. Экспортируемые суммы отдельного запуска являются delta, не lifetime cumulative. Не отправлять payload в OpenLIT или публичный telemetry endpoint без разрешения.

## Порт будущего Agent 0.6

1. Agent Core через существующий TaskCell проверяет closed state и accepted artifact; читает исходный Result, Review и typed refs, проверяет digest, возвращает **owner-validated read-only facts** для K05.
2. ToolRuntime через существующие `read_read_receipt` / `read_execution_receipt` и оригинальные checks подтверждает квитанции; операции, имена инструментов и аргументы во внешнюю телеметрию не передаются.
3. T3 через один original Kernel/Host и D2 reader подтверждает provenance для измеренных процессов; Activity остаётся производным представлением, не выдаёт inferred activity за observed.
4. Atlas и доменные адаптеры передают исключительно actual vs actual по сопоставимым единицам, версиям и периодам. Forecast/plan указывают отдельно и никогда не участвуют в observed ROI.
5. Никакой обязательной установки OpenTelemetry/OpenLIT. UI Agent показывает 4 независимые вкладки/секции: технические измерения, принятые результаты, процессы, экономика. На каждой метрике `OBSERVED` / `UNKNOWN` / `NOT_MEASURABLE`, разрешение источников и явный экспорт.

## Внешние инструменты: последовательное подключение

- **OpenTelemetry**: первоочередной open standard, локальный OTLP Collector по запросу. SDK Python, Node и Collector обычно Apache-2.0. Не обязателен K05.
- **DuckDB** (MIT) или **Polars** (MIT): выбрать *один* для большого локального обезличенного массива, только если штатной Python агрегации недостаточно. Не создавать второй event store.
- **OpenLIT**: кандидат на локальную техническую ИИ-аналитику поверх OTel; проверить актуальную лицензию конкретного компонента и локальное развёртывание перед подключением. Не подменяет Human Review и экономическую пользу.
- **Evidently**: полезен для независимых повторяемых экспериментов, но не обязателен ни для обычной Task, ни для литературной оценки.
- **Comet Opik**: альтернативный self-hosted кандидат; не устанавливать одновременно с OpenLIT без сравнительного эксперимента.
- **Apache Superset** (Apache-2.0): только при организационной потребности в BI и проверенном источнике агрегатов, не в каждом desktop Agent.
- **OpenCost** (Apache-2.0): только при фактическом Kubernetes spend; не применим к обычному локальному ПК.

Лицензии и условия конкретных сборок/зависимостей перепроверить при фактической установке, особенно OpenLIT/Opik/Evidently. Процент «ROI IWXA» требует помимо бухгалтерской разницы независимой схемы атрибуции (контрольная группа, сопоставимый период и внешние изменения), а не статуса `OBSERVED`.

## Три целевых сценария и честная область проверки

1. Одна Task, два исполнителя: сравнить по одному sha256 Task/input/cohort и разным executor; оба приняты Human Review, метрики и Tool receipts привязаны к исходным квитанциям.
2. Процесс before/after: одинаковая версия процесса, одинаковые units и coverage, actual elapsed, human time, returns, стоимость принятого Result.
3. Экономика внедрения: observed costs before/after + invoice подтверждённого внедрения; отдельно показывать наблюдательный ROI и `roi_attributable_to_iwxa=NOT_MEASURABLE` до независимого контроля.

Публичный unit fixture не имеет доступа к реальным индивидуальным Task, архивам .iwxa, пользовательской Activity или чекам. Результаты фикстур иллюстрируют математику и отклонение подложных receipts, **не фактическую эффективность IWXA**.

## Проверка и ограничения

Адресный тест: `python -m unittest research/cross-lab/tests/test_k05_agent06_effectiveness.py -v`.
После него: существующий набор `python -m unittest discover -s research/cross-lab/tests -v`.
Критерий готовности: PASS исходных контрактов + независимый owner-side Agent 0.6 Task→Review→Result→Tool receipts и readback + фактические Activity + бизнес-источники на реальном разрешённом наборе. До этого: `AGENT06_EFFECTIVENESS_INSTALLED=NOT_TESTED`, `ACTUAL_ORGANIZATION_ROI=NOT_MEASURABLE`.
