# IWXA Cross-Lab M2 — реальный публичный native U1 replay

Дата: 2026-11-03. Статус: **M2_ENGINEERING_REAL_SOURCE_PASS / TASK_QUALITY_NOT_MEASURED / E5_NOT_RUN**.

## Подтверждённая исполняемая ревизия

- Репозиторий: `Faust-S/knowledge@work/2026-11-03-unified-task-migration`.
- Tested commit: `c73493bfe9198cbb910efc440e03d1355df9a405`, TREE `03ecc388be9ec36321279e7f177e460ae02e8b05`.
- [GitHub Actions run 41665816570](https://github.com/Faust-S/knowledge/actions/runs/41665816570): `completed/success`, все шаги PASS, включая настоящий source fetch, native U1 regression, проверку инвариантов, выпуск обезличенной квитанции.
- GitHub Actions artifact: `crosslab-public-native-u1-receipt`, artifact ID `13246526378`. Внутри `crosslab-native-receipt.json`, 4519 байт; SHA-256 `f59ebd5bf931973014a9dfa77e89187bdeea9702e2425897cf5cd4faa6631d10`.
- Нативный U1: Git blob `eb15aec5ba1a749c29d7c40a868127e1a384b6bf`, точно совпал с owner snapshot. Исходный XML Label Studio `7b82dbd05b4e28c53446d863c5bb48b72245a10d`. Manifest selection-time `e22b8b3926889564f6ed70b49471b1057fa2724a`.
- GitHub Actions выполняет локальный пакет в **публичном** checkout без PAT/SSH доступа к закрытому репозиторию; секреты и текст корпусов в artifact не включаются. Публичность снимка исходного U1 не означает отдельной универсальной лицензии на него.

## Численные результаты (восемь preselected реальных GitHub issues)

| Метрика | Нативная квитанция |
|---|---:|
| Входные документы из frozen manifest | 8/8 |
| Исследовательские U1 RawStatements | 373 |
| U1 lexical review cues | 8 |
| Источники с U1 cue | 3 |
| Источники с title regex cue | 6 |
| Источники с cue хотя бы одного способа | 7 |
| Все исходники переданы source-first | 8 |
| Источники без U1 cue сохранены для просмотра | 5 |
| Exact issue reference occurrences | 5 |
| Неполных U1 scans | 0 |
| U1 `inspect+review_hints`, только инженерное время на runner | 13.2178 ms |
| Title regex + exact references, только инженерное время | 0.3316 ms |
| Human review time / cost | NOT_MEASURED |
| Независимый task gold / task precision / recall / F1 | NOT_MEASURED |

`u1_processing_ms` и `simple_baseline_ms` измеряют **разный объём работы**, это не доказательство превосходства одного метода по скорости end-to-end. Стоимость GitHub Actions в долларах не измерялась. Из 8 источников пять не содержат лексических U1 cues, поэтому исключать их из Human Review нельзя; **это не пять доказанно пропущенных Task**. Title-regex cue не означает задачу. SHA+BFS `NOT_APPLICABLE_NO_VERIFIED_DEPENDENCY_GRAPH` для этих источников.

## Научные ограничения

- Текущие 8 issues были отобраны исследователем; это не E5 independent held-out и не human task gold.
- Локальные 9/9 PASS подтверждают код/интерфейс и настоящий U1 на **синтетических тестовых входах**. Отдельный Actions run доказывает настоящий U1 на **реальных pinned GitHub issues**, но не task accuracy.
- `task_candidates_created=0`, `t1_acceptances_created=0`, `e4_approvals_created=0`. Никаких автоматических решений человека, прав записи, TaskType или продуктового Result не было.
- Предстоящая независимая оценка должна использовать существующие TASK-EXP-01/Label Studio, два самостоятельных рецензента и adjudication, с реальной метрикой качества и человеческих затрат. Исследовательские eight-issue корпуса и Werkzeug нельзя переиспользовать как новый held-out E5.

## M2 → M3

1. Привести TASK-EXP-01 публичную метаданную репликацию к согласованным source/ref версиям без второй системы разметки; не переносить закрытые исходные корпуса.
2. Подготовить owner-local source-first импорт и получить две независимые разметки всех документов (в том числе без cue).
3. Заморозить альтернативные методы до просмотра gold, потом определить precision/recall/F1 и ошибки на независимых данных. При отсутствии преимущества сложного механизма оставить simple baseline.
4. Продуктовая Task/ContextProjection/Agent/Skills/Result остаётся в Personal Agent; поддержка Cross-Lab — отдельное подключение после независимого измерения полезности.

**Управление исходниками:** `Faust-S/iwxa` остаётся owner исследовательского U1 и TASK-EXP-01; `Faust-S/knowledge` содержит закреплённую открытую QA-копию, не второй Task Engine. `main`, T0/T1, центральные лаборатории не менялись.
