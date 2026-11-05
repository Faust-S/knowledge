> **C15 — latest qualified (05.11.2026):** [Actions 42002932598](https://github.com/Faust-S/knowledge/actions/runs/42002932598) SUCCESS, 9/9 tests and source-bound replay. 3/3 raw-confirmed entrance-door CLOSED events lie within ±5s **after the end** of 3 distinct author video OCEL `Enter room/Leave room` annotations (2 Enter, 1 Leave); 2/3 in ±1s. Non-door video label baseline: 0 edges at ±1s, 2 edges at ±5s. Candidate video annotation review set **3 of 23**; 14 existing source rows + 3 video annotations = 17 elements, compared with 37 for all 23 video segments. This is reduction in review *elements*, not human time or independently confirmed activity. Clock calibration, actor, human gold, task precision and review minutes remain NOT_MEASURED / UNKNOWN; accepted Tasks = 0. Implementation in existing `solve4x_c14_raw_reed_review.py`, full details in `SOLVE4X_MULTICHANNEL_REPLAY_2026-11-04_RU.md`.

> **C14 latest verified:** [Actions 41921481566](https://github.com/Faust-S/knowledge/actions/runs/41921481566) SUCCESS: 12/12 tests, raw `scene01_reed_switches.csv` pinned SHA `5e469a4bd4f14f831bbdce1048fe4ec963a8c263c05b90c77a167cf0dc5bf5e0`; 15 raw reed records (11 door/4 cupboard), all three C13 non-video sensor episodes correspond to exactly one source `ENTRANCE CLOSED` record in ±1 s (3/3). Complete review requires 3 sensor OCEL + 6 raw reed + 5 UI = **14 original rows**; clocks and human activity gold remain UNKNOWN; accepted Tasks = 0. Code `solve4x_c14_raw_reed_review.py`, full analysis `SOLVE4X_MULTICHANNEL_REPLAY_2026-11-04_RU.md`. This is source provenance, not independent person/action proof.

> **Последняя предметная квалификация C11:** [Actions 41896311957](https://github.com/Faust-S/knowledge/actions/runs/41896311957) подтверждает источник каждого из 40 событий scene01 OCEL: **23 видео + 17 сенсоры**, пересечений event IDs и core conflicts нет. Прежнее именование 17 как «ITAM system events» в C3–C10 исправлено: сравнение raw ITAM ↔ 17 sensor events не является проверкой Snipe converter. Код `solve4x_scene_component_lineage.py`, экспериментальный отчёт `SOLVE4X_MULTICHANNEL_REPLAY_2026-11-04_RU.md`. Источник human activity gold и Task quality всё ещё `NOT_MEASURED`; `TASK_ACCEPTED=0`.

# IWXA Activity Discovery & Reconstruction — передача в новый чат проекта «Система знаний»

**Дата:** 04.11.2026.
**Тема:** самостоятельная исследовательская линия объединённой IWXA Task/Knowledge/Agent architecture.
**Режим:** продолжение уже действующей разработки, **НЕ** новая программа, engine, TaskType registry, U1, Context Compiler, runtime или user questionnaire.
**Главная цель:** из неформализованного человеческого/организационного запроса и неполных реальных свидетельств получать проверяемое, пересматриваемое понимание деятельности, выявлять кандидатные задачи и определять недостающие сведения без ложной уверенности. Затем независимо доказать полезность для принятой Task и Result.

## 1. GitHub и владельцы

| Функция | Репозиторий / рабочая ветка |
|---|---|
| **Открытая разработка и тесты Activity Research, Task Discovery, Cross-Lab** | `Faust-S/knowledge@work/2026-11-03-unified-task-migration` |
| **Закрытая интеграционная архитектура, приватные решения и handoff** | `Faust-S/IWXA-knowledge@work/2026-11-03-unified-task-migration` |
| **Исходная семантика, U1/E1–E4, Task Engine, E5, Context Compiler, историческая теория** | `Faust-S/iwxa@knowledge/2026-10-02-system-atlas` |
| **Практический потребитель** | `Faust-S/iwxa-personal-agent`, T3/T2 и специализированные продукты — самостоятельно владеют Task/Result/Runtime, ничего не менять без предметного поручения |

**Зафиксированные HEAD при подготовке handoff, обязательна повторная сверка после входа в новый чат:** public `knowledge` исполнительный experiment commit `05fbdbb723e20ddd52e2f5df93d5c09fa754a122`, tree его коммита по GitHub; private `IWXA-knowledge` HEAD `ae3d89b6cfda3726bf30b0ca7336f9d3174b592b`, owner `iwxa` HEAD `573725c5b28503f47f7e1cdd27693dce013290d6`. Редакционные commits handoff могут обновить эти HEAD. **Всегда начать с нового HEAD/TREE и AGENTS.md, не force-push; смежные рабочие ветки развиваются параллельно.** Default/main и канонические T0/T1 не менять.

**Рабочие инструкции:** public `AGENTS.md`; private `AGENTS.md`; public `research/activity-research/README.md`; private `docs/09_CROSSLAB_MIGRATION_GOVERNANCE_2026-11-03_RU.md`. Не дублировать U1/Task Engine/Context Compiler/хранилища и не расширять средства защиты без отдельного решения владельца.

## 2. Теория и миграция источников

В `Faust-S/iwxa/knowledge/activity-research` создана исследовательская основа, в публичный `knowledge/research/activity-research/` перенесены семь **byte-identical** разрешённых файлов с `SOURCE_MIGRATION.json`. Это исследовательский snapshot; upstream owner source права не передавались. Сохранены:

- `THEORETICAL_FOUNDATIONS_RU.md` — многоуровневое исследование эпизодов, рутин и взаимодействующих систем деятельности, отсутствие обязательной анкеты.
- `INTERNATIONAL_REVIEW_2026-10-12_RU.md` — корректировка исходных тезисов с учётом современной BPM, activity theory, work system, Process Mining.
- `EVIDENCE_REGISTRY.json` — 47 международных библиографических источников, полнотекстовая квалификация выполнена только частично.
- `DATASET_SOURCE_CANDIDATES_2026-10-23.json` — 13 dataset/source candidates; реальное исследование не равно загрузке всех данных.
- `pilots/ADP-001.json`, `pilots/ADP-001_RU.md` — первый desk-pilot (5 публикаций, 11 source-bounded claims, 5 cases, 8 negative checks), без независимой полевой приёмки.
- `pet_activity_benchmark.mjs` — PET extraction benchmark; исходный внешний корпус не закоммичен.

**Фундаментальное разграничение:**
`PRESCRIBED` ≠ `REPORTED` ≠ `OBSERVED_WITHIN_SOURCE_SCOPE` ≠ `RECONSTRUCTED_HYPOTHESIS` ≠ `TARGET`.
Информационная система доказывает запись; не обязательно действие. Документированный запрос организации доказывает интерес к исследованию; не доказанное нарушение. Статистическая закономерность не доказывает конкретную Task, причинность и пригодность контекста. Нет данных — допустимый исходный статус `UNKNOWN`.

## 3. Проверенные исполняемые результаты

| Код / документ | Реальный вход / результат | Граница |
|---|---|---|
| PET-01 `pet_activity_benchmark.mjs` | 45 документов, 502 размеченных activity spans; grouped perceptron token F1 `0.6814`, exact-span F1 `0.6578`; исходный Git blob проверен | Activity spans в тексте ≠ реальное выполнение или TaskType |
| ATUS-01 `atus_diary_replay.py` | 24-часовой дневник → EVENT_LOG_JSONL → original pinned U1, 7 synthetic/unit tests PASS | BLS 2025 official ZIP из public runner отвечает HTTP 403; `REAL_ATUS_REPLAY=HOLD` |
| BPI13-01 `bpi13_xes_u1_replay.py` | Public mirror open problems: 819 cases/2351 registered events; 12 cases/50 events через оригинальный pinned U1, PASS | Mirror SHA точен, byte/rights equality с 4TU official original не проверена |
| BPI13-02 `bpi13_mutation_stress.py` | 7 синтетических отдельных искажений *реальной* записи; 6 formal U1 accept, 1 duplicate ID reject | Пять изменённых семантически журналов формально валидны, одно off-system действие невидимо; U1 не source-truth oracle |
| **BPI13-03 `bpi13_owner_questions_audit.py`** | Официальная публикация организаторов 2013: четыре вопроса владельца + реальный open-problems log; 284 activity A–B–A motifs на 819 случаях, 2351 events; оригинальный pinned U1 на 12/50 | НЕ team ping-pong, НЕ фактическая вина/abuse, первый вопрос Push-to-Front относится только к Incidents log |
| TASK-EXP-01/Cross-Lab смежные направления | Закреплённый публичный U1, source-first replay, Label Studio qualification work ongoing | Отдельные owners и ревьюеры; E5 TaskType не принят автоматически |

**Техническая приёмка:** [GitHub Actions run 41732224986](https://github.com/Faust-S/knowledge/actions/runs/41732224986), `completed/success`, exact experiment commit `05fbdbb723e20ddd52e2f5df93d5c09fa754a122`, 8/8 Node + 40/40 Python PASS. BPI13-03 настоящим workflow получил `4 published questions; 819 cases; 2351 registered events; 284 activity-label A-B-A motifs; 0 accepted tasks`. Ранние экспериментальные прогоны: [BPI13-02](https://github.com/Faust-S/knowledge/actions/runs/41719080479), [BPI13-01](https://github.com/Faust-S/knowledge/actions/runs/41712894249), [PET](https://github.com/Faust-S/knowledge/actions/runs/41679501279).

**Реальный benchmark принятых самостоятельных Tasks, полноты понимания деятельности, возможности независимого source corroboration, пользовательской пользы и сквозного Task→Result пока `NOT_MEASURED/NOT_RUN`.** Не повышать статус исходя из числа успешных Python tests. Нельзя выдавать second publication of same VINST observations за независимую проверку события.

## 4. Новое направление после BPI13-03

Документирована исследовательская модель:

`UNDEFINED_PROBLEM / PUBLISHED_OWNER_QUESTION → PROPOSED_INVESTIGATION → ELIGIBLE_EVIDENCE_SCOPE → TARGETED_DATA_GAP → TESTABLE_HYPOTHESIS / ABSTAIN → TASK_RESEARCH_AND_QUALIFICATION → CONTEXT_COMPILER → EXISTING_EXECUTOR → RESULT`.

Эта модель связывает Activity Research с TASK-EXP-01, Cross-Lab, агентным каталогом и Person Agent, но не меняет owners. Для явно понятной Task весь исследовательский путь не обязателен.

### Следующий практический этап, по приоритету

1. **CORPUS-02 — data applicability.** Проверить официальный источник BPI Challenge 2013 `Incidents`, его лицензию/полномочия, доступность и полноту нужных организационных полей. Если есть разрешённый источник, выполнить exact pinned ingest в существующий U1 и сравнить способность анализировать вопросы с open-problems-only case. Если нет — `SOURCE_ACCESS_HOLD`, не заменять архив непроверенной копией, сохраняя original 4TU identity `NOT_VERIFIED`.
2. **SOURCE-CONTRADICTION-01.** Исследовать реальные независимые внешние свидетельства к отдельному событию/процессу (второй независимый log или документ с доказанной источниковой самостоятельностью); отличать совпадение двух публикаций от наблюдений из независимых систем. Без независимых свидетельств — сохранять `UNKNOWN`.
3. **TASK-HYPOTHESES-01.** Сравнить открытое выведение possible investigation Tasks и prior-based suggestions из существующего Task Catalog на равных данных, отделяя `proposed investigation`, `qualified TaskType`, `accepted user Task`. Строгие baselines: direct source reading/regex, current U1, existing Task Discovery. Не подгонять E5 под развивающиеся данные.
4. **FIELD-EVAL-01.** Создать отдельный допущенный independent human gold и оценить false confident claim rate, correct abstention, evidence sufficiency, source leakage, effort/cost; уже использованные BPI/PET/ATUS не объявлять внешним held-out.
5. **Product handoff** только при доказанной полезности: один результат в существующем Personal Agent или предметном T2/T3 с Result/readback/restart, без новой программы.

**Ограничения:** владельцу не предлагать вручную заполнять подробные анкеты для квалификации общей технологии; использовать разрешённые реальные корпуса и синтетические контрпримеры в контролируемой роли. Не перепубликовывать исходные тексты и медицинские/персональные данные в открытом CI, не делать новый provenance/permission engine. Github Actions в public `knowledge` допускаются для адресных открытых тестов.

## 5. Первое действие в новом чате

В проекте **«Система знаний»** начать с:
`Faust-S/knowledge@work/2026-11-03-unified-task-migration` и
`Faust-S/IWXA-knowledge@work/2026-11-03-unified-task-migration`.

Прочитать оба `AGENTS.md`, публичный `research/activity-research/README.md`, данный handoff, private `docs/09_CROSSLAB_MIGRATION_GOVERNANCE_2026-11-03_RU.md`, публичные документы `BPI13_OWNER_QUESTIONS_AUDIT_2026-11-04_RU.md` / `BPI13_MUTATION_STRESS_2026-11-04_RU.md`, смежные `research/task-discovery/README_RU.md` и `research/cross-lab/README.md`. Свежие SHA обязательно считать заново. Не переносить проект созданием дубликатов; развивать текущие рабочие ветки.

Следующее содержательное действие: реальная независимая проверка пригодности data для одного владельческого вопроса (приоритет incidents log), затем измерение возможностей/ошибок `source-first vs prior-first`, если источники достаточны. На каждом шаге фиксировать denominator и provenance, не подменять evidence синтетикой и не принимать Task без критерия результата и разрешённых оснований.

Этот файл — **передача состояния и критериев**, не свидетельство завершения продуктовой системы и не самовольное создание нового ChatGPT проекта.
