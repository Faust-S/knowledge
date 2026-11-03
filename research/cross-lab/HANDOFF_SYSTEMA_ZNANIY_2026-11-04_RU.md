# IWXA — Cross-Lab Practical Pilot / TASK-EXP-01: передача в проект «Система знаний»

**Дата:** 2026-11-04. **Состояние:** продолжение действующего проекта, не новый репозиторий. **Приоритет:** проверяемое обнаружение реальных человеческих задач, а не расширение документации или инфраструктуры.

## Единая архитектура

Три **логических** уровня, не три программы:
1. **Человек и задача:** Problem / Goal / Task / Expected Result; Task Discovery, Activity Research, U1 подключаются по необходимости. Гипотеза обнаруженной задачи не равна принятой Task или TaskType.
2. **Подготовка решения:** специализированный Agent Solution **или** обычная модель + Skills; Knowledge / Context Compiler / Cross-Lab и Plan/Graph только если нужны. Никакой обязательной мультиагентности.
3. **Исполнение и продолжение:** существующий Runtime / AgentRuntimePort / ToolRuntime / программы → Execution → Result → Review → Memory / повторное использование. Возможны возвраты к уточнению Task, Evidence, Context, Plan.

Общая семантическая основа T0/T1, Evidence, Provenance. Разные owners: нормальная пользовательская Task/Result/Store/Graph в Personal Agent; Cross-Lab — исследовательский **поставщик подсказок и проверяемых оснований**, не второй Task Engine.

## Репозитории, ветки, владельцы

- **Публичный основной инженерный** `Faust-S/knowledge@work/2026-11-03-unified-task-migration`: Cross-Lab, Task Discovery, Activity Research, библиотека специализированных агентов и воспроизводимые эксперименты. Перед новым циклом ОБЯЗАТЕЛЬНО прочесть свежие HEAD/TREE, `AGENTS.md`, README и изменения параллельных потоков. Зафиксированный проверенный код двухаккаунтного smoke: commit `f120828ee79ed18aba7115b22878afdd6f99f156`, TREE `a5df29ea6e8078169dc53e27327a813c5dcc5c33`. Не утверждать, что это текущий HEAD в будущем.
- **Приватный интеграционный** `Faust-S/IWXA-knowledge@work/2026-11-03-unified-task-migration`: решения по архитектуре, закрытые ограничения и карты владения, сводки испытаний. При первом просмотре данной передачи исходный HEAD `ae3d89b6cfda3726bf30b0ca7336f9d3174b592b`, TREE `c09a8e9c1c942cd9552bb100efb637674a69c310`. Использовать отдельный fast-forward, без перезаписи других потоков.
- **Владелец исходных лабораторий** `Faust-S/iwxa@research/ai-crosslab-practical-pilot`: HEAD `f7449fc5e07c8f8510e55e1f79e0d840d4b05bf9` / TREE `bbbfd4547ab6d622f956c233cb010a56e896ef00`; read-only, исторический handoff `architecture/foundation/experiments/ai-crosslab-pilot/HANDOFF_2026-11-03_RU.md`.
- **Центральный TASK-EXP-01** `Faust-S/iwxa@knowledge/2026-10-02-system-atlas`: HEAD `573725c5b28503f47f7e1cdd27693dce013290d6` / TREE `c5b9d272f7afb9b4b7d811b36fc951bc82feb4c9`, только чтение. Использовать существующие `task_exp_01_real_slice.py`, `task_exp_01_labelstudio_import.py`, `task_exp_01_review_bridge.py`, оригинальную форму `TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml`. Не менять T0/T1, `main` и исходные лаборатории.

## Подтверждённые практические результаты

1. **Cross-Lab R1–R4/Context Compiler:** исторически 45/45 PASS в owning checkout; проверены границы, источники, revalidation, но предметная полезность Task Discovery тогда не доказана.
2. **Публичный native U1:** [run 41665816570](https://github.com/Faust-S/knowledge/actions/runs/41665816570) PASS на 8 других public issues: 373 RawStatements, 8 lexical hints, 3/8 документов с подсказками, source-first очередь 8/8; не task-level gold.
3. **На одном корпусе TASK-EXP-01:** восемь frozen issues, SHA совпадают; 455 RawStatements, 14 native U1 cues, 5 regex title cues, пересечение документов = 1, объединение = 5/8; три документа без обоих видов подсказок **не потеряны**. Истинные задачи из этих значений НЕ следуют. Методные координаты закреплены до review контрольной суммой `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0` (pre-gold commitment; blind). См. `docs/TASK_EXP_01_PRE_GOLD_METHOD_COMMITMENT_2026-11-03_RU.md`.
4. **Интеграция реального Label Studio 1.23.2:** ранее HTTP smoke FAIL из-за предельной длины заголовка проекта; исправлено другим потоком. [Run 41717492140](https://github.com/Faust-S/knowledge/actions/runs/41717492140) PASS: Docker + авторизованный API, 2 проекта, импорт и readback 8+8 синтетических текстов, 16 API-аннотаций, корректный отказ экспорта при одном reviewer ID. Это **не реальные эксперты** и не gold.
5. **Owner-local M3:** `labelstudio_project_setup.py` умеет создавать и экспортировать два слота. `review_form_contract.py` проверяет **исходную** TASK-EXP-01 форму (в отличие от сокращённой общей E5). `review_effort.py` считает Label Studio lead_time (может включать простой) и *условную* стоимость. `owner_review_cycle.py` вызывает настоящий owner bridge + effort на одних и тех же файлах; проверяет hash drift, наличие и число разногласий. Последний его CI на [41716216013](https://github.com/Faust-S/knowledge/actions/runs/41716216013): 52/52 PASS вместе с native replay.
6. **Activity Research:** `research/activity-research/` уже в этом публичном репозитории, есть реальный PET/BPI-срез, при этом PET token Activity ≠ TaskType. См. текущий README и новые эксперименты с source drift, corruption. Не смешивать их метрики с TASK-EXP-01.
7. **Последнее расширение:** `research/task-discovery/live_labelstudio_smoke.py` поддерживает необязательный второй синтетический токен `LABEL_STUDIO_SECOND_API_KEY`; отдельный `test_live_labelstudio_two_accounts.py` проверяет два mock HTTP профиля/две записи по 8 аннотаций/два JSON-экспорта и отказ при одинаковом ID. Код `f120828ee79ed18aba7115b22878afdd6f99f156`, README `research/task-discovery/LIVE_TWO_ACCOUNT_SMOKE_RU.md`. **Настоящий HTTP-прогон с двумя разными аккаунтами НЕ подтверждён**; одноаккаунтный Docker workflow запускается отдельно по push. Не переносить тестовые аккаунты/токены в Git.

## Главный незакрытый научный вопрос (M3)

**Независимая human Task precision / recall / F1, ложные и пропущенные задачи, реальная нагрузка человека и стоимость — NOT_MEASURED.** Ни прежний Werkzeug, ни те же восемь issues TASK-EXP-01, ни новая разработческая выборка не являются новым независимым E5 held-out. Никакого автоматического Task, T1 Acceptance, E4 Approval или E5 gold.

Не создавать второй Label Studio, Task Engine, Context Compiler, Rights, Store, runtime; не создавать второй scorer до human gold. Сильные простые baseline: прямое чтение, exact search, regex; SHA+BFS только для источников с независимо подтверждённым графом зависимостей. Если сложный Cross-Lab не доказывает преимущество — оставить простой путь.

## План следующих проверяемых вех

**M3a — закрыть позитивный HTTP-путь (инженерно):** два независимых **тестовых** аккаунта Label Studio 1.23.2, 2 проекта, readback 8+8, API-запись 8 аннотаций каждым, две отдельные owner-local выгрузки; идентификаторы разные; отсутствие копирования синтетических экспорто́в в public artifacts. На текущем этапе код и mock-тесты есть, нативный двухаккаунтный проход **PENDING**. Перед Actions проверить, не появился ли результат у параллельного потока. Не требовать отдельных GH Actions ради косметической регрессии.

**M3b — настоящие экспертные оценки:** в разрешённом owner-local Label Studio назначить двух реально независимых людей, слепые проекты, исходные 8/8 документы и полную форму TASK-EXP-01. После завершения — экспорт → штатный `task_exp_01_review_bridge.py` → `owner_review_cycle.py` → `review_effort.py`; отдельно человек разрешает разногласия. Ни `completed_by`, ни две учётные записи сами по себе не доказывают независимость мыслей.

**M3c — научное сравнение:** воспроизвести неизменный методный SHA **до просмотра** gold. Сравнить Task P/R/F1 и false/missed hypotheses по независимым меткам; отдельно сравнить время/ошибки людей при direct-source и методной помощи. Слепая разметка не равна оценке экономии труда. Для формальной E5 нужен отдельный pre-registered held-out корпус и независимые adjudicators.

**M4 — продукт только после evidence:** полезную часть подключать как разрешённые исследования в существующий Task/ContextProjection/AgentRuntimePort/Result Personal Agent; никаких вторых движков.

## Правила работы и новый проект ChatGPT

Новый проект называется **«Система знаний»**. Перенос проекта ChatGPT не переносит Git refs и не требует создания новых репозиториев. Этот handoff должен быть прикреплён/прочитан в новом чате. Сначала свежие HEAD/TREE, AGENTS, README, status всех 4 refs, последние Actions и diff; потом самостоятельная реализация и тесты. Соблюдать владельцев файлов при параллельной работе, не force-push; контроль ожиданий HEAD перед fast-forward, повторное чтение файлов и CI. GitHub Actions умеренно, публичные workflows не должны использовать PAT/SSH для чтения закрытых репозиториев. Codex — только для недоступной операции/независимой приёмки.

**Начальная задача нового чата:** проверить реальную доступность двух синтетических reviewer аккаунтов без передачи секретов; закрыть нативный положительный 8+8 экспорт или установить точный блокер, затем переходить к настоящему human review. Если наука остаётся без независимого gold, сообщать `NOT_MEASURED`, а не считать технические PASS доказательством.
