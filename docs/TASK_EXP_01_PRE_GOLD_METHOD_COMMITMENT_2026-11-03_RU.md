# IWXA TASK-EXP-01 — закрепление методов до независимой разметки

Дата: 2026-11-03. Статус: **PRE_GOLD_METHOD_COMMITMENT_PASS / INDEPENDENT_GOLD_PENDING / E5_NOT_RUN**.

## Воспроизводимое исполнение

- Исходная ветка: `Faust-S/knowledge@work/2026-11-03-unified-task-migration`.
- Точный проверенный коммит: `f6f559edc26fdcae733c01266d3aaef188fdfe95`, TREE `d47639ddf0468983c7eb7c4d9b2ccc00737d1252`.
- [GitHub Actions #41670916077](https://github.com/Faust-S/knowledge/actions/runs/41670916077): `completed/success`; offline tests, реальный native U1 и regex на исходных восьми issues, проверки состава выходного файла и запись hash-only результата — PASS.
- Полученный публичный артефакт: `task-exp-01-pre-gold-hash-commitment`, GitHub artifact ID `13248950853`. Извлечён и прочитан: только SHA/версии/8 sources/нулевые признаки gold; нет текстов источников или method cue spans.
- SHA-256 **канонического снимка результатов методов**: `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0`.
- Pin U1 Git blob: `eb15aec5ba1a749c29d7c40a868127e1a384b6bf`; pinned TASK-EXP-01 source selection Git blob: `4ecaa74522ba1c3fa4e8851e877200c7767ad0de`; existing E5 Label Studio XML Git blob: `7b82dbd05b4e28c53446d863c5bb48b72245a10d`.
- Код: `research/task-discovery/method_snapshot.py`, тесты `test_method_snapshot.py`; workflow `.github/workflows/task-discovery-source-first.yml`.

## Почему отдельный commitment

Слепая независимая разметка должна выполняться по **исходному документу**, без подсказок метода. Методные byte spans проверяются на все 8 исходных SHA и сохраняются локально на runner до вычисления канонического SHA. Публичный artifact содержит **только** digest и фиксированные версии, без method spans. Они не передаются в Label Studio. Новая реализация не создаёт Label Studio или Task Engine.

Следует учесть, что после завершения disposable GitHub runner точные spans этого запуска доступны только как digest. Для сравнительного сопоставления с gold понадобится заново исполнить ровно тот же pinned алгоритм и убедиться в совпадении digest **до просмотра gold**. Если он не совпал — HOLD, нельзя подменять SHA или править лексикон после разметки.

## Настоящие исходные показатели (из предыдущего paired run)

- 8/8 GitHub issues c frozen SHA; native U1: **455 RawStatements, 14 лексических review cues в 3 из 8**.
- Title-only regex: **5 cues в 3 из 8**, source intersection = 1, union = 5; cue-silent в обоих методах = 3/8, все 8 сохранены для review.
- Это **не task classification**. Классы PROCESS/INDEPENDENT_TASK/OPERATION/INSUFFICIENT_EVIDENCE в этом цикле не прогнозировались; task precision/recall/F1, human time и ложные задачи **NOT_MEASURED**.
- SHA+BFS `NOT_APPLICABLE` на issue-корпусе без независимого графа зависимостей.

## Следующий проверяемый этап — независимая оценка

У владельца существующего TASK-EXP-01 использовать `knowledge/task-catalog/engine/research/task_exp_01_real_slice.py` с `--restricted-output`, `--restricted-import-output`, `--restricted-method-output`, `--confirm-local-source-review` только в owner-local разрешённой среде. Два независимых рецензента, не видевших методных spans, дают source-first оценки всех восьми документов; третий adjudicates разногласия. Существующий `task_exp_01_labelstudio_import.py` использует ту же E5 схему. Проверить факт independent gold, версии source, основания, знаменатели и time, затем (не раньше) сравнивать task-level precision/recall.

Для строгой E5 квалификации нужен **отдельный** заранее отобранный held-out корпус по действующему preregistration: текущие восемь ранее использованы при инженерной разработке и не заменяют E5. Не создавать вторую систему разметки/rights/Task Engine.

## Ограничения

Истинность внешнего сообщения и авторство/права независимо не удостоверены. Публичный workflow без приватных токенов и файлов. `TaskCandidate=0`, T1/E4 auto approval отсутствует. Главные продуктовые маршруты Personal Agent не менялись. В конце исследования сложный Cross-Lab включать в продукт только при измеренном преимуществе против direct source, exact search и regex.
