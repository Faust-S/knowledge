# TASK-EXP-01 — M3: раздельная человеческая разметка в Label Studio

**Текущий статус:** два изолированных экземпляра Label Studio 1.23.2, раздельная передача источников и экспорт проверены на синтетическом HTTP-сценарии. **Независимых человеческих оценок нет; M3 и adjudication PENDING; precision/recall/F1 NOT_MEASURED.**

## Граница изоляции

Label Studio Community Edition в одной организации позволяет видеть чужие проекты; два проекта на одном сервере не обеспечивают слепоту. Поэтому владелец использует **два независимо доступных экземпляра с отдельными базами данных и отдельными реальными рецензентами**. Режимы CLI `--reviewer-slots 2` и `--export-reviewed-projects` заблокированы для человеческого M3 (соответственно `M3_TWO_PROJECTS_IN_ONE_CE_NOT_BLIND` и `M3_SAME_SERVER_PAIRED_EXPORT_NOT_BLIND`). Соответствующие Python-функции сохранены **только для синтетических транспортных тестов**, а не как путь реальной разметки. Функция `--export-single-reviewed-project` остаётся производственным маршрутом.

## Последовательность в разрешённом owner-local окружении

1. Из исходного `Faust-S/iwxa@knowledge/2026-10-02-system-atlas` получить **ровно восемь оригинальных источников** существующей командой `python -m engine.research.task_exp_01_real_slice --restricted-output /PRIVATE/e5-envelope.json --restricted-import-output /PRIVATE/labelstudio-import.json --restricted-method-output /PRIVATE/u1-method-spans.json --confirm-local-source-review`. Повторно проверить SHA каждого источника; приватные выходные файлы хранить вне Git checkout.
2. Использовать исходный `knowledge/task-catalog/engine/research/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml`, а **не** общий E5 XML. Проверить его существующим `review_form_contract.py`.
3. Создать **по одному** проекту на экземплярах A и B, каждый раз задавая свой `LABEL_STUDIO_API_KEY` локально и запуская из публичного checkout:

   ```sh
   python research/task-discovery/labelstudio_project_setup.py \
     --tasks /PRIVATE/labelstudio-import.json \
     --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
     --url http://127.0.0.1:8080 --create-local-projects --confirm-local-import
   ```

   Для экземпляра B использовать его локальный URL/порт и другой токен; фактический ID проекта сохранить из квитанции.
4. **До разметки** выполнить `--preflight-isolated-reviewers` с `--project-id`, `--other-url`, `--other-project-id` и токенами `LABEL_STUDIO_API_KEY`, `LABEL_STUDIO_SECOND_API_KEY`. Проверяются 8/8 неизменённых первичных источников в каждом проекте, неизменные XML, отсутствие аннотаций/предсказаний и отказ перекрёстного API-доступа. Это **техническая** проверка, а не независимое удостоверение реальных людей/оборудования.
5. Два независимых специалиста лично размечают **каждый 8/8** исходных документов по исходной форме без U1/regex подсказок. `INDEPENDENT_TASK` требует цель, проверяемый результат и критерий принятия; для каждого источника нужен окончательный `review_coverage`. `REVIEW_INCOMPLETE` нельзя экспортировать.
6. Каждый рецензент в **своём** экземпляре запускает однопроектный экспорт:

   ```sh
   python research/task-discovery/labelstudio_project_setup.py \
     --tasks /PRIVATE/labelstudio-import.json \
     --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
     --url http://127.0.0.1:8080 --export-single-reviewed-project \
     --project-id ACTUAL_ID --review-out /PRIVATE/review-a.json
   ```

   Для B используйте другой `review-b.json`. Экспорт проверяет соответствие текущего authenticated user автору аннотаций, но сам по себе не удостоверяет независимость людей.
7. Передать **два неизменённых** JSON в существующий `task_exp_01_review_bridge.py` через `owner_review_cycle.py`, затем сохранить отдельные ответы и разногласия. Независимый adjudication выполняет эксперт, а не алгоритм. После этого — отдельные предметные метрики U1/regex/прямого чтения и фактические затраты.

## Проверка прогресса без экспорта человеческих данных

Добавлен необязательный **read-only** режим `--review-progress` существующего `labelstudio_project_setup.py`. Он проверяет актуальную XML-форму, неизменность восьми исходных документов, авторство текущей учётной записи и отсутствие предсказаний/дублирующих аннотаций, после чего возвращает **только три счётчика**: без аннотации, с незавершённой разметкой, с финальным `review_coverage`. Никакие тексты источников, точечные ответы, список SHA или авторские ID не выводятся.

Для каждого отдельного экземпляра после начала человеческой разметки:

```sh
python research/task-discovery/labelstudio_project_setup.py \
  --tasks /PRIVATE/labelstudio-import.json \
  --owner-label-config /PRIVATE/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml \
  --url http://127.0.0.1:8080 --project-id ACTUAL_ID --review-progress
```

Для второго экземпляра используйте его URL и локальный `LABEL_STUDIO_API_KEY`. Квитанция `REVIEW_COVERAGE_PARTIAL_NOT_GOLD` или `REVIEW_FINAL_COVERAGE_RECORDED_NOT_GOLD` **не удостоверяет правильность Task-разметки**, отсутствие человеческой зависимости, пригодность смысловых полей или экспертное согласие. Даже при `sources_with_final_coverage=8` необходимо отдельно выполнить `--export-single-reviewed-project` и исходный Review Bridge, затем независимый adjudication. При изменении источника, формы, автора или неоднозначных аннотациях возвращается `HOLD`.

Семь локальных синтетических тестов функций контроля дали PASS. Опубликованная реализация: [commit 7cf0c89f](https://github.com/Faust-S/knowledge/commit/7cf0c89fee7a6f45f4f99a6804ac8cb0b6c164ae); [public source-first Actions 41866169429](https://github.com/Faust-S/knowledge/actions/runs/41866169429), [native Label Studio 41866169403](https://github.com/Faust-S/knowledge/actions/runs/41866169403) — **QUEUED** на момент записи, интегрированный PASS ещё не подтверждён.

## Зафиксированные границы

- Публичный CI может проверять только синтетический транспорт, никогда не квалифицирует человеческий gold. Не публиковать исходные тексты, аннотации, токены или adjudication.
- Совпадение цифровых `completed_by` на разных экземплярах приводит к отказу исходного Bridge; не редактировать эти ID вручную. Оформить реальные учётные записи до разметки.
- `annotations.lead_time` — время, сообщаемое Label Studio, которое может включать паузы, а не чистое активное время специалиста.
- Frozen pre-gold SHA-256 `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0` не изменять; восемь exploratory issues не заменяют формальный held-out E5.
