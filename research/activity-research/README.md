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

## ATUS-01 — реальная дневниковая деятельность и проверка доступа (03.11.2026)

Создан [`atus_diary_replay.py`](atus_diary_replay.py): минимальный, без нового движка, адаптер официального ZIP `atusact-2025.zip` из [BLS ATUS 2025](https://www.bls.gov/tus/data/datafiles-2025.htm) в существующий pinned native `U1.EVENT_LOG_JSONL`. Корпус — публичная **самоотчётная** однодневная выборка, а не прямое наблюдение человека и не сведения о его долгосрочных целях.

Адаптер проверяет обязательные официальные поля, уникальный порядок эпизодов, целостность 1440-минутного дневного окна, точность SHA исходного ZIP (если передан expected value), ограниченный детерминированный отбор, 4 МБ U1 предел и отсутствие `TaskType`/автоматического `Result`. Для U1 применяется намеренно условная временная шкала (`2000-01-01` 04:00 UTC), маркированная как **сконструированная**, без утверждений о настоящей дате, мотивах либо причинности. Реальные идентификаторы респондентов, сырые строки и фактические события не выдаются в агрегированном receipt.

**Результат первого CI на HEAD `5e2272d6...`:** локальные тесты адаптера `6/6 PASS` и существующий PET benchmark PASS; скачивание официального BLS ZIP из стандартного GitHub-hosted runner отклонено BLS (`HTTP 403`). [Actions run 41700129135](https://github.com/Faust-S/knowledge/actions/runs/41700129135). Это **`ATUS_REAL_SOURCE_ACCESS_HOLD`**, а не FAIL доказательной модели и не `ATUS_REAL_REPLAY_PASS`. Не используем зеркала с неподтверждёнными правами и не меняем официальный источник на синтетический под видом реального.

В последующей корректировке текущего CI автоматическая загрузка BLS исключена: основные публичные PET-тесты работают независимо от отказа BLS. Дополнен тест непосредственного локального replay через **точно закреплённый оригинальный U1** на синтетическом ZIP с известным составом; это техническая интеграционная проверка, но не испытание реального ATUS.

Команда для законно скачанного локально официального ZIP:

```sh
python research/activity-research/atus_diary_replay.py --zip /path/to/atusact-2025.zip --max-diaries 8 --out /path/to/atus-receipt.json
```

Параметр `--expected-zip-sha256` служит для закрепления исходного ZIP при повторной квалификации. До независимой верификации происхождения и успешного реального прогона исходный статус — `SOURCE_ACCESS_HOLD`; статистическая репрезентативность выводов о жизни людей не квалифицирована. Продуктовая квалификация `NOT_RUN`.

**Дальше по программе:** получить официальный ZIP в доступной разрешённой среде и сверить SHA, либо перейти к корпоративным событиям из ранее лицензированного источника; не останавливать другие исследования PET/Cross-Lab/Task Discovery из-за сетевых ограничений BLS.

## BPI13-01 — реальный корпоративный журнал, source-bound native U1 (03.11.2026)

[Отчёт BPI13](BPI13_REAL_SOURCE_REPLAY_2026-11-03_RU.md) / [XES→U1 адаптер](bpi13_xes_u1_replay.py) / [7 тестов](tests/test_bpi13_xes_u1_replay.py). **Реальный CI PASS** — [Actions 41712894249](https://github.com/Faust-S/knowledge/actions/runs/41712894249), source blob pin, 819 cases/2351 registered events в публичной копии корпуса BPI Challenge 2013 open problems, 12 детерминированно отобранных случаев и **50** реальных зарегистрированных событий, переданных в исходный native pinned U1. Получены агрегированные receipt, исходные XES не перепубликованы. Исполнено 8/8 Node, 7/7 ATUS и 7/7 BPI Python tests.

**Границы:** Git blob копии подтверждает её точные байты, но ещё не идентичность официальному 4TU архиву; лицензия и права на оригинал требуют отдельной сверки. Реальный log — зарегистрированные системные события, не достоверный фрагмент всех действий сотрудника. `SYSTEM_EVENT_INGEST=PASS_SCOPED`; `OFFICIAL_ORIGIN_IDENTITY=NOT_VERIFIED`; `REAL_WORLD_ACTIVITY_RECONSTRUCTION=NOT_MEASURED`; `TASK_DISCOVERY=NOT_MEASURED`; `E5=NOT_RUN`.

Следующая адресная работа — официальный 4TU source match и контролируемые отрицательные контрпримеры (запись задним числом, пропуск, конфликт состояния). Успех технического U1 intake не использовать вместо независимой оценки полезности обнаруженных задач.

## BPI13-02 — controlled corruption of real registered-event snapshots (04.11.2026)

[Исследовательский отчёт и границы выводов](BPI13_MUTATION_STRESS_2026-11-04_RU.md) / [стресс-тест через pinned U1](bpi13_mutation_stress.py) / [7 unit tests](tests/test_bpi13_mutation_stress.py). Реальный public CI [run 41719080479](https://github.com/Faust-S/knowledge/actions/runs/41719080479): **completed/success**; 12 cases/50 оригинальных зарегистрированных событий BPI13, 7 синтетических сценариев и повторная проверка PET/ATUS/BPI, всего 8 Node + 28 Python tests PASS. В U1 шесть сценариев получили формально допустимые log receipts (из них один не изменил исходные данные), один сценарий нарушенной уникальности `event_id` был отклонён. Пять **содержательно искажённых** вариантов были структурно допустимы; это штатная граница `REPORTED_EVENT_IN_UNVERIFIED_LOG`, а не порок semantic truth inference.

Главный результат: log-only evidence не может восстановить отсутствующее физическое действие и не доказывает правильность `case_id`, времени, activity label или истинность нового «шага». Исходная/изменённая версия различимы по checksum при наличии обеих, но без независимого источника **неизвестно**, какая соответствует фактической деятельности. `U1_FORMAT_REPLAY=PASS`, `SOURCE_SNAPSHOT_CONTRAST=RESEARCH_ENGINEERING_PASS`, `HUMAN_ACTIVITY_TRUTH=UNKNOWN`, `TASK_DISCOVERY_QUALITY=NOT_MEASURED`, `E5_NOT_RUN`.

## BPI13-03 — владельческая проблема → исследовательские задачи и границы свидетельств (04.11.2026)

[Отчёт и научная граница](BPI13_OWNER_QUESTIONS_AUDIT_2026-11-04_RU.md) / [исходники анализа](bpi13_owner_questions_audit.py) / [адресные тесты](tests/test_bpi13_owner_questions_audit.py). [Реальный GitHub Actions run 41732224986](https://github.com/Faust-S/knowledge/actions/runs/41732224986) — **PASS**: опубликованы четыре вопроса владельца BPI Challenge 2013 (источник CEUR-WS), сверены с 819 cases / 2351 registered events из публичного Open Problems mirror; 284 обычных activity-label A–B–A последовательности по timestamp, что **не** доказывает передачу задач между командами. Всего 8 Node + 40 Python tests PASS, origin самого 4TU файла всё ещё не подтверждён побайтово. Из четырёх вопросов первый прямо относится к **Incidents**, следовательно выбранный Open Problems log недостаточен.

Главный вывод — два разных источника (*постановка вопросов + журнал*) ещё не являются независимыми доказательствами нарушения либо фактически совершённой деятельности. Подтверждён только пригодный предмет исследования с явно обозначенными недостающими данными. `PUBLISHED_INVESTIGATION_GOAL=FOUND`, `CONCRETE_TASK=NOT_ACCEPTED`, `SOURCE_FIT=PARTIAL`, `REAL_WORK_CAUSALITY=UNKNOWN`, `E5=NOT_RUN`.

**Для передачи в новый чат и проект «Система знаний»** использовать [HANDOFF_NEW_CHAT_2026-11-04_RU.md](HANDOFF_NEW_CHAT_2026-11-04_RU.md); исходная архитектура и исследования остаются совместно с Task Discovery и Cross-Lab, не создавать параллельный движок.

## Чего не хватает для реального PASS

Полученных байтов ATUS/BPI/PET в этом переносе нет; full benchmark не выполнен. Нужны реальный source ingestion/replay, независимая разметка Task/не-Task, сравнение с простыми подходами, стоимость человека и вычислений. Синтетические тесты не являются проверкой человеческой деятельности, а наличие DOI/продуктового описания не означает независимого практического подтверждения.

**Проведение миграции не является изменением owner U1:** эта копия сохраняет source provenance и исследовательский смысл; переназначение владельца исходников делается после отдельной технической передачи и квалификации, не декларацией в README.
