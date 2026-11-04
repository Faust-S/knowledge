# TASK-EXP-01 — проверка двух отдельных синтетических аккаунтов Label Studio

Дата: 2026-11-04. Это **инженерная проверка HTTP-пути**, не независимая человеческая разметка.

## Что уже проверено

Ранее настоящий Label Studio 1.23.2 (GitHub Actions [41717492140](https://github.com/Faust-S/knowledge/actions/runs/41717492140)) прошёл создание 2 проектов, импорт 8+8 синтетических источников, API-запись 16 синтетических аннотаций и отказ в экспорте двух обзоров одного аккаунта. Исправлен лимит 50 символов для заголовка проекта.

В `live_labelstudio_smoke.py` теперь добавлен **необязательный режим** второго локального синтетического аккаунта. Его выбор однозначен: `LABEL_STUDIO_SECOND_API_KEY` (legacy CI token). Проверяется другой `/api/current-user/whoami` ID; второй аккаунт записывает 8 из 16 аннотаций; затем вызывается существующий `export_reviewed_projects` и проверяются оба локальных JSON. В этой ветке режим двух аккаунтов пока покрыт offline mocked HTTP-тестами, **не настоящим сервером**. Старый одноаккаунтный реальный сценарий не изменён.

Для реального запуска двух пользователей нужно в локальном **временном** Label Studio создать два независимых тестовых аккаунта с правом аннотировать общие проекты и настроить их legacy tokens. Токены передавать только локальным окружением; не коммитить, не писать в CI artifacts. Пример (запустить на машине с доступным локальным Label Studio):

```sh
LABEL_STUDIO_URL=http://127.0.0.1:8080 \
LABEL_STUDIO_API_KEY=LOCAL_SYNTHETIC_ACCOUNT_A_TOKEN \
LABEL_STUDIO_SECOND_API_KEY=LOCAL_SYNTHETIC_ACCOUNT_B_TOKEN \
python research/task-discovery/live_labelstudio_smoke.py
```

Успех означает `ACTUAL_LABEL_STUDIO_HTTP_ROUNDTRIP_PASS` и `two_synthetic_accounts_export_passed=true`, а также `human_task_gold=false`. Отрицательное условие одинаковых ID даёт `LIVE_SYNTHETIC_REVIEWER_ACCOUNTS_NOT_DISTINCT`. Существующий публичный CI с **одним** аккаунтом продолжает демонстрировать отказ выдавать его за двух людей.

## Подтверждение M3a: нативные два аккаунта (04.11.2026)

**M3a ENGINEERING PASS** на точной ревизии `6e2806273704a1091dabb24a53afb4f0f5a6bd5b`: [GitHub Actions run 41812516645](https://github.com/Faust-S/knowledge/actions/runs/41812516645) — `completed/success`, все шаги настоящего Label Studio 1.23.2 PASS. В disposable Docker создан второй синтетический пользователь через штатный API, его отдельный legacy token считан только внутри контейнера, обе HTTP-сессии подтверждены по различным `whoami.id` и одной организации. В штатном smoke записаны 8+8 API-аннотаций, выполнены два независимых по аккаунту JSON-экспорта в локальном временном каталоге, после чего файлы удалены. Отдельный прежний одноаккаунтный сценарий сохранил корректный отказ при одинаковом reviewer ID.

Проверенный receipt: `synthetic_projects=2`, `synthetic_sources_per_project=8`, `api_created_coverage_annotations=16`, `two_synthetic_accounts_export_passed=true`, `independent_human_review_completed=false`, `owner_exact_xml_exercised=false`, `human_task_gold=false`, `task_precision/recall/f1=null`. Credentials, reviewer IDs, исходные тексты и полные экспорты не публиковались в artifacts.

Первый пробный коммит `c4c99a94...` завершился ошибкой Python line continuation в YAML inline script; исправлено коммитом `6e280627...` и подтверждено вторым нативным прогоном. Этот технический PASS **не заменяет** human source-first annotation, независимость мыслей или gold. Следующий этап — M3b, назначение двух реальных рецензентов в owner-local Label Studio с исходной frozen TASK-EXP-01 формой, последующая штатная сверка и человеческий adjudication. Не использовать synthetic exports как human gold.

## M3b — проверка фактической изоляции рецензентов (04.11.2026)

**На настоящем Label Studio 1.23.2 обнаружен блокер слепого эксперимента.** [Actions 41818715004](https://github.com/Faust-S/knowledge/actions/runs/41818715004), commit `0d4aea1204eea073b8f6964c33c6fa73817b193d` — `completed/success` для самого диагностического теста. Из второго синтетического аккаунта, принадлежащего той же организации, через существующий `/api/projects/{id}/export` удалось прочитать **восемь записей с аннотациями первого аккаунта** в другом проекте. Машинный receipt: `M3_SAME_ORGANIZATION_REVIEW_A_VISIBLE_TO_REVIEW_B=true`, `M3_PROJECT_ISOLATION_CONTRACT_QUALIFIED=false`, `M3_HUMAN_INDEPENDENCE_PROVEN=false`. Диагностический PASS не есть PASS изоляции.

Следовательно, схема `2 проекта + 2 аккаунта в одной организации` **не является достаточной для blind review**, даже при разных `completed_by`. Применять её как научно независимую разметку нельзя. Уровни различать: `TWO_ACCOUNT_HTTP=PASS`, `BLIND_PROJECT_ISOLATION=FAIL`, `INDEPENDENT_HUMAN_GOLD=NOT_MEASURED`. Ранее созданные синтетические экспорты не становятся gold.

**Предпочтительный owner-local M3b:** два раздельных Label Studio instance/database/organization контура, без доступа рецензента к чужой инстанции и выгрузке, с одинаковым pinned исходным пакетом и оригинальной owner XML. На каждом контуре использовать существующие `--reviewer-slots 1 --create-local-projects` и `--export-single-reviewed-project`, затем передать два закрытых файла исходному owner bridge и проверить две **различимые** исходные `completed_by` идентичности (числа из независимых БД могут совпасть; не переписывать их без согласованного owner-контракта). Провести явные негативные проверки cross-access, аудит назначений, отдельных участников и blinding. Если два isolated instance невозможны, использовать последовательные сессии с реальным отзывом доступов, но **не** объявлять слепую независимость до проверки отсутствия встречного доступа. Раздельные проекты одной организации без изоляции запрещены как достаточное основание M3b.

Операционная слепота, отсутствие обмена между людьми, исходная точная XML, независимый adjudicator и проверяемые source bytes всё равно требуют человеческого подтверждения. Никаких автоматических T1 Acceptance, E4 Approval, E5 gold, Task F1.

## Что требуется для M3

1. **Реальный двухаккаунтный HTTP-прогон** в временном локальном Label Studio с разрешённым синтетическим набором (без публикации секретов).
2. Настоящие два независимых рецензента на 8+8 фиксированных источниках через оригинальную `TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml` в owner-local среде.
3. Штатный `task_exp_01_review_bridge.py` → `owner_review_cycle.py` → `review_effort.py`; разрешение разногласий выполняется человеком. Прямой source/regex/native U1 baseline frozen SHA `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0`.
4. Только после независимого gold оценивать task precision/recall/F1, ошибочные гипотезы, пропуски и человеко-время; E5 требует отдельный held-out по существующей предрегистрации.

Не создавать альтернативный Task Engine, Label Studio, Store, Context Compiler или автоматический T1/E4 approval.
