# C12–C17 — как использовать исследование на практике

Это **не** самостоятельная программа и не встроенная функция Personal Agent.
Сейчас рабочий маршрут: исходные свидетельства → source-bound C12–C16 →
слепой план C17 → существующая Label Studio → C17 `score()` → сравнение
через действующий K05. Гипотезы задач принадлежат K03. Без человеческих меток
`HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0`.

## 1. Что можно проверить сразу, без Label Studio

В корне checkout ветки `work/2026-11-03-unified-task-migration`:

```sh
python3 research/activity-research/solve4x_cross_source_coverage.py --out /tmp/c12-research.json
python3 -m unittest discover -s research/activity-research/tests -p 'test_solve4x_c17_labelstudio_transport.py' -v
```

Первый запуск — реальный pinned публичный Solve4X, с обращением к сети
и выдачей только обезличенных агрегатов C12–C17. При недоступном
источнике или SHA drift это `HOLD`, а не нулевой результат.
Ключевые объёмы Scene 01: 23 опубликованные видеоаннотации,
17 sensor-derived событий, 43 UI записи; три baseline просмотра — 23/6/3.
Три sensor-derived эпизода — **не** три доказанных человеческих действия.
Результат удобно смотреть в `c17_published_media_window_screen` и
`c12_c16_source_bound_handoff` агрегата.

## 2. Подготовка реальных данных (только на компьютере владельца)

Понадобятся оригинальные `scene01_video_ocel.json`,
`scene01_sensors_ocel.json`, `scene01.mp4`, `ffprobe`,
локальный Label Studio и папка **вне** Git checkout для файлов оценки.
Сверенный SHA исходного MP4:
`26a7245f91e43964b4d0478033145c5032cb6e09f3a75715bfe8d387201c72ce`.
Оригинал проверен GitHub Actions 42598543512; видео в GitHub не публиковалось.

Из корня репозитория (в примере `/PRIVATE` заменяется своим приватным каталогом):

```sh
python3 research/activity-research/solve4x_c17_blind_review.py prepare \
  --video-ocel /PRIVATE/scene01_video_ocel.json \
  --sensors-ocel /PRIVATE/scene01_sensors_ocel.json \
  --out /PRIVATE/c17-packet.json
python3 research/activity-research/solve4x_zip_range_probe.py \
  --out /PRIVATE/scene01-zip-index.json
python3 research/activity-research/solve4x_c17_blind_review.py media-verify \
  --packet /PRIVATE/c17-packet.json \
  --expected-plan-sha256 FROZEN_SHA_FROM_PREPARE \
  --zip-index /PRIVATE/scene01-zip-index.json \
  --video-file /PRIVATE/scene01.mp4 \
  --assumed-scene-start 2024-03-25T08:48:23 \
  --declared-duration-seconds 392.166667 \
  --out /PRIVATE/c17-media-receipt.json
```

`FROZEN_SHA_FROM_PREPARE` — `frozen_plan_sha256`, сохранённый
**отдельно** сразу после `prepare`, до разметки.
`media-verify` подтверждает оригинальные байты, но **не**
калибровку видеокадров относительно OCEL. Опубликованное начало сцены
нельзя считать доказанной калибровкой. Перед подготовкой клипов оператор
должен вручную проверить реальную кадровую привязку и права на видео.
В противном случае продолжать эксперимент нельзя: `CLOCK_CALIBRATION=UNKNOWN`.

## 3. Label Studio — обмен без новой платформы

После подтверждения привязки кадров оператор готовит разрешённые
видеофрагменты обычным FFmpeg. Исследовательский код **не создаёт**
клипы автоматически из непроверенного временного смещения.

В существующем Label Studio создаются **отдельные проекты/сессии**
для шести ролей C17: `reference_a`, `reference_b`, `adjudicator`,
`arm_all`, `arm_literal_enter_leave`,
`arm_reed_closed_after_end_5s`.
Проектам задаётся конфигурация
[`solve4x_c17_labelstudio_config.xml`](solve4x_c17_labelstudio_config.xml).
Она содержит три понятных ответа:
«Вход или выход виден», «Вход или выход не виден»,
«Невозможно определить». Авторские метки и sensor cues
рецензенту не показываются.

Создать **приватный** JSON `/PRIVATE/media-map.json`:

```json
{
  "clip-0001": "http://127.0.0.1:8080/data/local-files/?d=clips/clip-0001.mp4",
  "clip-0002": "http://127.0.0.1:8080/data/local-files/?d=clips/clip-0002.mp4"
}
```

В настоящем файле должны быть ссылки на все 23 клипа.
URL должны обслуживаться вашим локальным Label Studio.
Приведённые URL — формат, **не готовые файлы**. Для обслуживания
локальных файлов требуется настройка Local Files в Label Studio.
Документация: https://labelstud.io/guide/tasks .

Сформировать задания, например для `reference_a`:

```sh
python3 research/activity-research/solve4x_c17_labelstudio_transport.py import \
  --packet /PRIVATE/c17-packet.json \
  --expected-plan-sha256 FROZEN_SHA_FROM_PREPARE \
  --role reference_a \
  --media-map /PRIVATE/media-map.json \
  --out /PRIVATE/reference_a-import.json
```

Импортировать `reference_a-import.json` в соответствующий проект
через Data Manager → Import. Аналогично создать пять остальных файлов
для остальных ролей; для независимости нужны разные реальные
рецензенты, а не шесть имён одного человека. По завершении из каждого
проекта выгрузить **JSON**, не JSON_MIN.
Документация: https://labelstud.io/guide/export.html .

Преобразовать экспорт в существующий C17 receipt:

```sh
python3 research/activity-research/solve4x_c17_labelstudio_transport.py receipt \
  --packet /PRIVATE/c17-packet.json \
  --expected-plan-sha256 FROZEN_SHA_FROM_PREPARE \
  --role reference_a \
  --import-file /PRIVATE/reference_a-import.json \
  --export-file /PRIVATE/reference_a-export.json \
  --out /PRIVATE/reference_a.json
```

Повторить для шести ролей. Адаптер проверяет полноту, совпадение
clip ID/URL/plan SHA, один ответ на клип, один Label Studio user ID
на роль и отсутствие predictions. Он переносит `lead_time`
как **время интерфейса**, а не как фактическое активное время
рецензента. Поле `active_seconds` остаётся `null`: его нужно
измерять отдельно, не вычислять из `lead_time`.

Объединить шесть owner-local receipt в один объект с ключами ролей,
не меняя их содержимого, затем:

```sh
python3 research/activity-research/solve4x_c17_blind_review.py score \
  --packet /PRIVATE/c17-packet.json \
  --expected-plan-sha256 FROZEN_SHA_FROM_PREPARE \
  --receipts /PRIVATE/c17-six-receipts.json \
  --out /PRIVATE/c17-aggregate.json
```

**Только агрегат** может быть передан K05 через уже существующий
`research/cross-lab/k05_c17_projection.py`.
Проверка импорта/экспорта не удостоверяет личности людей, факта просмотра,
достоверности калибровки, независимости их заключений или human gold.
Значения `HUMAN_GOLD=NOT_MEASURED`, `TASK_ACCEPTED=0` не повышаются
автоматически. Для признания независимой оценки нужна отдельная
owner-local квалификация исходного видео, рецензентов и их решений.

## 4. Где это увидит обычный пользователь IWXA?

Пока **не в интерфейсе Personal Agent**. K03 уже имеет
`modules/k03-activity-task-discovery/solve4x_activity_projection.py`,
который возвращает `CLARIFICATION_REQUIRED` и 0 автоматически
принятых задач. K05 уже имеет
`research/cross-lab/k05_c17_projection.py`, сравнивающий
существующие три baseline без фиктивного human gold.

Интеграция с Personal Agent — отдельная consumer-side работа:
разрешённый источник → K03 гипотеза → вопрос человеку →
принятая Task → существующее исполнение Agent/Result.
C12–C17 не создают собственный Task Engine, Review Platform или Runtime.
