# C17 — независимый просмотр Solve4X: протокол и границы результатов

Дата: 05.11.2026. Статус: **программный протокол и синтетические тесты; реальная независимая разметка НЕ ПРОВЕДЕНА**.

## Что уже установлено в C15/C16

В Scene 01 оригинальный video OCEL содержит 23 авторские видеоаннотации, из них 6 буквальных `Enter room` / `Leave room`, из которых 3 отбираются рядом с подтверждёнными по raw reed переходами закрытия двери при фиксированном одностороннем окне 5 секунд. Измеренный union-footprint с контекстом ±2 секунды составляет соответственно 361.376 / 51.669 / 24.688 секунды. Это длительность выбранного материала, **не** время работы человека. Согласованность физических часов и идентичность человека не подтверждены. C17 не увеличивает количество подтверждённых человеческих действий.

## Реализованный C17

Публичный адаптер: `solve4x_c17_blind_review.py`. Тесты: `tests/test_solve4x_c17_blind_review.py`. Он переиспользует `solve4x_c16_review_footprint.py` для выбора кандидатов, не создаёт Activity Engine/Task Engine/Store/Runtime и не заменяет существующий Label Studio/Task Discovery `review_effort.py`.

1. `prepare()` создаёт **только owner-local** полный индекс 23 исходных видеоаннотаций (ключи источника, времена и классы), три варианта просмотра (23/6/3) и отдельные слепые `clip-ID` без исходных actor IDs и author activity labels. План связан SHA-256. Публично разрешён **только** агрегат `public_plan()` с тремя знаменателями и статусом `NOT_MEASURED`.
2. Для независимой reference-проверки предусмотреть два отдельных просмотра **всех 23 видеофрагментов** с тем же контекстом ±2 секунды, без сенсорных и авторских подсказок. Разногласия разрешает отдельный эксперт по исходному видео; не приравнивать adjudication к независимому объективному физическому наблюдению. В условиях ограничения времени можно выполнить одно условие и отметить остальные `NOT_MEASURED`, но тогда `score()` не публикует показатели сравнения.
3. Три независимые review-сессии используют 23 / 6 / 3 эпизода. Условия должны различаться только предъявленным набором эпизодов, одинаковыми правилами остановки секундомера, контекстом и формой ответа; порядок заданий, доступ к прошлым ответам, обучающий эффект и квалификация рецензентов контролируются оператором. Разные reviewer claims в JSON — техническая проверка, **не доказательство независимости разных людей**. В текущей версии `blind_tasks` формируются в хронологическом порядке, автоматической рандомизации нет: это ограничение протокола, которое следует контролировать до содержательного эксперимента.
4. Каждая аннотация принимает только `VISIBLE_ENTER_OR_EXIT` / `NOT_VISIBLE` / `UNKNOWN`. `UNKNOWN` остаётся отдельной категорией: отсутствие видео, невидимый переход, неоднозначность и неизвестная синхронизация не переименовываются в отсутствие действия. Временная близость не доказывает лицо, цель или направление перехода.
5. `blank_receipt()` создаёт незаполненные owner-local формы. `score()` принимает только полные, не повторяющиеся строки по правильному SHA плана; сравнивает с adjudicator на 23/23, фиксирует явно пропущенные adjudicated-visible clips, disagreement A/B, `UNKNOWN` и противоречия уверенным ответам. При отсутствующем времени возвращается `null`; не записывает синтетические секунды.

## Owner-local CLI (не в публичном runner)

Для `prepare` требуются **оригинальные неизменённые байты** Scene 01 `scene01_video_ocel.json` и `scene01_sensors_ocel.json` с заранее закреплёнными SHA-256 из существующего C12. Обе копии должны быть представлены в виде оригинальных файлов, без переформатирования JSON. Эти файлы и результирующие полные пакеты хранятся в `/PRIVATE` или другом локальном каталоге вне git checkout.

```sh
python research/activity-research/solve4x_c17_blind_review.py prepare \
  --video-ocel /PRIVATE/scene01_video_ocel.json \
  --sensors-ocel /PRIVATE/scene01_sensors_ocel.json \
  --out /PRIVATE/c17-packet.json

python research/activity-research/solve4x_c17_blind_review.py blank \
  --packet /PRIVATE/c17-packet.json \
  --expected-plan-sha256 FROZEN_PLAN_SHA_FROM_PREPARE \
  --out /PRIVATE/c17-blank-receipts.json
```

После фактического просмотра оператор собирает JSON объект с шестью ключами `reference_a`, `reference_b`, `adjudicator`, `arm_all`, `arm_literal_enter_leave`, `arm_reed_closed_after_end_5s`, используя формы и заполняя `reviewer_key`, `verdict`, `active_seconds` по отдельно остановленному секундомеру без idle, `label_studio_lead_time_seconds` по отчёту существующего Label Studio (если применялся). Токены, персональные данные и медиа остаются локально. Не включать автоматически авторские метки в разметку рецензентов.

```sh
python research/activity-research/solve4x_c17_blind_review.py score \
  --packet /PRIVATE/c17-packet.json \
  --receipts /PRIVATE/c17-reviewed-receipts.json \
  --expected-plan-sha256 FROZEN_PLAN_SHA_FROM_PREPARE \
  --out /PRIVATE/c17-aggregate.json
```

Нынешний CLI не запускает видео, не создаёт проекты Label Studio, не экспортирует настоящие записи рецензентов из платформы и не обеспечивает независимый blind review сам по себе. Это проверяемый подготовительный и вычислительный адаптер к существующему владельцу review. `lead_time` может содержать простой; `active_seconds` — самоотчёт об активной работе, не подтверждённое время внимания.

## Критерии научной оценки

- `adjudicated_visible_in_selection` и `adjudicated_visible_omitted` считают **охват эпизодов**, а не recall всех действий внутри видеопотока. Деление проводится только при ненулевом числе видимых adjudicated эпизодов.
- `confident_contradictions_vs_adjudicator` — видимые по мнению рецензента эпизоды, признанные adjudicator `NOT_VISIBLE`. Уверенные решения на `UNKNOWN` учитываются отдельно и не записываются в FP.
- `unknown_agreement_with_adjudicator` и `unknown_on_resolved_reference` показывают правильное/избыточное воздержание в рамках исходной экспертной разметки, не объективную физическую истинность.
- `descriptive_active_seconds_full_minus_focused` допустимо описывать только как разность self-reported отдельных review-сессий. Это **не причинно доказанная экономия труда**, пока не проведён контролируемый парный/crossover эксперимент с рандомизацией, исключением learning effect и сравнимой точностью.
- Без независимых экспертных оценок `HUMAN_ACTIVITY_GOLD=NOT_MEASURED`, `TASK_PRECISION=null`, `ACCEPTED_TASKS=0`, `RESULT=NOT_RUN`, `CLOCK_SYNC=NOT_VERIFIED`.

## Проверки и дальнейший этап

18 офлайн Python-тестов на синтетических данных прошли локально: неизменность выбора 23/6/3, стабильность порядка, отсутствие исходных ID/времени в агрегате, полнота покрытий, запрет duplicate/missing, SHA-привязка, `UNKNOWN`, nonfinite/overflow seconds, отсутствие human claims по умолчанию. Адресный C17-test включён в **существующий** `.github/workflows/activity-solve4x-source-preflight.yml`; тот же workflow проверяет на реальном pinned Solve4X только **план** 23/6/3, не само видео и не оценки людей.

Следующий блок: получить и проверить GitHub Actions по точной ревизии; выполнить owner-local независимый review с оригинальным доступным видео и существующим Label Studio; проверить фактическое покрытие, ложную уверенность и затраты. До этого не повышать C17 в independent human gold, Task quality или продуктовую квалификацию.


## Сохранение SHA до независимой разметки (07.11.2026)

Команда `prepare` выводит `frozen_plan_sha256`. Оператор сохраняет этот SHA **отдельно от изменяемого файла packet** до показа клипов рецензентам. Для `blank` и `score` требуется `--expected-plan-sha256`, значение берётся из заранее сохранённой записи, а не из текущего packet. Несовпадение → `C17_EXTERNAL_PLAN_PIN_MISMATCH`, некорректный SHA → `C17_EXTERNAL_PLAN_PIN_INVALID`; до исправления JSON результата не создаётся. Программные `prepare()`, `blank_receipt()` и `score()` остаются прежними, чтобы не менять контракт K05. Факт совпадения SHA **не подтверждает** видео, независимость людей, право доступа или human gold.


## C17: проверка испорченного owner-local пакета (07.11.2026)

`public_plan()`, `blank_receipt()`, `score()` и CLI теперь проверяют полную форму `owner_index` и типы участников `arms` **до** операций с ключами, индексами и множествами. Повреждённые или вложенные списки, отсутствующие ключи, произвольные структуры, дублирующийся `selected_in` и непригодные значения frozen JSON дают фиксированный `C17_PACKET_INDEX_INVALID`, `C17_PACKET_ARMS_INVALID` или `C17_FROZEN_PLAN_INVALID` без обратной трассировки личных событий. Новые отрицательные тесты также проверяют отсутствие выходного файла при таком HOLD.

**Оригинальное видео доступно как отдельный член Solve4X** `scene01/scene01.mp4`: в официальной документации указаны H.264, 30 fps, 392.166667 секунд и 87 053 127 байт. Это не один из четырёх малых исходных членов, загружаемых текущим pinned C12 replay: видео **ещё не загружено, не сверено по SHA-256, не сопоставлено покадрово с video OCEL и не просмотрено независимыми рецензентами**. На сайте указан старт сцены 2024-03-25 08:48:23; его нельзя считать подтверждённым кадровым offset без owner-local проверки видео и сопоставления с исходными временными метками. Документация: https://x2log.pages.fraunhofer.de/solve4x/dataset/scenes/scene01/ . Перед реальным C17 owner-local оператор проверяет разрешение доступа, оригинальный медиапакет, тайминг клипов и реальные исходные объекты, затем использует уже существующий Label Studio; объявлять человеческий gold по FFprobe/OCEL нельзя.

## C17 — предварительная проверка заявленных границ MP4 (07.11.2026)

Добавлен **read-only** `public_media_window_sanity(packet, assumed_scene_start=..., declared_media_duration_seconds=...)` в существующий `solve4x_c17_blind_review.py`. Данные берутся из *того же* frozen owner-local `owner_index` C17 и уже известных `arms`; не создаются клипы, плеер, новый downloader или лаборатория. Для каждого из трёх baseline рассчитывается число исходных аннотаций, для которых окно **с контекстом ±2 секунды** выходит за границы заявленной продолжительности медиазаписи при заданном предполагаемом origin. Публичный результат содержит только счётчики и максимальное превышение по границам, без source event keys, реальных timestamp или media locator.

Опубликованный источник Fraunhofer Scene 01 указывает начало `2024-03-25 08:48:23` и MP4 длительностью `392.166667` секунды; файлы сцены включают `scene01.mp4`, `scene01_video_ocel.json`. Официальные страницы: https://x2log.pages.fraunhofer.de/solve4x/dataset/scenes/scene01/ и https://x2log.pages.fraunhofer.de/solve4x/docs/data-sources/video/ . C12 `probe()` повторно использует эти **опубликованные метаданные только как условие расчёта**, а не как независимо измеренный video-to-OCEL offset. Оригинальный MP4 в данной проверке **не загружен, не хеширован, не декодирован и не просмотрен**; факт, что публикация сообщает о синхронизации двух камер по видимым часам, не является доказательством синхронизации с OCEL/сенсорами. Положительный результат про попадание клипов в границы — только техническая возможность временной выборки, **не** подтверждение содержания видео. Отрицательный результат (выход контекста за границу) — основание HOLD на автоматическую подготовку соответствующего клипа до ручного разрешения начала сцены/границ, а не разрешение автоматически обрезать отрезок.

Контракт результата: `method_window_counts.all/literal_enter_leave/reed_closed_after_end_5s`, `outside_declared_video_bounds`, `leading_context_outside_bounds`, `trailing_context_outside_bounds`, `max_leading_overhang_seconds`, `max_trailing_overhang_seconds`, `ready_for_human_review=false`, `camera_frame_to_ocel_clock_calibrated=false`, `media_video_bytes_verified=false`, `independent_human_gold=NOT_MEASURED`, `accepted_tasks=0`. Счётчики вычисляются при pinned C12 replay и остаются aggregate-only. C17 `prepare/blank_receipt/score` и действующий K05 consumer не меняются.

## C17 — owner-local MP4 verification (07.11.2026)

Действующий `solve4x_zip_range_probe.py` теперь включает имя `scene01.mp4` в **только индексную**, без скачивания видео, выборку `target_files`. Для самого MP4 добавлен узкий owner-local `verify_owner_local_media(packet, media_file, zip_index, expected_plan_sha256, assumed_scene_start, declared_video_duration_seconds, expected_media_sha256=None)` в прежний `solve4x_c17_blind_review.py`. Никакого нового медиаобработчика, хранилища, автоматического генератора клипов или Review Engine нет.

Вход: неизменный private C17 packet с заранее зафиксированным `plan_sha256`, **ранее полученный** индекс закреплённого Solve4X ZIP c `central_sha256=bd47f03d…`, отдельный **разрешённый** owner-local `scene01.mp4` и заявленные `assumed_scene_start=2024-03-25T08:48:23`, `declared_video_duration_seconds=392.166667`. Оператор вправе отдельно указать ранее независимо полученный `expected_media_sha256` — именно он нужен для строгого cryptographic-content pin, если доверенная сторона заранее зафиксировала SHA. Код не получает MP4 из сети. Локальные проверки: размер и CRC против записи оригинального центрального ZIP-каталога, подсчёт собственного SHA256 потоком с лимитом размера, проверка типа файла, опциональный expected SHA, установленный `ffprobe` (duration/video stream), сравнение длительности с явно заданной и уже существующая `public_media_window_sanity`. Отрицательные тесты отклоняют подменённый CRC/SHA/размер/index, неверную длительность, отсутствующий файл и symlink.

Запуск, **только на разрешённом приватном узле**:

```sh
python3 research/activity-research/solve4x_c17_blind_review.py media-verify \
  --packet /PRIVATE/c17-packet.json \
  --expected-plan-sha256 FROZEN_PLAN_SHA_FROM_SEPARATELY_RETAINED_RECORD \
  --zip-index /PRIVATE/solve4x-zip-range-index.json \
  --video-file /PRIVATE/scene01.mp4 \
  --assumed-scene-start 2024-03-25T08:48:23 \
  --declared-duration-seconds 392.166667 \
  --out /PRIVATE/c17-media-verify-aggregate.json
```

Опционально: `--expected-media-sha256 SHA_FROM_INDEPENDENTLY_PINNED_MEDIA_SOURCE`. Выходной JSON имеет `OWNER_LOCAL_MEDIA_CRC_SIZE_PROBE_PASS_CLOCK_UNKNOWN`, SHA и технические агрегаты **только в приватном месте**. Даже PASS размера+CRC+ffprobe — не независимая аттестация происхождения MP4, не полная кадровая привязка с OCEL, не доступ к видео, не подтверждение прав, не человеческая разметка. Из ZIP central directory SHA нельзя выводить SHA самого MP4. `media_to_ocel_clock_calibrated=false`, `ready_for_human_review=false`, `human_gold=NOT_MEASURED`, `accepted_tasks=0`. Для настоящей независимой оценки по-прежнему требуется проверенный clock mapping, показ реального видео и receipts действующей Label Studio, не авторские OCEL labels.


## C17 — защита согласованности проверяемого MP4 (07.11.2026)

Исправлен воспроизведённый race: после подсчёта SHA-256/CRC32 `ffprobe` повторно открывает файл по пути, поэтому прежняя реализация могла выдать SHA файла A и видеопараметры заменившего его файла B. Перед `ffprobe`, сразу после него и перед выдачей результата проверяются `st_dev`, `st_ino`, `st_size`, `st_mtime_ns`, `st_ctime_ns` исходного открытого файла относительно пути без следования последней символической ссылке. Изменение на любом этапе → `C17_MEDIA_SOURCE_CHANGED`, без итогового медиарезультата. Проверка не защищает от злоумышленника, способного целенаправленно подделывать все характеристики файла; необходимы изолированные owner-local исходники и независимо закреплённый SHA.

Отрицательный интеграционный тест использует **два разных синтетических MP4 с одинаковой длительностью**, подменяет имя файла атомарным `os.replace` между хешированием и FFprobe и требует `C17_MEDIA_SOURCE_CHANGED`. Синтетический тест не загружает или публикует исходное Scene 01 видео. Результаты `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0`, clock-to-OCEL remains unknown.


## Аудит полезности и исправление доверия к ZIP index (07.11.2026)

Обнаружено, что прежний `verify_owner_local_media()` доверял `target_files[*]` из переданного JSON, если `source.central_sha256` соответствовал закреплённому каталогу. Это **не проверка криптографического соответствия конкретных полей ZIP index**: можно было заменить одновременно размер/CRC в JSON и локальные медиабайты, оставив прежний заявленный central SHA. До чтения MP4 теперь сверяется вся исходная запись `scene01/scene01.mp4` с `SOLVE4X_SCENE01_MP4_PIN`.

Исходная запись независимо извлечена из двух повторных pinned ZIP-range GitHub Actions (runs `42406006127`, `42404205225`): `compressed_bytes=86978890`, `uncompressed_bytes=87053127`, `compression_method=8`, `zip_crc32=81b9100c`, `zip_local_header_offset=13914870`, `central_sha256=bd47f03d561c6468d77df80ec8f920a3dd65502987440abf8a25dacaeb16c5b5`. Повторные прогоны одного внешнего источника **не являются независимой криптографической аттестацией самого MP4**. Приложены отрицательные тесты подмены размера, CRC, сжатия, смещения и имени; подмена метаданных даёт `C17_MEDIA_MEMBER_PIN_DRIFT` / `C17_MEDIA_ZIP_MEMBER_UNRESOLVED` ещё до чтения видео. Тесты с синтетическим MP4 подменяют эталон **только внутри тестового процесса**, чтобы не ослаблять production pin.

**Стратегическое решение:** дальнейшее расширение C12–C17 без настоящего независимого видеоанализа даёт убывающую полезность. Ветка уже предоставляет K03 проверенные исследовательские cues (но не принятые Task), а K05 — три честных baseline 23/6/3 и сравнительный footprint (361.376/51.669/24.688 сек). Этими величинами нельзя обосновывать найденные действия, precision/recall, причинно измеренную экономию труда или завершённую human review. Следующий полезный результат — реальный owner-local MP4 с правами, привязка его кадров к OCEL, независимые видеоразметки через имеющийся Label Studio, отдельные reviewer effort и `UNKNOWN`; затем анализ K05. До этого оставлять `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0` и `CLOCK_CALIBRATION=UNKNOWN`. Не добавлять новый downloader, media store, Task Engine или Human Review Platform.
