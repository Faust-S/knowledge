# TASK-EXP-01: публичное source-first воспроизведение

Это **первый исполняемый переносимый эксперимент** из IWXA Task Discovery, а не второй U1 / Task Engine / E5. Исходный owner — `Faust-S/iwxa@knowledge/2026-10-02-system-atlas`, исходный манифест `knowledge/task-catalog/engine/research/task_exp_01_public_issue_sources.json`, Git blob `4ecaa74522ba1c3fa4e8851e877200c7767ad0de`. Здесь тот же манифест опубликован **побайтово без изменений** (включает только metadata, URL и контрольные суммы; не содержит issue bodies или результатов рецензентов).

## Запуск

В корне проекта:

```sh
python -m unittest discover -s research/task-discovery -p 'test_*.py' -v
python research/task-discovery/source_first_baseline.py
python research/task-discovery/paired_pinned_u1.py
```

Для offline-режима доступные исследователю оригинальные тексты должны лежать **вне Git checkout** в разрешённой директории `--input-dir /PRIVATE/issue-projections`; имя `owner__repo__NUMBER.txt`. Точная версия — UTF-8 `title + "\n" + body + "\n"`, сверяется с pinned SHA-256, включая тело. Если issue изменён — честный `HOLD`, не подмена нового текста историческим.

Фиксированный baseline ищет только общие лексические сигналы **в заголовке**; отсутствие сигнала не исключает документ из восьми. Выход — ссылки/хеши/байтовые смещения/счётчики, без исходных текстов и меток. Он не утверждает, что найденная фраза — человеческая задача. Для сравнения с настоящим U1, обучаемыми моделями и смысловой композицией требуется отдельно исполняемый owner-контракт. В публичный runner **не** загружается приватный checkout по PAT, deploy key или секретному токену.

## Приёмка и границы

- Локальные offline тесты проверяют структуру восьми источников, SHA fail-closed, UTF-8 координаты, сохранение cue-silent sources, неизменность результата без человеческих меток.
- Native public Actions на реальных источниках — отдельный статус после фактического workflow run. Если GitHub API rate limit или редакция изменена — `HOLD`, не `PASS`.
- Независимая разметка двумя людьми, adjudication, precision/recall/F1 и human time — **NOT_MEASURED**.
- Это **разработческая exploratory** выборка, а не самостоятельный E5 held-out gold; публичность issue не является разрешением на публикацию исходного текста в нашем GitHub.
- Существующий `task_exp_01_review_bridge.py` и Label Studio остаются у owner; человеческие экспорты не публиковать.
- Перенос исходников U1/E1–E4 и изменение ownership **не выполнялись**.

Следующая содержательная операция — получить настоящий public replay по всем восьми источникам, затем сопоставить версионированные source-bound сигналы с независимой разметкой при сохранении единственного U1 owner.
## Подтверждённый парный U1 / regex

Новый `paired_pinned_u1.py` выполняет оба метода на тех же восьми
оригинальных source bytes и использует **уже существующую**
`research/cross-lab/pinned_owner.py` + `replay.u1_claim`.
Версионированный U1 git blob `eb15aec5ba1a749c29d7c40a868127e1a384b6bf`
**не** становится новой реализацией или владельцем в TASK-EXP-01.

Фактический public run:
https://github.com/Faust-S/knowledge/actions/runs/41667026355:
`7/7` native offline PASS, original hashes `8/8`, U1 `14` lexical cues
в `3/8`, title regex `5` cues в `3/8`;
пересечение cue-bearing sources `1`, объединение `5`,
три не дали сигнала ни одного метода и **сохранены**.
Значения — инженерные сигналы, не человеческие Task.
Независимая expert gold, разногласия, task precision/recall/F1 и
человеко-время остаются `PENDING/NOT_MEASURED`.


## M3 — owner-local запуск двух независимых проектов Label Studio

Новый `labelstudio_project_setup.py` — исключительно адаптер к **уже существующему**
Label Studio (не новый аннотатор и не новый E5). Он принимает JSON, прошедший
проверку исходного `Faust-S/iwxa` через `task_exp_01_labelstudio_import.py`,
а также **оригинальный** конфигурационный файл
`knowledge/task-catalog/engine/research/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml`
(Git blob `7922b634b145bc064a33f95d04c058d3c5da18f6`).
Не использовать сокращённую базовую `E5_LABEL_STUDIO_SOURCE_FIRST.xml`:
она не содержит полей `goal/expected_result/acceptance_criterion`.

Пример для разрешённой owner-local машины с работающим Label Studio
на `http://127.0.0.1:8080` (пути `/PRIVATE` — иллюстрация, не путь checkout):

```sh
# Предварительно owner iwxa создаёт /PRIVATE/labelstudio-import.json
# с помощью существующего task_exp_01_real_slice.py.
python research/task-discovery/labelstudio_project_setup.py \
  --tasks /PRIVATE/labelstudio-import.json \
  --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml

# API-ключ задаётся только локально в окружении; в GitHub CI его не хранить.
python research/task-discovery/labelstudio_project_setup.py \
  --tasks /PRIVATE/labelstudio-import.json \
  --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
  --url http://127.0.0.1:8080 \
  --reviewer-slots 2 \
  --create-local-projects --confirm-local-import
```

Операция создаёт два **раздельных** пустых по аннотациям проекта с одинаковыми
8 оригинальными источниками, сравнивает каждую импортированную запись через
Label Studio JSON export/readback с исходным владельческим пакетом. Не
пропускает предсказания U1 и regex к рецензентам. При частичной ошибке выводит
ID уже созданных проектов для ручного восстановления; сама их не удаляет.
Назначение действительно независимых рецензентов и изоляцию доступа
организует оператор; два слота **не доказывают** человеческую независимость.

Далее каждый человек независимо размечает все 8 текстов; сведения о времени
фиксируются в разрешённом локальном контуре отдельно и не выводятся из
синтетических тестов. Раздельные экспорты передаются в **исходный**
`task_exp_01_review_bridge.py` (owner `Faust-S/iwxa`) для сохранения
расхождений. Для согласования требуется самостоятельное экспертное решение.
Настоящий двупользовательский браузерный запуск в owner-local Label Studio
пока **PENDING**. Нет gold, нет task precision/recall/F1, нет human review time.

Инженерные проверки транспортного адаптера: 5 offline тестов с локальным
HTTP-сервером (имитатор Label Studio API), включая два проекта/8+8 readback,
отказ при изменённых данных и обработку частичного импорта. Эти тесты не
подменяют реальную пользовательскую приёмку.

## M3 — реальный Docker Label Studio 1.23.2, API qualification (03.11.2026)

Настоящий Label Studio `heartexlabs/label-studio:1.23.2`, запущенный в
публичном GitHub Actions, выполнил синтетический сквозной API-цикл:
https://github.com/Faust-S/knowledge/actions/runs/41717492140 — **SUCCESS**,
commit `acc52a37e643d1695936f7af87d4be409d7f1143`.
Созданы **2 настоящих проекта**, импортированы и считаны обратно
**8+8** синтетических заданий, сохранены **16 API-аннотаций**.
Подтверждено правильное отклонение двух экспортов, когда все
аннотации созданы одной и той же учётной записью:
`same_user_export_refused=true`.

Тест выявил и исправил **реальный баг M3**: исходное название проекта
нарушало ограничение Label Studio в 50 символов. Исправление в
`labelstudio_project_setup.py`, коммит
`f13269e2e5205b27bd54f5be14befbc2cff05d6f`.
Новая адресная регрессия закрепляет ограничение 50 символов.
Существующий адаптер работает с локальным сервером, а не создаёт
второй Label Studio или новый Task Engine.

**Объём доказательства:** транспортный HTTP-маршрут на реально работающей
Label Studio 1.23.2, **не** браузерное прохождение UI, **не** запуск
точной owner XML-формы, **не** два человеческих рецензента. Smoke
использовал специально созданные синтетические данные/форму, не
включал реальные восемь issue bodies и не писал их в public CI.
Оригинальная специализированная owner XML проверяется отдельным
`review_form_contract.py` в owner-local окружении.
`HUMAN_TASK_GOLD=NOT_MEASURED`;
`TASK_PRECISION_RECALL_F1=NOT_MEASURED`;
`HUMAN_REVIEW_TIME=NOT_MEASURED`;
`E5_FORMAL=NOT_RUN`.

Следующий **предметный**, а не инфраструктурный этап: действительно
создать проекты с исходным XML и 8 source-first issues в разрешённом
локальном Label Studio, назначить двух независимых специалистов,
собрать две полные разметки с временем, сверить через исходный owner
Review Bridge и провести отдельное согласование. Никогда не подменять
их 16 synthetic API annotations.
