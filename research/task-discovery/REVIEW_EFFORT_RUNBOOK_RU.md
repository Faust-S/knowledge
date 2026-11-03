# TASK-EXP-01 — измерение нагрузки двух независимых рецензентов

Дата: 2026-11-03. Статус: **ADAPTER_TESTED_ON_SYNTHETIC_EXPORTS / REAL_HUMAN_TIME_NOT_MEASURED**.

## Для чего

`review_effort.py` дополняет **существующий** `Faust-S/iwxa` `task_exp_01_review_bridge.py`: подсчитывает `annotations.lead_time` (секунды, сообщённые Label Studio), а при заданной ставке считает **условную стоимость** двух человеческих разметок. Он **не** определяет Task, не делает adjudication, не измеряет Task precision/recall/F1 и не заменяет исходный E5. Все оригинальные тексты и идентификаторы рецензентов остаются в локальной среде владельца.

[Официальная документация Label Studio](https://labelstud.io/guide/export) описывает `annotations.lead_time` как секунды разметки. Этот показатель может содержать простой и повторные сессии, поэтому его нельзя объявлять независимо измеренным временем активной работы. Чтобы сравнить помощь Cross-Lab против самостоятельного чтения, нужен отдельный парный эксперимент с заранее определённым протоколом, а не просто две слепые разметки.

## Действующий маршрут

1. **Owner-local:** владелец существующего `Faust-S/iwxa@knowledge/2026-10-02-system-atlas` создаёт восемь source-first Label Studio задач штатным `task_exp_01_real_slice.py` и `task_exp_01_labelstudio_import.py`. Исходная версия и SHA проверяются штатно. Никаких приватных исходников/текстов в публичный checkout не переносить.
2. **Owner-local:** через имеющийся `labelstudio_project_setup.py` создаются два независимых *слота* в локальном Label Studio, с оригинальной `TASK_EXP_01_LABEL_STUDIO_SOURCE_FIRST.xml`, **не** с общей сокращённой E5 формой. Реальных независимых экспертов и их раздельный доступ организует оператор. Рабочий тест HTTP-имитатора не равен настоящей человеческой разметке.
3. После полного просмотра и JSON-экспорта `review-a.json` / `review-b.json` владелец запускает **оригинальный** bridge, который сверяет разметку, источники, идентификаторы и разногласия:

```sh
# Запускать из корня owner Faust-S/iwxa/knowledge/task-catalog
python -m engine.research.task_exp_01_review_bridge \
  --source-first-packet /PRIVATE/e5-source-first.json \
  --review-a /PRIVATE/review-a.json --review-b /PRIVATE/review-b.json \
  --restricted-disagreement-output /PRIVATE/disagreements.json \
  --confirm-independent-local-review > /PRIVATE/bridge-receipt.json
```

4. **Только после успешного исходного bridge**, из публичного `Faust-S/knowledge`:

```sh
python research/task-discovery/review_effort.py \
  --owner-bridge-receipt /PRIVATE/bridge-receipt.json \
  --review-a /PRIVATE/review-a.json --review-b /PRIVATE/review-b.json \
  --out /PRIVATE/review-effort.json
```

Для условной денежной оценки (например, отдельно известная ставка $60/час) можно добавить `--hourly-rate-usd 60`. Это допущение оператора, **не фактическая стоимость**. Если в одном из 16 исходных annotations отсутствует `lead_time`, общий показатель/стоимость остаются `null`, а не превращаются в нули. Числа не публикуются до согласованного решения владельца; в результате нет ID рецензентов, ссылок или оригинального текста.

Проверенный набор: 8 адресных тестов на синтетических экспортах — PASS. Настоящих человеческих экспортов пока нет, поэтому `LEAD_TIME_REAL=NOT_MEASURED`; метки gold, E5 и независимая оценка `NOT_RUN`. Воспроизводимый снимок методов: `93e76fc6983364c5718a8e26f797d7220ed51899cd90bf92f15731d3c5f94bf0` (заморожен до оценок людей).
