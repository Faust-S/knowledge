# IWXA Knowledge & AI — открытые переиспользуемые модули

Статус: **план модульного выделения, 04.11.2026; не продуктовая квалификация**. Реализацию вести в `Faust-S/knowledge` на разрешённых исходниках и тестовых данных. Это не новая программа, не новое ядро Personal Agent, не перенос ownership закрытого `Faust-S/iwxa` или `iwxa-personal-agent`.

Канонические существующие исследования: [Task Discovery](../research/task-discovery/README_RU.md), [Activity Research](../research/activity-research/README.md), [Cross-Lab](../research/cross-lab/README.md), [Agent Solutions](../catalog/solutions), [границы](BOUNDARIES_RU.md), [правила публикации](../AGENTS.md). Идентификаторы K01–K05 стабильны в [центральной закрытой карте](https://github.com/Faust-S/iwxa/blob/knowledge/2026-10-02-system-atlas/knowledge/system/modularity/MODULE_MAP_RU.md); публичным CI закрытая карта не нужна.

## K01 — IWXA Knowledge, Memory & Context Kit

**Зачем:** независимая повторно используемая работа с человеческими знаниями и памятью: отбор релевантного контекста, связь с источниками, фиксация происхождения и актуальности, компактная проекция для конкретной задачи. Используется Agent, Atlas, Admin Center и предметными программами без создания общего хранилища данных пользователей.

**Что уже есть:** в приватном Agent — StructuredMemory, ContextCell и Human Knowledge Workspace; в `iwxa` — Context Compiler/U1; в публичном `knowledge` — исследования Evidence/Cross-Lab. Исходные bytes **не** переносятся автоматически.

**Публичные функции:** описать `KnowledgeItem` (идентификатор/тип/ссылка на источник и ревизию), `ContextRequest` (Task/профиль/ограничение объёма), `ContextProjection` (отобранные ссылки, evidence, причины включения/нехватка), `MemoryPort` (provided by host: read/query/write; не встроенная база). Функции `selectContext(request, observationPort)`, `summarizeMemory(readonlyItems, constraints)`, `traceEvidence(projection)` — названия *предлагаемых интерфейсов*, не обещание существующих API. Отбор обязан отдельно помечать наблюдаемое и предположенное.

**Не делать:** новую StructuredMemory, universal DB, аккаунты, загрузку всех документов в общий сервер, общий Context Compiler v2. Секреты и реальные личные данные остаются на стороне потребителя.

**Первый рабочий срез:** две разрешённые версии одного документа + формулировка Task; public adapter извлекает только нужные сведения и текущую ревизию; после изменения источника честно сообщает stale; два независимых host doubles читают ту же проекцию.

**Приёмка:** deterministic output на pinned input, provenance/source revision, отрицательный тест на неполный источник, тест лимита контекста, отсутствие сохранения личных данных внутри библиотеки. Отдельно пройти реальный Agent E2E после host adoption.

## K02 — IWXA Model, Tool & Skill Interoperability Kit

**Зачем:** сделать модели, функции инструментов и Skills переносимыми между продуктами. Переносимый модуль описывает **что умеет** исполнитель и как связать его с Task/Agent Solution, но не заменяет реальный runtime, ToolRuntime/AgentRuntimePort или Graph.

**Что уже есть:** приватные Agent `ModelProviderPort`, `AgentRuntimePort`, `ToolRuntime`, `OperationalSkillRuntime`, готовые адаптеры; публичные Agent Solutions и workflows в `knowledge`. Целевой продуктовый host остаётся владельцем исполнения, разрешения внешнего действия и Result.

**Публичные функции:** `ModelCapabilityDescriptor` (тип входа/выхода, стоимость/ограничение), `ToolDescriptor` (имя, input/output schema, supported/unsupported), `SkillDescriptor` (инструкция, параметры, зависимости, проверка); `describeCapabilities(provider)`, `resolveRequirements(solution, available)`, `buildInvocationPlan(task, selectedSkills)`. Для настоящих исполнителей разрешёнными отдельными адаптерами могут быть опубликованы provider bindings без Core Agent. Интерфейсы — кандидат, контракт версионируется только после проверки существующих приватных схем.

**Не делать:** второй ToolRuntime, модельный сервер, Skill Store или Graph executor; не превращать README/catalogue в якобы исполненную модель.

**Первый рабочий срез:** два mock providers с разными возможностями, один опубликованный Skill и один Agent Solution; выбор минимального достаточного исполнителя, явный unsupported, проверка входов/выходов. Далее один реальный открытый provider через разрешённый API/CLI и независимый consumer — без приватных токенов в CI.

**Приёмка:** повторяемость выбора, честные unavailable states, проверка несовместимой схемы, стоимость/latency и proof of invoke только при реальном вызове. Реальный Task/Result/restart квалифицируется в Agent.

## K03 — IWXA Activity & Task Discovery

**Зачем:** помогать обнаруживать задачи из неоднозначной потребности или деятельности; пользователь может сразу поставить ясную Task и пропустить discovery.

**Что уже есть:** `research/activity-research`, `research/task-discovery`, открытые публикации и исходные тесты; приватные U1/E1–E4, TASK-EXP-01/Task Engine имеют нынешнего владельца `iwxa`.

**Публичные функции:** `ActivityObservation`, `TaskHypothesis`, `EvidenceLink`, `ClarificationRequest`; пайплайн source → interpretation → hypotheses → independent check → human-qualified Task candidate. Все источники tagged `reported/observed/inferred/target`, hypothesis никогда не становится принятой Task без дальнейшей квалификации. Использовать pinned native U1 через разрешённый adapter, не строить его копию.

**Первый рабочий срез:** один независимый разрешённый публичный корпус, простой поиск/regex baseline и existing research method; сравнить task precision/recall, abstention и трудозатраты, если получен независимый human gold. При отсутствии независимых меток обозначить `NOT_MEASURED`.

**Приёмка:** воспроизводимость входа/хеша, обоснование каждого кандидата, negative source, отсутствие галлюцинаций событий; явная downstream передача в настоящий Task owner.

## K04 — IWXA Agent Solution & Skills Composer

**Зачем:** использовать одну каталожную запись как **готовый процесс решения задачи**, учитывающий требования к входам, методам, Skills, моделям/программам, этапам и проверяемому Result. Конкретный Agent Solution не обязателен: простая модель+Skills остаётся полноценным вариантом.

**Что уже есть:** `catalog/solutions`, `solutions/meeting-followup`, `docs/SELECTION_RU.md`; действующие Graph/AgentRuntimePort/Skills — закрытый host. Сейчас catalog entries не объявлять IWXA_VERIFIED без настоящего исполнения.

**Публичные функции:** `describeSolution(id, version)`, `matchTask(task, solutions)`, `resolveRequiredCapabilities(solution, available)`, `createHostNeutralPlan(...)`, `evaluateResultAgainstCriteria(resultObservation)`. Публиковать manifest и тесты на разрешённом открытом workflow, не новый агентный движок.

**Первый рабочий срез:** один полный meeting-followup на разрешённом документе с явными решениями/поручениями, один отказ из-за недостающего контекста, сравнение с моделью+Skills. В закрытом host после этого: Task → existing Graph/AgentRuntimePort → Result → review → restart.

**Приёмка:** original method fidelity, точный license/provenance, корректное branching, реальные выходные данные, no premature `IWXA_VERIFIED`; статический green CI недостаточен.

## K05 — IWXA Cross-Lab Evidence & Context Evaluation

**Зачем:** независимое сравнение методов отбора контекста и evidence на реальных источниках, где ясно видно, стал ли пользователь быстрее/точнее выполнять задачу. Это исследовательская и проверочная часть K01/K03, не конкурирующий Context Compiler.

**Что уже есть:** `research/cross-lab`, public issue replay, pinned source metadata, experiments и source-first tests. Приватные доказательства/Label Studio и U1 остаются у владельца.

**Публичные функции:** `EvidenceObservation` (source/version/locator/claim/state), `EvaluationCase` (вход/ожидаемая проверка/ограничения), `ComparisonResult` (baseline, tested method, scope, latency/cost, measured/unknown). Экспортировать переносимый набор разрешённых свидетельств без фальсификации readback.

**Первый рабочий срез:** реальный открытый набор issue и два baselines (чтение/точный поиск) против существующего Cross-Lab; проверить recheck после изменения source SHA, provenance и цену лишних перепроверок.

**Приёмка:** источники доступны, fixed corpus/hash, precision/recall только при gold, honest unknown, отсутствие персональных данных, один downstream Task→Result при закрытой продуктовой приёмке.

## Рабочий порядок и правила выделения

1. Начать с K01 и K02 **как public schemas/adapters/tests**, сверив имеющиеся приватные контракты без копирования кода. Затем K04 для одного законченного решения; K03/K05 развивать параллельно по независимым исследованиям.
2. Из закрытого кода извлекать только после отдельной проверки provenance/лицензии, API и тестов, затем использовать **одну общую реализацию** с тонкими host adapters. До этого публичный reference не считать drop-in replacement.
3. Соблюдать `AGENTS.md` и существующие границы knowledge. Новая общая память не хранит пользовательский workspace; новый Skill SDK не исполняет действия вместо Agent; публичный CI использует только доступные открытые источники.
4. Перед модификацией продукта подтвердить точную версию контракта и user E2E. Новая схема здесь сама не изменяет IWXA Standard.
