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

## Что требуется для M3

1. **Реальный двухаккаунтный HTTP-прогон** в временном локальном Label Studio с разрешённым синтетическим набором (без публикации секретов).
2. Настоящие два независимых рецензента на 8+8 фиксированных источниках через оригинальную `TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml` в owner-local среде.
3. Штатный `task_exp_01_review_bridge.py` → `owner_review_cycle.py` → `review_effort.py`; разрешение разногласий выполняется человеком. Прямой source/regex/native U1 baseline frozen SHA `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0`.
4. Только после независимого gold оценивать task precision/recall/F1, ошибочные гипотезы, пропуски и человеко-время; E5 требует отдельный held-out по существующей предрегистрации.

Не создавать альтернативный Task Engine, Label Studio, Store, Context Compiler или автоматический T1/E4 approval.
