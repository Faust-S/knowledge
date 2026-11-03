# BPI13-01: реальный журнал зарегистрированных корпоративных событий → pinned U1

**Дата:** 03.11.2026.
**Ревизия эксперимента:** `Faust-S/knowledge@b8f4007f920a12352562522d69086efc2ece18f3`.
**CI:** [run 41712894249](https://github.com/Faust-S/knowledge/actions/runs/41712894249), `completed/success`, фактический job log прочитан.
**Статус:** `REAL_REGISTERED_SYSTEM_EVENTS_ENGINEERING_REPLAY_PASS / OFFICIAL_SOURCE_BYTE_EQUIVALENCE_NOT_VERIFIED / ACTIVITY_RECONSTRUCTION_NOT_VALIDATED / TASK_DISCOVERY_NOT_MEASURED`.

## 1. Источники, происхождение и границы доказательства

[Оригинал 4TU, DOI 10.4121/uuid:3537c19d-6c64-4b1d-815d-915ab0e479da](https://doi.org/10.4121/uuid:3537c19d-6c64-4b1d-815d-915ab0e479da): данные управления открытыми проблемами Volvo IT в BPI Challenge 2013. Характеристики, опубликованные в исследовательских библиотеках Process Mining: 819 cases, 2351 events.

Доступные байты эксперимента — не прямо из 4TU: `ziaridoy20/Smart-Process-Analytics-on-Business-Process-Intelligence-Challenge@8c3dddac389eae0a222d5506f0474bc1641121d6`, файл `BPI_Challenge_2013_open_problems.xes.gz`, **Git blob** `9a001b58da47ed45d0fa5fff80815d1f444cac27`, **68697 bytes**. SHA-256 полученного с GitHub Actions файла: `71cedbecdef25255af32f73719e75f43f4cf183f1e8c08e03687b684f3174190`. Автор, версия и состав сторонней копии описаны как `THIRD_PARTY_MIRROR`; официальная 4TU копия ещё не была загружена для сравнения байтов, содержимого и прав. Лицензия публичного репозитория относится к репозиторию, а **не автоматически** к первоначальному корпусу 4TU.

Не выдавать SHA копии за подтверждение правомерности её происхождения. Source receipt имеет `rights_independent_review: NOT_PERFORMED`; учёт событий вторично подтверждает лишь ограниченные system log statements. Все необработанные журналы остаются в рабочем временном пространстве public runner, не коммитятся и не помещаются в итоговый артефакт.

## 2. Реально выполненная программа

- [XES bridge](bpi13_xes_u1_replay.py) (Python stdlib, gzip/XML, source Git blob pin, time zone enforcement, bounded input, no new engine).
- [7 адресных тестов](tests/test_bpi13_xes_u1_replay.py) на искусственных XML-сценариях: валидный случай, mismatch SHA, timezone absent, duplicate case, missing activity, DTD/entity запрещены, **полное исполнение через настоящий original pinned U1** на маленьком искусственном логе.
- Исходный `U1`: `research/cross-lab/owner_pins/universal_evidence.py`, Git blob `eb15aec5ba1a749c29d7c40a868127e1a384b6bf`, загружается через существующий `pinned_owner.py`. `U1` и его владелец не изменены.
- CI загружает оригинальный (для snapshot) XES.gz, распаковывает, валидирует структуру, выбирает 12 случаев по `SHA256("BPI13:"+case_id)`, переводит в U1 EVENT_LOG_JSONL со стабильными неперсональными ID и проверяет native U1 receipt. В отдельный публичный artifacts экспортируются только агрегаты и хеши.
- В CI также повторно проверены миграционный SHA manifest, **реальный PET** и тесты ATUS без попытки скачать BLS при их `403 SOURCE_ACCESS_HOLD`.

## 3. Снятые из реального прогона показатели

| Метрика | Результат |
|---|---:|
| Все случаи открытых проблем в исходном public mirror | 819 |
| Зарегистрированные события в исходном public mirror | 2351 |
| Детерминированно отобранные cases | 12 |
| Зарегистрированные события в U1 | 50 |
| Проверка source snapshot Git blob | PASS |
| Native U1 EVENT_LOG_JSONL read-only replay | PASS |
| Node unit tests | 8/8 PASS |
| ATUS Python synthetic/U1 tests | 7/7 PASS |
| BPI Python synthetic/U1 tests | 7/7 PASS |
| Публичный workflow | completed/success |
| Независимая оценка человеческой деятельности | NOT_MEASURED |
| Экспертный TaskType gold | NOT_PRESENT |
| Приёмка конкретных Tasks / downstream Result | NOT_RUN |

Системное действие, записанное как event, не обязательно было выполнено человеком лично либо именно в момент регистрации. Событийная последовательность по timestamp — не доказательство причинного порядка. Из открытых проблем нельзя автоматически вывести их решение, успешность или критерии субъекта.

## 4. Научные уроки и следующие испытания

**Факт 1.** Граница технического импорта частичных реальных журналов не требует нового Activity Engine: исходный U1 поддерживает события и создаёт неавторитетные `RawEvent` evidence receipts.

**Факт 2.** Одного зарегистрированного процесса недостаточно для обнаружения целей человека, критериев улучшения, off-system практик и самостоятельных TaskTypes. При отсутствии независимого подтверждения этих утверждений нужно `UNKNOWN/NOT_MEASURED`, а не ложный `PASS`.

**Факт 3.** Точный Git blob сторонней копии подтверждает только воспроизводимость нашего input. Следующая проверка — сравнить с [официальным 4TU XES.gz](https://data.4tu.nl/file/7aafbf5b-97ae-48ba-bd0a-4d973a68cd35/0647ad1a-fa73-4376-bdb4-1b253576c3a1), проверить copyright/licensing, а при несовпадении приостановить претензию на идентичность. Побайтовая идентичность gzip не гарантируется даже при эквивалентном XML (metadata/compression); после direct blob sha сначала сравнить SHA-256 распакованного XML и структурные события, с указанием методологии сравнения.

**Факт 4.** Следующий измеримый шаг — контролируемое искажение **только при уже сохранённом результате на оригинальных 2351 зарегистрированных событиях**: испортить 1 timestamp, искусственно добавить отсутствующий шаг, удалить один event, заменить `case_id`; сравнить способность U1 сохранить границы знания против фиктивной «полной карты процесса». Такие синтетические контрпримеры нельзя считать реальными наблюдениями.

**Ограничения:** 12 samples выбраны разработчиком после определения модели, поэтому не независимый held-out. Проверка источников проведена по опубликованному зеркалу и метаданным, не оригинальной 4TU канонической выгрузке. Никаких медицинских, персональных или закрытых IWXA-корпусов не использовалось.

**Следующая архитектурная передача:** результаты раскрываются публично для `research/task-discovery` и `research/cross-lab` только как scoped evidence; интеграционная запись — в `Faust-S/IWXA-knowledge`. Оригинальные Task Research Engine, T0/T1, Context Compiler и Personal Agent не изменяются.
