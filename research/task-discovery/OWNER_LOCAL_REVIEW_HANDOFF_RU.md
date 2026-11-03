# TASK-EXP-01 — проверка существующей формы перед независимой разметкой

Дата: 2026-11-03. Статус: `UI_CONTRACT_TESTED_ON_SYNTHETIC_XML / OWNER_EXACT_XML_NOT_EXECUTED / HUMAN_GOLD_PENDING`.

## Выявленный стык

Общий файл `Faust-S/iwxa/knowledge/task-catalog/engine/E5_LABEL_STUDIO_SOURCE_FIRST.xml` (Git blob `7b82dbd05b4e28c53446d863c5bb48b72245a10d`) содержит `source_text`, `taskness`, `review_coverage`, но **не** содержит полей `goal`, `expected_result`, `acceptance_criterion`.

Реальный owner-bridge `knowledge/task-catalog/engine/research/task_exp_01_review_bridge.py` (Git blob `9b56bc4624341f54799340b08872d3cfbed6e13b`) требует заполнить все три интерпретации при метке `INDEPENDENT_TASK`. Поэтому для эксперимента нужно использовать **существующую**, но иную конфигурацию `knowledge/task-catalog/engine/research/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml` (Git blob `7922b634b145bc064a33f95d04c058d3c5da18f6`). Смена конфигурации не изменяет уже замороженный U1/regex метод и его pre-gold SHA.

## Исполнение в owner-local checkout

Проверяющий `research/task-discovery/review_form_contract.py` имеет только stdlib и **не переносит чужой XML** в публичный репозиторий. Владелец запускает его против собственной локальной копии оригинала:

```sh
python research/task-discovery/review_form_contract.py \
  --owner-xml /PATH/TO/iwxa/knowledge/task-catalog/engine/research/TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml
```

Должны совпасть оригинальный git blob, три `TextArea` только в условном представлении `INDEPENDENT_TASK`, четыре категории, исходный `source_text` и три значения `review_coverage`. Ошибка версии или формы — `HOLD`; вывод не содержит текста документов или личных данных.

Синтетические regression:

```sh
cd research/task-discovery
python -m unittest -v test_review_form_contract.py
```

Отдельно приёмка у владельца: действительно импортировать локальные исходные документы в имеющийся Label Studio, выполнить две независимые слепые разметки, пройти `task_exp_01_review_bridge.py` и независимое разрешение разногласий. Не загружать оригиналы в публичный GitHub Actions. Совместимость XML, даже подтверждённая, ещё **не** означает, что UI/разметка/экспертная независимость прошли реальную приёмку.

## Научная граница

Публичный pre-gold U1/regex method commitment SHA-256 `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0` неизменен. Текущие восемь issues — разработческий набор TASK-EXP-01, не E5 held-out. Human gold, precision, recall, F1 и время человека — `NOT_MEASURED`. Изолированные локальные XML-тесты не подменяют независимых рецензентов или квалификацию Task Research Engine.
