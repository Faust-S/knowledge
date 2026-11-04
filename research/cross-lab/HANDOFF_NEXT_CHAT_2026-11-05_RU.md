# IWXA Cross-Lab / TASK-EXP-01 — передача в новый чат

Дата передачи: 2026-11-05. Продолжение существующего направления в проекте «Система знаний», **не** новый проект и не новый Task Engine.

## Рабочие репозитории и границы

- Публичный основной: `Faust-S/knowledge@work/2026-11-03-unified-task-migration`. Код: `research/task-discovery/`, научный Cross-Lab: `research/cross-lab/`. Параллельно активно изменяются Activity Research, Solve4X, K01/K02: **проверить HEAD/TREE перед записью**, не перезаписывать чужие коммиты.
- Закрытый интеграционный: `Faust-S/IWXA-knowledge@work/2026-11-03-unified-task-migration`; основная передача `docs/15_CROSSLAB_SYSTEM_KNOWLEDGE_HANDOFF_2026-11-04_RU.md`.
- `Faust-S/iwxa@research/ai-crosslab-practical-pilot` и `@knowledge/2026-10-02-system-atlas` — read-only владельцы исходных лабораторий, оригинального `task_exp_01_review_bridge.py`, TASK-EXP XML и U1. Не менять `main`, T0/T1, оригинальные owner-лаборатории и продуктовые репозитории.
- Архитектура: (1) человек/Problem/Goal/Task, необязательные Task Discovery/Activity Research; (2) Agent Solution **либо** model+Skills, нужные Knowledge/Context/Cross-Lab; (3) существующий runtime → Result → Human Review → Memory. Evidence и Provenance сквозные. Не создавать новый Core, Store, Rights, Annotation Platform, Context Compiler, Runtime или Task Engine.

## Последние проверенные работы

- Cross-Lab R1–R4 — исторические 45/45 PASS; сам факт не доказывает улучшение Task Discovery.
- TASK-EXP-01: замороженные 8 GitHub Issues, их SHA/UTF-8-проекции проверены **8/8**, 455 U1 RawStatements, 14 U1 review cues, 5 title-regex cues, объединение подсказок — 5/8 источников. **Ни один из этих cue не является gold/Task Acceptance.**
- Frozen method SHA: `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0`; source manifest Git blob `4ecaa74522ba1c3fa4e8851e877200c7767ad0de`; owner U1 Git blob `eb15aec5ba1a749c29d7c40a868127e1a384b6bf`. Не менять выборку/метод после наблюдения оценок.
- Label Studio 1.23.2, реальный disposable Docker: два **отдельных** контейнера и БД, 8+8 synthetic sources, 16 synthetic annotations, чужие токены отвергаются; [41888125700](https://github.com/Faust-S/knowledge/actions/runs/41888125700) SUCCESS. Оригинальная owner TASK-EXP XML и настоящие люди в синтетических CI не использовались. Два аккаунта в одной CE-организации **не** обеспечивают blind review.
- Owner-local: `labelstudio_project_setup.py` поддерживает source-first single-project import, two-instance preflight, read-only `--review-progress`, авторизованные проверяемые экспорты, строгие JSON и XML. `owner_review_cycle.py` вызывает исходный owner Review Bridge, проверяет identity/disagreements/review effort и публикует защищённые приватные файлы после успеха. Статусы результатов **NOT GOLD**.
- После adjudication: `source_cue_post_review.py` сравнивает **source-level cue presence**, а не Task prediction, с восемью вручную разрешёнными source labels. TP/FP/FN/TN, precision/recall/F1, `UNRESOLVED` отдельно; denominator-zero корректен. **Новая защита:** программный вызов `analyze` больше не принимает произвольный `method_sha`, пересчитывает canonical SHA по реальным cue координатам из snapshot и сверяет с замороженным. [41915518215](https://github.com/Faust-S/knowledge/actions/runs/41915518215) — **SUCCESS** на commit `4ca15fdfae4cf6bd3e45e774e70f81d50f71412e`; предшествующая [41901168968](https://github.com/Faust-S/knowledge/actions/runs/41901168968) SUCCESS проверила исправление случая F1=0.

## Главный блокер и следующий опыт

**Не выполнены настоящие независимые человеческие экспертизы.** `INDEPENDENT_HUMAN_REVIEW=NOT_RUN`, `ADJUDICATION=NOT_RUN`, `HUMAN_GOLD=NOT_MEASURED`, `TASK_LEVEL_PRECISION_RECALL_F1=NOT_MEASURED`, `HUMAN_ACTIVE_TIME_AND_COST=NOT_MEASURED`, `M4=HOLD`. Никаких автоматических T1 Acceptance/E4 Approval/E5 gold.

Следующий реальный опыт должен выполняться в **разрешённом owner-local контуре**:

1. Ещё раз сверить восемь исходных SHA и исходную TASK-EXP-01 специализированную XML, проверить изоляцию двух независимых Label Studio CE/BД и непересечение API-доступа.
2. Два разных реальных человека **независимо**, не видя U1/regex и чужих ответов, размечают те же 8 исходников с полями span/`INDEPENDENT_TASK`/`goal`/`expected_result`/`acceptance_criterion`/`review_coverage`.
3. Оригинальные author ID и owner-local экспорты сохраняются без переписывания; запустить существующие `--review-progress` и `--export-single-reviewed-project`, затем исходный `owner_review_cycle.py` и `task_exp_01_review_bridge.py`.
4. Третий независимый человек разрешает расхождения; задокументировать TP/FP/FN, Task-level quality, время активной работы и действительные затраты. Только после этого выполнять ограниченный `source_cue_post_review.py` и сравнивать с прямым чтением, exact search (только если метод зафиксирован до раскрытия оценок), regex; SHA+BFS — лишь при независимом подтверждении графа.
5. Только механизмы с доказанной практической пользой интегрировать в Agent 0.3 через существующие порты. Без нового общего ядра.

## Порядок работы и проверки

Начать с `AGENTS.md`, `research/cross-lab/HANDOFF_SYSTEMA_ZNANIY_2026-11-04_RU.md`, `research/task-discovery/HANDOFF_SYSTEMA_ZNANIY_2026-11-04_RU.md`, `research/activity-research/README.md` и закрытого `docs/15_CROSSLAB_SYSTEM_KNOWLEDGE_HANDOFF_2026-11-04_RU.md`; проверить свежие HEAD/TREE и diff параллельных коммитов. На открытом репозитории допустим адресный GitHub Actions, но не публиковать private sources/credentials/exports. Исходная локальная регрессия: `python -W error::ResourceWarning -m unittest discover -s research/task-discovery -p 'test_*.py' -v`. CI не подменяет human scientific acceptance. Публиковать только fast-forward с повторным чтением; Codex использовать для недоступных операций и независимой финальной приёмки.

## Текст для нового чата

«Продолжай самостоятельную научно-инженерную и практическую разработку **IWXA Cross-Lab / TASK-EXP-01** в проекте „Система знаний“. Это продолжение, не новый проект. Публичный `Faust-S/knowledge@work/2026-11-03-unified-task-migration`; закрытый `Faust-S/IWXA-knowledge@work/2026-11-03-unified-task-migration`. Сначала прочитай `research/cross-lab/HANDOFF_NEXT_CHAT_2026-11-05_RU.md`, `AGENTS.md`, действующие Task Discovery/Activity handoff и закрытый `docs/15_CROSSLAB_SYSTEM_KNOWLEDGE_HANDOFF_2026-11-04_RU.md`; получи **свежие** HEAD/TREE и учти соседние коммиты. Последний квалифицированный код проверки frozen cue координат: `4ca15fdfae4cf6bd3e45e774e70f81d50f71412e`, [Actions 41915518215](https://github.com/Faust-S/knowledge/actions/runs/41915518215) SUCCESS. Удерживай frozen 8 sources и method SHA. Приоритет: реальное owner-local independent 8×2 human review, исходный Review Bridge, adjudication, честный Task-level P/R/F1 и затраты. Без новых engines/stores/rights/annotation platform; не трогай main/T0/T1/owner labs, не считай synthetic CI human gold. Все инженерные изменения проверяй и публикуй fast-forward; Codex лишь для недоступной операции или независимой финальной приёмки. Если нет реальных человеческих меток, не выдумывай их и не повышай M4». 
