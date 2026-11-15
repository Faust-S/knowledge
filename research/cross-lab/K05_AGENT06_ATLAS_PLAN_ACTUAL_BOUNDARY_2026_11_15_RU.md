# K05 / Atlas 0.8 — плановый прогноз не фактическая эффективность

Дата 15.11.2026, публичная разработка \`Faust-S/knowledge@work/2026-11-15-agent06-effectiveness-evaluation\`.

Исходный Atlas: \`Faust-S/Atlas@work/2026-11-14-atlas-0-8\`. На момент инспекции HEAD \`4cb8da29cdc084cd73574fff1ff5dd93bbb2bc5a\`, TREE \`a8197fb86c079350a0ed880d9c60f6f890baf157\`. Публичный CI фиксирует точный фактически извлечённый HEAD/TREE непосредственно перед проверкой.

## Фактически реализованные данные Atlas

- \`src/planning.mjs:scheduleProject\` рассчитывает CPM-план в **календарных днях**, включая ранние/поздние даты, критические работы, плановую длительность и предупреждение \`Calendar-day CPM estimate\`. Это не исполнение.
- \`src/planning.mjs:scheduleChangeSummary\` сравнивает две вычисленные версии CPM по affected/moved/critical, смещениям и срокам. Это сравнение **планов**, даже если редакция была сохранена.
- \`src/work-schedule-preview.mjs\` выдаёт временный прогноз до явного применения черновика. Точное применение/сохранение не создаёт квитанцию реальной длительности исполнения.
- \`src/reality-overview.mjs\` описывает источник наблюдения и состояние работ, но сам документ прямо уточняет: статус работы — заявление пользователя, не proof принятого результата.
- \`src/source-observation.mjs\` наблюдает GitHub source revisions; это не производственные затраты.
- \`docs/ATLAS_0_8_WINDOWS_ACCEPTANCE_2026_11_15_RU.md\` фиксирует установку/холодное восстановление, а не фактические себестоимости организаций.

## Что введено в K05

\`k05_agent06_atlas_planning.mjs\` — крошечный read-only адаптер **оригинальных** \`scheduleProject\` и \`scheduleChangeSummary\`. Проверяет совпадение planned duration, work coverage и owner semantics. Выход \`IWXA_K05_ATLAS_PLANNED_CHANGE/0.1\`:

- \`status=PLAN_ONLY_NOT_EXECUTION\`;
- \`planned_delta_calendar_days\`, \`planned_moved_works\`, \`planned_critical_changed_works\` доступны как данные **планирования**;
- \`observed_process_cycle_ms=null\`, \`observed_human_active_ms=null\`, \`observed_actual_cost_minor=null\`, \`actual_roi_percent=null\`;
- \`accepted_business_result=NOT_VERIFIED\`, \`source_event_provenance=NOT_VERIFIED\`.

Даже \`state=done\` или пользовательские поля вроде \`actualCostMinor\` не переводят план в фактическое измерение, если original owner не предоставил полноценные immutable Event/Result/Acceptance/Invoice receipts. Данные проекта, ФИО, названия работ, source IDs и ссылки не экспортируются из этой проекции K05.

## Проверки и практическая граница

Публичный \`node --test research/cross-lab/tests/test_k05_agent06_atlas_planning.test.mjs\` запускается над реальным Atlas \`src/planning.mjs\` из его открытого read-only checkout. Небольшой искусственный проект подтверждает разницу плановых сроков 5→7 календарных дней, но не исполнение и не экономический ROI. Проверяются поддельный статус, отсутствие дат, некорректная длительность и отсутствие original owner port.

Для реальной оценки после внедрения нужны исходные T3/Activity business Event/Result или отдельный доменный факт выполнения с timestamp/evidence, фактическое время человека, оплаченные расходы и сопоставимая before/after exposure population. Atlas может предоставить плановый baseline и объяснить отклонения, но **не быть единственным источником measured ROI**. Рекомендация: подключать только в интерфейсе просмотра «План против факта», фактические значения всегда из другого проверенного владельца. Не устанавливать Superset/OpenLIT для решения этого пробела.
