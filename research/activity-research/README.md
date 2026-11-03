# IWXA Activity Discovery & Reconstruction — открытая исследовательская линия

**Статус:** мигрирован проверенный ограниченный исследовательский снимок 03.11.2026; новые продуктовые права и владение исходниками **не** переданы. [Source/byte manifest](SOURCE_MIGRATION.json) указывает точный Git commit и blob каждого источника в приватном `Faust-S/iwxa`. Не распространять эти семь файлов на другие репозитории без самостоятельной проверки происхождения.

## Цель

Исследовать, как из неясной просьбы («улучшить работу», «хочу здоровье и долголетие») и неполных, противоречивых или отсутствующих свидетельств получать **ограниченные, проверяемые модели деятельности**, гипотезы самостоятельных задач и требования к результату. Не обещать восстановление «всей реальности» и не требовать обязательную анкету в Personal Agent.

**Две единицы анализа:** частный episode и контекстная activity system (люди, роли, правила, инструменты, неформальная практика, изменения во времени). Предписанное, сообщённое, наблюдаемое в доступной области, выведенное и целевое не смешиваются. Реальный источник не всегда является ground truth. Каталог TaskType — prior, а не доказательство наличия индивидуальной задачи.

## Перенесённая работа

- [Теоретические основания](THEORETICAL_FOUNDATIONS_RU.md), [международный критический разбор](INTERNATIONAL_REVIEW_2026-10-12_RU.md) и [47 записей о научных публикациях](EVIDENCE_REGISTRY.json). Реестр содержит уровни проверки; прочтение всех полных текстов не заявлялось.
- [13 candidate corpora](DATASET_SOURCE_CANDIDATES_2026-10-23.json), включая ATUS, HETUS, BPI, O*NET, NHANES. Это **metadata, не скачанные оригиналы**. Публичный BPI 2020 имеет NC-ограничения; health cohorts могут требовать лицензии и аккредитации. Не публиковать чужие оригиналы и защищённые сведения.
- [ADP-001](pilots/ADP-001_RU.md) / [машинный case](pilots/ADP-001.json): 5 научных работ, 11 вторичных утверждений, 5 desk-cases, 8 негативных сценариев; авторские ожидаемые ответы, **не независимые измерения успеха IWXA**.
- [PET Activity benchmark](pet_activity_benchmark.mjs): read-only token/spans probe к внешнему PETv1.1, pinned upstream git blob `7b8db47fe78dc0614614708732118d38e77e030b`; полный корпус **не включён**. Benchmark работает только с точно закреплёнными байтами и семейным разделением, не определяет TaskType и не принимает задачи.

## Связь с соседними механизмами

| Сосед | Чёткий контракт | Что не делаем |
|---|---|---|
| [Task Discovery / TASK-EXP-01](../task-discovery/README_RU.md) | activity observation/candidate → proposed Task hypotheses + source anchors → независимая проверка | Автоматическое принятие TaskType; использование старых 300 как independent gold |
| [Cross-Lab R1–R4](../cross-lab/README.md) | source identity, context retrieval, history, revalidation, evidence dependencies, cost; existing pinned U1 only | Новый U1, память, индекс, Context Compiler |
| Agent Solutions / [общая архитектура](../../docs/UNIFIED_TASK_ARCHITECTURE_RU.md) | принятая конкретная Task + контекст → выбор Agent Solution **или** model+Skills → Runtime → Result | Mandatory discovery на любой запрос; agent/catalog ≠ runtime |
| `Faust-S/iwxa` canonical foundation | T0/T1 semantic composition, owner U1/E1–E4, Context Compiler, E5, scientific historical source | Переписывание foundation и оригинальных owner исходников |
| `Faust-S/IWXA-knowledge` integration map | граница public/private и решения о приёмке маршрута, закрытые зависимости | Пользовательские записи, данные исследования или скрытые токены в public CI |
| `Faust-S/iwxa-personal-agent` | задачи, Session, Goal, Graph, Human Review, сохранённые Result, Memory | Второй task/store/runtime, самовольная запись в личный контекст |
| T2 domains (например BazMed), T3 | предметная логика и средства хранить user-owned результаты в пределах разрешений | Универсальные медицинские рекомендации из survey, новый Host/Kernel |

**Cross-Lab с приёмкой Task Discovery:** исследовать группы источников с одинаковым замороженным набором и простыми baselines. Позднее экспертные E5 labels собирать только в owner-local Label Studio, с независимой разметкой. Ни контент пользователя из диалога о биохакинге, ни медицинские показатели сюда не переносились.

## Практический порядок, без анкетирования владельца

**DATA-01:** найти доступную точную редакцию ATUS, сохранить URL, лицензию/условия, исходный SHA, ограниченный anonymized projection дневников → существующий `EVENT_LOG_JSONL`/U1. Дневниковый самоотчёт остаётся самоотчётом, а не прямым наблюдением. Не создавать `download manager` ради одного корпуса.

**DATA-02:** один реальный XES/OCEL corporate corpus с подтверждёнными правами → существующий U1 через форматный минимальный адаптер → реальные фрагменты с source spans; параллельно небольшие синтетические деформации (отсутствующий шаг, задним числом внесённый статус, ложный регламент). Не маскировать синтетику под наблюдения.

**DATA-03:** PET Activity spans и сравнительные simple baselines (exact/read/regex; обучаемый метод лишь при достаточном grouped train/test). Score activity extraction отдельно от independently accepted TaskType. Метрики Tasks без человеческого gold: `NOT_MEASURED`.

**DATA-04:** отдельно проверить запросы без данных (unknown/abstention) и риск наведения типовой задачи. Только реальные внешние или независимые аннотированные источники дают сведения о переносимости на новую деятельность.

**DATA-05:** проверка route в существующем Personal Agent/Domain только после measured value, source rights и exact input contract, без нового engine. Один полезный task→verified result→readback/restart важнее общей имитации процесса.

## Проверка

Выполнить `node --test research/activity-research/tests/*.test.mjs` — структура источников, byte provenance, отсутствие ложных статусных повышений, crosslinks к соседним исследованиям. Эти unit tests — **не** полевой benchmark; не создают TaskTypes, не требуют доступ к приватному `iwxa` и не загружают данные участников.

Автозапуск через `.github/workflows/activity-research-verify.yml` ограничен изменениями этой директории в публичной миграционной ветке, не нуждается в токенах. Связанные исследования и каталог не меняются в своём функциональном коде.

## PET-01 — настоящий открытый корпус и измеряемый baseline (03.11.2026)

Публичный [PETv1.1](https://github.com/patriziobellan86/PETv1.1/tree/4bcacf71b5b191840789bb307c1a7f288a274ded) имеет конкретный `PETv1.1-entities.jsonl`, original Git blob `7b8db47fe78dc0614614708732118d38e77e030b` и размер 187158 байт. В upstream нет root LICENSE в проверенном Git tree; [карточка набора](https://huggingface.co/datasets/patriziobellan/PET) заявляет MIT; не делаем из этого вывода о праве на перепубликацию стороннего текста. **Сами исходные байты не хранятся в нашем репозитории и не публикуются в Actions artifacts.**

В имеющемся `pet_activity_benchmark.mjs` уже реализованы четыре независимые дорожки: all-token, explicit request cue, morphology cue, leave-one-document-prefix-family-out perceptron. Метрики: token-level precision/recall/F1, exact-span и macro. Данные PET характеризуют **действия, упомянутые в текстах**, а не факт исполнения действия человеком и не принятую задачу.

Новый CI запускает Node unit tests, загружает PET непосредственно с закреплённого Git SHA, проверяет исходный Git blob через существующий benchmark, измеряет family-heldout результаты и публикует только derived JSON (counts/metrics, не текст корпуса). Не выполнять `predictions` при `split=document`; любые результаты разработческого корпуса считать `EXPLORATORY`, не E5 и не самостоятельно подтверждённой полезностью. Фактический GitHub Actions [run 41679501279](https://github.com/Faust-S/knowledge/actions/runs/41679501279) на exact HEAD `43f1d17ea0bf65a3f62238226d1ea336897971f0`: `completed/success`, 8/8 Node tests PASS, публичный PET скачан и прошёл проверку точного Git blob, 45 документов и 502 gold activity spans, family-heldout perceptron **token F1 = 0.6814**, **exact span F1 = 0.6578**. Отчёт с производными метриками сохранён как Actions artifact `iwxa-pet-activity-exploratory-metrics` (ID 13252791219, retention 7 суток), исходный файл не публиковался. Статус: `PET_REAL_REPLAY=PASS_SCOPED`, `TASK_DISCOVERY_QUALITY=NOT_MEASURED`, `E5_NOT_RUN`, `REAL_WORLD_ACTIVITY_RECONSTRUCTION=NOT_MEASURED`. Это исследовательское разделение по эвристическим группам имён документов, не независимая внешняя валидация на новом корпусе.

**Следующий шаг после PET:** разделить activity span extraction, provenance-bound U1 statements и истинно обнаруженные Task hypotheses. Новый собственный scorer для Task запрещён до независимых меток; сначала сравнивать исходное предложение, прямой поиск/regex и утверждения существующего U1.

## Чего не хватает для реального PASS

Полученных байтов ATUS/BPI/PET в этом переносе нет; full benchmark не выполнен. Нужны реальный source ingestion/replay, независимая разметка Task/не-Task, сравнение с простыми подходами, стоимость человека и вычислений. Синтетические тесты не являются проверкой человеческой деятельности, а наличие DOI/продуктового описания не означает независимого практического подтверждения.

**Проведение миграции не является изменением owner U1:** эта копия сохраняет source provenance и исследовательский смысл; переназначение владельца исходников делается после отдельной технической передачи и квалификации, не декларацией в README.
