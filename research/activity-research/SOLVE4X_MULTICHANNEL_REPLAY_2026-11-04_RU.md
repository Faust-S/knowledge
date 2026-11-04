# Solve4X — реальный многоканальный аудит деятельности (04.11.2026)

**Цель:** проверить, можно ли реконструировать реальную деятельность человека по двум различным видам свидетельств без повторного создания Activity Engine, Task Engine, U1, Runtime, Context Compiler или Store.

**Действующий исходный код:** `solve4x_zip_range_probe.py`, `solve4x_small_member_pair.py`, `solve4x_same_case_audit.py`, `solve4x_global_itam_audit.py`, `solve4x_scene_ui_audit.py`, `solve4x_ui_ocel_time.py`. Публичный reproducible workflow: `.github/workflows/activity-solve4x-source-preflight.yml`.

## Фактические источники и ограничения

Набор: Solve4X / Business Processes in IT Asset Management Multimedia Event Log, https://doi.org/10.6084/m9.figshare.25246291. Прямая запись Figshare article 25246291; ZIP file 45865263; размер 2 814 811 460 байт; ZIP index содержит 476 записей. Оригинальный архив целиком и видео **не загружались**. Извлекались небольшие файлы через HTTP Range, с проверкой локальных ZIP-заголовков, CRC и SHA-256.

Использованные точные источники (SHA-256 распакованных оригинальных байтов):

- `global/global_ocel.json`: `ea1a46fdf3e56de5a1416e05f03bb1dacc1bcf4edacbe0a689c6f5ad2985a077`
- `scene01/scene01_ocel.json`: `5de185ada7d0e8d82e3f43929e594c31a1c52aad334197557cc7c2550d3f1f15`
- `scene01/scene01_vid.json`: `d698dc90741b359b9594cfc262887f180215d15434301a55d941e835621b5ff3`
- `scene01/scene01_ui.csv`: `653e0b52ec64c9f1629eb758091cdad5e5c3cb47d68531b2174ec0c6a6c0a1bb`
- Центральный ZIP directory: `bd47f03d561c6468d77df80ec8f920a3dd65502987440abf8a25dacaeb16c5b5`.

Исходные строки UI, содержимое полей, ID сотрудников, медиа и события не публикуются в GitHub или Actions artifacts. Фактические разрешения на коммерческое использование данных остаются HOLD: Figshare сообщает CC BY 4.0, сайт Solve4X — CC BY-NC 4.0. Данные применять только в допустимом исследовательском объёме, не переносить в коммерческий продукт без уточнения.

## Проверенные результаты

1. [GitHub Actions 41842008941](https://github.com/Faust-S/knowledge/actions/runs/41842008941): 23/23 авторских видеопроизводных действия точно совпадают **по названию и кратности** с 23 событиями из объединённого scene OCEL, имеющими маркер `ocel:vmap.end_time`. Это два зависимых представления, не 23 независимо подтверждённых физических действия.
2. [GitHub Actions 41851812838](https://github.com/Faust-S/knowledge/actions/runs/41851812838): в global OCEL 1 464 события и 86 объектов. Все 40 событий scene 01 и все 19 объектных ID сцены входят в global OCEL; **40/40 совпали по exact ID, timestamp и activity**. Из них 23 имеют `end_time`, а 17 — нет. Глобальный OCEL содержит и видео-производные события, следовательно **НЕ является независимым raw ITAM transaction log**. Нельзя объявлять 17 событий скрытой деятельностью.
3. [GitHub Actions 41852513433](https://github.com/Faust-S/knowledge/actions/runs/41852513433): исходный `scene01_ui.csv` содержит 43 строки, 26 полей, 38 уникальных значений времени. Это отдельная запись браузерного интерфейсного взаимодействия (среди полей `timestamp`, `eventType`, `context.elementType`), но она сама не доказывает физическое действие или пользовательскую Task.
4. [GitHub Actions 41853456971](https://github.com/Faust-S/knowledge/actions/runs/41853456971): первая строгая UTC-проверка остановлена — timestamp не содержит timezone offset. Во всех 43 строках UI и 40 событиях scene OCEL время **naive** (`aware=0`, `invalid=0`). Неизвестный пояс не подставлять.
5. [GitHub Actions 41853803403](https://github.com/Faust-S/knowledge/actions/runs/41853803403): выполнен **условный**, не калиброванный по внешнему времени расчёт совпадений по идентичному местному календарному времени (без подбора offset):

| Допущенное окно | UI рядом с 17 кандидатными системными событиями | Из 17 событий рядом с UI | UI рядом с 23 видеопроизводными |
|---|---:|---:|---:|
| ±1 сек | 2/43 | 2/17 | 2/43 |
| ±5 сек | 5/43 | 5/17 | 13/43 |
| ±30 сек | 27/43 | 15/17 | 43/43 |

Отношение «рядом по времени» **не является** event-level 1:1 match, доказанной общей шкалой часов или основанием для утверждений о фактической работе. Много UI-действий может попадать рядом с одним событием; для независимых precision/recall ещё нет gold. Научный статус — `TIMEZONE_ALIGNMENT_HOLD` при наличии условных агрегатов.

## Что действительно стало возможным

- Реальные цифровые источники теперь доступны выборочно через узкий read-only адаптер, без тяжёлого скачивания.
- Проверяется целостность экспортов OCEL, а неправильная интерпретация глобального OCEL как независимого ITAM log предотвращена реальным доказательством пересечения 40/40.
- На более самостоятельном канале UI обнаружены временные кандидаты для ручной/owner-local проверки 17 системных событий; программа умеет сохранять `UNKNOWN` и не подставляет пояс.
- Используются точные исходные SHA и три простых baseline: буквальные IDs, activity counts, time-window proximity. Оригинальные исходники и runtime IWXA не менялись.

## Оставшийся критерий научной квалификации

Нужно из первичной документации подтвердить единый clock domain или явно заявленный offset между UI CSV и OCEL. Затем проверить конкретные пары по timestamp и семантике операций, не использовать глобальный OCEL как независимую truth. После этого отдельная owner-local независимая оценка исследовательских гипотез через существующий Task Discovery / Label Studio. `FALSE_CONFIDENT_RATE=NOT_MEASURED`, `CORRECT_UNKNOWN_RATE=NOT_MEASURED`, `E5=NOT_RUN`, `TASK_ACCEPTED=0`, `TASK_TO_RESULT=NOT_RUN`.

Архитектурно это остаётся **исследовательским source adapter**, а не вторым Activity Engine или интеграцией в Personal Agent.


## C5 — найден исходный ITAM export (дополнение 04.11.2026)

После проверки [ZIP-индекса Actions 41861181343](https://github.com/Faust-S/knowledge/actions/runs/41861181343) установлено, что отдельный исходный журнал расположен в **`global/itam_ocel.jsonl`**, а не `global/itam_ocel.json`. Размер в ZIP: **6 692 байта compressed / 89 150 байт uncompressed**. Он не идентичен `global/global_ocel.json` (533 632 байта), для которого уже доказано объединение системных и видеопроизводных записей. На уровне ZIP метаданных найден отдельный источник, но факт его независимого происхождения ещё подлежит проверке по содержимому и документации.

В публичном `research/activity-research/solve4x_original_itam.py` реализован read-only selective HTTP Range import оригинального файла с ограничением 256 KiB, с уже имеющимися ZIP-header/CRC/size проверками, контролем JSON-framing и без экспорта event rows. Сопутствующие отрицательные тесты — `tests/test_solve4x_original_itam.py`. Первый реальный [Actions 41861619924](https://github.com/Faust-S/knowledge/actions/runs/41861619924) прошёл структурные тесты, но импорт вернул `ORIGINAL_ITAM_JSONL_HOLD / ITAM_JSONL_ROW_INVALID`: первоначальное предположение «один JSON-объект на каждой физической строке» неверно. Далее добавлены строгие варианты whole JSON / JSON array / JSONL / соседние pretty-printed JSON objects без преобразования повреждённых байтов в выдуманные записи. Поскольку расширенная версия ещё не имеет завершённой проверенной приёмки на оригинальном источнике, **`ORIGINAL_ITAM_CONTENT_QUALIFICATION=PENDING`** и `RAW_ITAM_TO_SCENE_EVENT_MATCH=NOT_MEASURED`; не объявлять C5 PASS. Первые запущенные повторные Actions находились в состоянии `queued` на момент этой записи.

До получения квалифицированного независимого исходного ITAM сохранять прежние ограничения: 23/23 и 40/40 — целостность производных представлений, а 43 UI vs 17 unmarked OCEL — только условная временная близость при неаттестованном clock domain. `TASK_ACCEPTED=0`, `HUMAN_ACTIVITY_GOLD=NOT_MEASURED`. Не использовать материал в коммерческом Runtime до разрешения лицензионного расхождения.
