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
