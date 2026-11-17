# IWXA K05 / Personal Agent 0.6 — границы интеграции (17.11.2026)

## Версии и проверенный результат
- Отдельная ветка K05, private Agent: `Faust-S/iwxa-personal-agent@work/2026-11-15-agent06-k05-installed-package`, квалифицированный source SHA `22d36bb2060d05afe9653f4703fe0af723f9da7d`. Не является HEAD центрального Agent.
- Публичный K05 source pin: `Faust-S/knowledge@b2de1d6cd8dd1e660183c16febd18da9ac3b94a7`, в `config/public-module-sources.json`, usage=`explicit-optional-task-comparison`. Следующая публикация в ветке `work/2026-11-15-agent06-effectiveness-evaluation` носит характер отчётности.
- Публичный Windows CI: `Faust-S/Center@work/2026-11-15-agent06-k05-executor-comparison`, коммит `b66dacff7ae3d8f4e633ab6907a09364a275a1a6`.
- Windows *source* CI [№44105022007](https://github.com/Faust-S/Center/actions/runs/44105022007) на точном SHA `22d36bb`: SUCCESS, Python Agent/K05 74/74 PASS, package 21/21 PASS, packaged cold Core 1/1 PASS (0 SKIP), UI/TypeScript/Vite и Windows UIA parser PASS.
- Windows *installed* CI [№44105022163](https://github.com/Faust-S/Center/actions/runs/44105022163) на том же SHA: запущен, на момент написания окончательный результат не получен. Не отмечать PASS без законченной receipt.
- Предыдущий установленный Windows [№43779612658](https://github.com/Faust-S/Center/actions/runs/43779612658): FAIL в `K03_TASK_EXECUTE`; Core status `PAUSED` / `awaiting_result` / `OTHER_REDACTED`. Ещё более ранний [№43772246827](https://github.com/Faust-S/Center/actions/runs/43772246827) дошёл до `K05_GUI_NONCOMPARABLE` и остановился на `TASK_SELECTION`, поэтому K03 установленный маршрут нестабилен.
- `K05_SOURCE_INTEGRATION_CANDIDATE=true`; `K05_INSTALLED_ACCEPTED=false`; `REAL_TWO_EXECUTOR_EFFECTIVENESS=NOT_MEASURABLE`; `PRODUCT_ACCEPTED=false`.

## Обязательная граница продукта
K05 является **необязательным read-only аналитическим Kit** поверх оригинального Core. Он не создаёт собственный Task Engine, Graph, Store, IAM, ProviderRegistry, лицензионного подписанта, .iwxa и не меняет канонический T3. Сравнение двух оригинальных принятых Result возможно только после независимой проверки их Task, контекста, источников, Workspace, модели/ProviderRegistry history и Human Review. Сопоставимость при различных целях, источниках, правах или редакциях должна быть отказом, а не автоматически выставленным PASS. Сравнение не запускает модели, не пишет Task/Result и не делает вывод о причинной пользе или рейтинге качества на основании Human Review.

## Что интегрировать адресно
1. Снять **новые** текущие HEAD/TREE центрального Agent 0.6, T3 D3/D6 и K05, зафиксировать merge-base, осмотреть все конфликты. На момент проверки D6 интеграция `work/2026-11-16-agent06-original-t3-result-owner-d6@ffab19a8` и K05 разошлись (K05 ahead 69, behind 109). Запрещён merge всей ветки K05 в центральную: он может вернуть старые версии D3/D6, T3 и восстановления Task.
2. Адаптировать точечно новые K05 файлы: `runtime/public_k05/agent06_effectiveness_bridge.py`, `desktop/src/task-executor-comparison.tsx`, `desktop/tests/k05-executor-comparison-ui.test.mjs`, `tests/test_k05_agent06_executor_comparison.py` и оригинальные read-only owner tests. Сохранить ссылку на оригинальную публичную K05 source receipt и exact pin. Не копировать public K05 в отдельную обязательную runtime-петлю.
3. В `runtime/daily_driver_engine.py`, `cells/interaction_surface.py`, `desktop/src/workbench.tsx`, `config/public-module-sources.json`, `scripts/prepare-public-modules.mjs`, `tools/build_explorer_package.py` брать только необходимые K05 изменения по минимальному diff на актуальном центральном owner, не перезаписывая центральные новейшие D3/D6/D7, T3, K01/K02/K04 или UI-исправления.
4. Нативный UIA witness `tools/qualify_setup_core_native_gui.ps1` выбирает исходную Task строго по `saved-task-<taskId>`, а принятый Result по `accepted-task-objective-<taskId>`. Поправка нужна для многострочных K03 objectives, но UIA успех не доказывает owner-equivalence. Исходный `tools/qualify_setup_core_k03_task.py` и `qualify_setup_core_runtime.ps1` с безопасной диагностикой сохранять как тесты, не как новые продуктовые сервисы.
5. Запрещено запускать GitHub Actions в private Agent/T3. Только разрешённый public Center с временным read-only SHA-прикреплением private исходников; никаких публикаций private package, токенов, ответов модели, промптов или пользовательских документов в artifacts/logs.

## Порог передачи в центральную ветку
- [x] Исходные и пакетные Windows CI на точном SHA проходят.
- [ ] **Последний installed native CI** полностью PASS с real Qwen → original K03 source → Task → model → Human Review → холодный Core readback → K05 двух различных принятых Tasks → UIA `NOT_COMPARABLE` → оригинальный read-only Core K05 proof (zero extra model calls).
- [ ] Повторный независимый установленный прогон подтверждает отсутствие интермиттирующего `PAUSED` K03 или фиксируется точная причина и исправление. Нельзя считать одноразовый K03 PASS устойчивостью.
- [ ] Новая центральная ветка (а не старая K05) проходит Windows source и installed Setup Core; новые D3/D6 нативные сценарии не регрессируют.
- [ ] Для утверждений о `real effectiveness`: два разных настоящих исполнителя на исходно эквивалентных задачах с принятой пользователем одинаковой метрикой качества, реальными временем/расходами и сохранёнными квитанциями. Отдельно отделить оценку качества от причинного эффекта.

## Заключение
До закрытия installed gates разрешена отдельная адресная инженерная подготовка адаптера в новой интеграционной ветке. Не обозначать `PRODUCT_ACCEPTED` и не включать обязательный K05 runtime в Agent 0.6. Интеграционный промт должен прямо запрещать перенос старого `daily_driver_engine.py` и перезапись центральных D3/D6/T3.
