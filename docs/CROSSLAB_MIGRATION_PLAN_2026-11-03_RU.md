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
