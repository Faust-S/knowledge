# IWXA TASK-EXP-01 — передача в проект «Система знаний»

Дата передачи: 04.11.2026. Продолжение действующей разработки, **не** новый Task Engine, Annotation Platform или проект с нуля.

## Где продолжать

- Публичная основная ветка: `Faust-S/knowledge@work/2026-11-03-unified-task-migration`. Правила: `AGENTS.md`; вход: `research/task-discovery/README_RU.md`.
- Закрытая архитектура: `Faust-S/IWXA-knowledge@work/2026-11-03-unified-task-migration`, существующая запись `docs/09_CROSSLAB_MIGRATION_GOVERNANCE_2026-11-03_RU.md`.
- Canonical владелец U1/E1–E4, TASK-EXP-01 и Label Studio review bridge: `Faust-S/iwxa@knowledge/2026-10-02-system-atlas`. Прочитать `AI_START_HERE.md`, `AGENTS.md`, `knowledge/task-catalog/AGENTS.md`, разделы 19–34 `knowledge/activity-research/OWNERSHIP_AND_REAL_SYNTHETIC_CORPORA_2026-10-23_RU.md`, `knowledge/task-catalog/engine/E5_PREREGISTRATION_RU.md`.
- Основной пользовательский маршрут: исходные сведения → U1 Evidence → подсказки действий → контекст и основания → ручное уточнение Task → **существующий** Task Research Engine → специализированный Agent или модель + Skills → проверяемый результат. Обнаружение сигнала не создаёт Task/TaskType и не разрешает исполнение.
- Перед изменением кода **обязательно** заново получить HEAD/TREE всех веток; ссылки и ревизии в handoff — исторические ориентиры, не разрешение на force push. `main` и T0/T1 не менять.

## Научный статус на передаче

- Exploratory TASK-EXP-01: восемь оригинальных публичных issue, **8/8 SHA** подтверждены, **455** U1 RawStatements, **14** U1 review cues в **3/8**, **5** заранее фиксированных title-regex cues в **3/8**. Пересечение документов со сигналами **1/8**, объединение **5/8**, без сигналов обоих методов **3/8**. Все восемь, включая cue-silent, остаются в слепой source-first разметке.
- Зафиксирован pre-gold method snapshot SHA-256 `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0`; манифест Git blob `4ecaa74522ba1c3fa4e8851e877200c7767ad0de`; pinned U1 Git blob `eb15aec5ba1a749c29d7c40a868127e1a384b6bf`. Это сравнение **лексических подсказок**, не измерение точности обнаружения реальных Task.
- Label Studio **1.23.2 реальный HTTP API** испытан в публичном Actions: `https://github.com/Faust-S/knowledge/actions/runs/41717492140` — 2 синтетических проекта, импорт/readback 8+8 заданий, 16 синтетических API-аннотаций, корректный отказ признать одну учётную запись двумя независимыми рецензентами. Реальный дефект: исходное название проекта >50 символов, исправлен в `f13269e2...`.
- `labelstudio_project_setup.py`: создаёт две слепые owner-local задачи рецензентов, выгружает два отдельных JSON и проверяет source integrity; `review_effort.py`: суммирует только фактически сообщённый `lead_time`, допускает явную условную ставку, не приписывает время внимания; `review_form_contract.py`: проверяет исходную **специализированную** TASK-EXP XML (не сокращённую E5).
- Коммит `aa007bf315ef6d3ec143c34a1a46b8863ef0f2f1`: после создания проекта добавлена проверка **фактически сохранённой Label Studio формы до импорта**, fail-closed при смене полей. Для него зарегистрированы CI `41732163276` (основная регрессия) и `41732163294` (реальный synthetic Label Studio smoke). Оба CI завершились **PASS**: source-first регрессия и real Label Studio 1.23.2 synthetic API; сохранённая форма успешно проверена до импорта. Это не owner exact XML/UI и не human gold.
- **НЕ ВЫПОЛНЕНО:** настоящие рецензенты A/B, независимость специалистов, owner-local импорт оригинальных восьми случаев, соглашение по разногласиям, `HUMAN_TASK_GOLD`, `TASK_PRECISION/RECALL/F1`, `HUMAN_REVIEW_TIME`, formal held-out E5, ATUS 2025 real replay и Agent/T3 handoff.

## Единственный следующий предметный gate: M3 HUMAN REVIEW

1. Сначала удостовериться в зелёной проверке формы в двух перечисленных Actions; при ошибке устранить **только** подтверждённую интеграционную несовместимость.
2. В разрешённой **owner-local** среде `Faust-S/iwxa/knowledge/task-catalog` выполнить штатный `python -m engine.research.task_exp_01_real_slice --restricted-output /PRIVATE/e5-envelope.json --restricted-import-output /PRIVATE/labelstudio-import.json --restricted-method-output /PRIVATE/u1-method-spans.json --confirm-local-source-review`. Для заранее полученных оригиналов использовать `--input-dir`; все три закрытых файла **вне Git checkout**, не публиковать и не передавать в Actions.
3. Проверить локально оригинальную `knowledge/task-catalog/engine/research/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml` (Git blob `7922b634b145bc064a33f95d04c058d3c5da18f6`). Общая `E5_LABEL_STUDIO_SOURCE_FIRST.xml` несовместима с требованием полей `goal/expected_result/acceptance_criterion`.
4. В публичном checkout `Faust-S/knowledge` в каталоге `research/task-discovery` использовать `labelstudio_project_setup.py` с `--create-local-projects --confirm-local-import --reviewer-slots 2`, доступным локальным Label Studio API и `--auth-mode legacy` или `--auth-mode personal`. Оператор назначает **двух разных независимых людей**, им недоступны подсказки U1/regex и решения друг друга.
5. После того как **люди** разметили все 8/8 исходных текстов каждый, использовать `--export-reviewed-projects --project-a-id ... --project-b-id ... --review-a-out /PRIVATE/review-a.json --review-b-out /PRIVATE/review-b.json`; затем у canonical owner выполнить `python -m engine.research.task_exp_01_review_bridge --source-first-packet /PRIVATE/e5-envelope.json --review-a /PRIVATE/review-a.json --review-b /PRIVATE/review-b.json --restricted-disagreement-output /PRIVATE/disagreements.json --confirm-independent-local-review`. Owner Bridge сверяет UTF-16/Unicode, исходники, категории, поля интерпретаций и сохраняет **разногласия**, но не создаёт автоматический gold.
6. Сохранить раздельные оценки, выполнить **независимое** adjudication, фактически замерить время людей и вычислительные затраты, после чего оценить TP/FP/FN и precision/recall/F1. Отдельный E5 требует новых held-out источников и реальных специалистов по `E5_PREREGISTRATION_RU.md` — exploratory 8 issue не заменяют E5.
7. Не создавать отдельный движок U1, Host, Kernel, Task Engine, Result Store, Annotation Platform, Context Compiler или агентный runtime. Не расширять тестовую инфраструктуру без нового выявленного препятствия.

## Техническая приёмка нового шага

- Публичная regression: https://github.com/Faust-S/knowledge/actions/runs/41732163276 — SUCCESS.
- Реальный Docker Label Studio 1.23.2 synthetic HTTP: https://github.com/Faust-S/knowledge/actions/runs/41732163294 — SUCCESS. Проверен persisted XML form readback до импорта, 8+8 задания и отрицательная проверка единой учётной записи. В тесте нет реальных рецензентов.
- Разработка и проверка выполнялись на публичной ветке; `main`, canonical `Faust-S/iwxa` и другие owning repos не изменялись.

## Ожидаемая отчётность

После цикла: опубликованные изменения, exact HEAD/TREE, ссылки на коммиты/Actions, реально исполненные тесты, реальные числовые результаты с denominators, PENDING, следующий практически измеримый шаг. Обновлять **существующую** запись миграции, не размножать отчёты. Выбранный проект чата «Система знаний» меняет контекст работы, но **не** права владения кодом или GitHub-ветки.
