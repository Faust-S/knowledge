# IWXA Cross-Lab / Task Discovery — подготовка миграции в public knowledge

Дата 03.11.2026. Статус **PREPARATION_ONLY / NO_SOURCE_OWNERSHIP_TRANSFER**.
Изменение scope репозитория НЕ означает копирования исходников или снятия старого владельца. Идти от небольшого публичного повторяемого эксперимента к измеренной предметной полезности.

## Зафиксированные точки входа (проверить live HEAD перед каждым переносом)

| Исходный owner и ветка | HEAD на обследовании | Назначение |
|---|---|---|
| `Faust-S/iwxa@research/ai-crosslab-practical-pilot` | `f7449fc5e07c8f8510e55e1f79e0d840d4b05bf9` | R1–R4 pilot, Werkzeug, открытая репликация 8 issues, handoff |
| `Faust-S/iwxa@knowledge/2026-10-02-system-atlas` | `8a456bd322670e2ca7d0bb9e19653253a13b71e4` | U1, TASK-EXP-01/E5 Label Studio и task catalog, только чтение |
| `Faust-S/knowledge@work/2026-11-03-meeting-followup-qa` | `091e9ec96f4f2aa89783aab9b0a3b256ad058b30` | Публичный каталог агентных решений; базовая ветка этой миграции |
| `Faust-S/IWXA-knowledge@work/2026-11-03-unified-task-integration` | Параллельная работа: сверить live HEAD | Сквозная архитектура и принятие интеграционных решений |

## Карта переноса по компонентам

| Компонент | Владелец сейчас | Подготовить в knowledge | Пока не переносить |
|---|---|---|---|
| `real_issue_replication.py`, `test_real_issue_replication.py`, frozen manifest и QA Cross-Lab | `iwxa/research/ai-crosslab-practical-pilot` | Адресный публичный эксперимент в `research/cross-lab/`, после сверки лицензий/публикуемости и переноса зависимостей без копирования приватного U1 | Разработческий артефакт и owner's evidence |
| Werk­zeug linked-issue replay, simple regex, source-first worklist | `iwxa` | Публичные хеши/ссылки, собственные адаптеры/тесты по мере необходимости | Чужие оригинальные тексты без подтверждённых условий |
| U1, E1–E4, Task Engine, existing Label Studio bridge | `iwxa/knowledge/task-catalog/engine` | Пинованная версия через разрешённый отдельный public source package или локальный owner-run; переиспользовать существующий API | Переписывать или клонировать второй Engine/annotator |
| R1/R2/R3/R4 и Context Compiler | `iwxa` и исходные лаборатории | Публичные интерфейсные контракты и результаты независимых A/B; только адресные открытые части после владельческой проверки | Целиком приватные лаборатории/скрытые данные |
| Агентные решения и тесты | `knowledge/catalog`, `solutions`, `tests` | Оставить по месту, не переименовывать и не ломать существующий meeting-followup QA | Присваивать `IWXA_VERIFIED` по тестам формата |
| Продуктовые Task/Graph/Result и память | `iwxa-personal-agent` | Только интеграционные контракты и разрешённые публичные тесты | Второй Core/Store/runtime/Graph |

## Исполняемая очередность и критерии

**M0 — подготовка структуры (текущая стадия):** согласовать общую схему и AGENTS/README, создать только миграционную ветку, сохранить sha и источник. `main`, owner branches, действующие агентные ветки — без записи. PASS означает лишь готовность инструкции.

**M1 — право на перенос и автономная сборка:** по каждому файлу установить автора/лицензию/секреты/экспонирование, классифицировать COPY_ALLOWED / ADAPT_ONLY / METADATA_ONLY / PRIVATE. В публичную ветку переносить только проверенный список. Публичному CI не давать доступ к приватному checkout через PAT/SSH; нет доступа — `BLOCKED_PRIVATE_DEPENDENCY`, не заявлять PASS.

**M2 — минимальный работающий public replay:** получить **один** рабочий сквозной исследовательский путь источники → существующий U1 → reviewed source-first export. Python compile, unit tests и настоящий native U1 на 8 замороженных реальных issues с byte/hash verification (если текущий API изменился — explicit HOLD); сравнение с `title regex`, прямым чтением. Изолированная rule replica не равна native U1. Публиковать только хеши, counts, метрики и квитанции. Отдельный `research/cross-lab` создавать лишь в ходе M2, когда переносится фактически исполняемый и разрешённый материал.

**M3 — независимая предметная оценка:** использовать имеющиеся `E5_LABEL_STUDIO_SOURCE_FIRST.xml` и TASK-EXP-01 bridge, owner-local Label Studio; два независимых reviewer, разногласия и adjudication. Нужны отдельно человеческие task precision/recall/F1, ложные гипотезы, пропуски, число источников/перепроверок, человеко-время, вычислительные затраты и независимый held-out протокол. 8 developer-selected issues и Werkzeug не E5 held-out. Ни один `NOT_MEASURED` не заменять нулём или PASS.

**M4 — сравнение простого и сложного:** exact search, regex и непосредственное чтение source, SHA+BFS только с подтверждённым dependency graph; затем U1 + Cross-Lab. Если качество/стоимость сложного варианта хуже или выигрыша нет — оставить простой.

**M5 — практическая передача:** только измеренно полезные адаптеры, через существующие Task/ContextProjection/AgentRuntimePort/ToolRuntime в Personal Agent. Запускаем реальный Task → Result → readback/restart, не внедряем второй Task Engine/Context Compiler/Store/Rights. По результатам owner решает, какие исходники менять/передать и что закрыть в старой ветке.

## CI и открытый репозиторий

Стандартные public GitHub Actions подходят для воспроизведения разрешённого Python/JS кода и открытых данных. Не запускать workflows, пока нет самодостаточного разрешённого исходного набора; не создавать фальшивых тестов на вторичной копии U1. Не публиковать raw Label Studio reviewer exports; отдельные независимые метки остаются owner-local.

**M0 результат:** архитектура и карта записаны; фактический перенос исходного Cross-Lab и native replay ещё PENDING. При изменении исходной ветки перечитать HEAD, оценить diff и выполнить fast-forward без force.

## Реализовано M1/M2 — публичные экспериментальные маршруты (03.11.2026)

**TASK-EXP-01 baseline:** исходный git blob `4ecaa74522ba1c3fa4e8851e877200c7767ad0de` (восемь публичных GitHub issue, только метаданные/URL/хеши) перенесён побайтово в `research/task-discovery/task_exp_01_source_metadata.json`. Исходные тексты, модели, приватные результаты Label Studio, U1 и Task Engine **не копировались** в этом поднаправлении. Добавлены самостоятельный `source_first_baseline.py`, 5 offline unit-тестов и узкий публичный workflow `.github/workflows/task-discovery-source-first.yml`.

Публикация: `ecbb5006d48c81c02231a4aaf7bcbf7b8e0e53ab`,
TREE `3273957cf6e773f801dbbdf15dab7672be947689`.
Фактическая native Ubuntu / CPython 3.13:
https://github.com/Faust-S/knowledge/actions/runs/41665922121,
`completed/success`, **5/5 tests PASS**;
**8/8 реальных исходников совпали с исходными SHA**;
заранее фиксированный простой заголовочный regex дал **5 cues в 3 источниках**,
пять без cues не исключены (8/8 source-first review coverage).
В квитанции только SHA, ссылки на источники, счётчики и UTF-8 byte offsets;
`human_task_gold=false`, P/R/F1 null; время Title Regex (не полный fetch,
не время человека) 0.111 ms в одном hosted run, не benchmark.

**Cross-Lab:** параллельный инженерный цикл опубликовал
`research/cross-lab/owner_pins/universal_evidence.py` и версионированный
нативный adapter/replay в этой **же** миграционной ветке коммитом
`c73493bfe9198cbb910efc440e03d1355df9a405`, с собственным
фиксированным корпусом из других восьми issues. Его реальный public CI
https://github.com/Faust-S/knowledge/actions/runs/41665816570
завершён `success`. Это одна pinned **копия** canonical owner-кода для
эксперимента, а не передача ownership или право на независимую переработку
U1. Перед обновлением pinned snapshot необходимы источник, exact SHA,
разрешение публикации и проверка соответствия owner.

**Важные различия:** Cross-Lab и TASK-EXP-01 имеют по восемь **разных**
первичных источников, не сводить их counts в один gold или E5.
Предыдущая owner-реплика TASK-EXP-01 зафиксировала 14 U1 lexical cues в
3/8 документах на том же TASK-EXP-01 source set; новый title-only regex
нашёл 5 cues в 3/8. Эти количества характеризуют coverage подсказок,
**не** precision/recall человеческих задач. Отдельный U1 replay
TASK-EXP-01 в публичной среде и количественное парное сопоставление
точных cue locations ещё не доказаны этим baseline workflow.

**Статусы:** `M1_METADATA_EXPORT=PASS`;
`M2_TASK_EXP_01_PUBLIC_TITLE_BASELINE=PASS_REAL_8_OF_8`;
`M2_CROSSLAB_PINNED_U1_PUBLIC_CI=PASS_SCOPED`;
`M2_TASK_EXP_01_NATIVE_U1_SAME_SOURCE_PAIR=PENDING`;
`REAL_INDEPENDENT_HUMAN_REVIEW=PENDING`;
`HUMAN_TASK_GOLD=NOT_MEASURED`;
`TASK_PRECISION_RECALL_F1=NOT_MEASURED`;
`HUMAN_REVIEW_TIME=NOT_MEASURED`;
`E5_FORMAL=NOT_RUN`; `AGENT_T3_HANDOFF=PENDING`.

**Следующий инженерный шаг:** использовать уже опубликованный pinned U1
через **его существующий** replay и выполнить один одинаковый восьми-source
TASK-EXP-01 paired run, зафиксировав source-anchored outcomes и версии.
Не создавать третий U1 или альтернативную систему разметки. Затем
двухэкспертная слепая owner-local Label Studio разметка всех восьми исходных
source-first случаев (включая cue-silent), отдельная adjudication и
precision/recall/F1 с знаменателями. Отсутствие human gold не блокирует
адресные исходные инженерные проверки, но блокирует научную квалификацию.
