# IWXA K05 — совместимость с развивающимся Personal Agent 0.6

**Дата сверки:** 18.11.2026. **Решение:** `READY_FOR_AGENT_INTEGRATION=false`. Это документ состояния отдельных owner-веток, не разрешение на merge.

## Проверенные точные срезы

- Главный Agent 0.6: `Faust-S/iwxa-personal-agent@work/2026-11-15-agent-0-6-development` HEAD `1bf0847ed069c86fe6a11380537535f0ce6c0b8e`.
- Agent D6 / original T3 Result owner: `work/2026-11-16-agent06-original-t3-result-owner-d6` HEAD `34d8f1a10b552f1d0c4108e012414648e71ce0a0`.
- Корпоративная D3: `work/2026-11-16-agent06-corporate-t3-d3-current` HEAD `16a5062eac537224cde22273c99e758ea5849a91`.
- Независимая Office-ветка: `work/2026-11-15-agent06-office-document-integration` HEAD `0f5777366b4dcc0db3c4b409733eb320f1ac14cb`.
- Независимая ветка K05: `work/2026-11-15-agent06-k05-installed-package` исходный Windows-qualified HEAD `3a8b579f575130e3b9fb0edb6dc4a5407c073459` (мог продвинуться позже).
- Публичный qualified Windows CI K05 source: [#44359264302](https://github.com/Faust-S/Center/actions/runs/44359264302), `104/104 Python`, `24/24 package`, `1/1 cold Core`, Vite/TypeScript/UIA PASS.
- Последний установленный K05: [#44359264074](https://github.com/Faust-S/Center/actions/runs/44359264074), **в работе на момент записи**, никакого installed PASS не заявлено.

## Главное расхождение

Сравнение GitHub API `base=agent06-development, head=K05` показало **diverged: K05 ahead=75, behind=232**. По D6: **ahead=75, behind=124**. Механический merge либо перенос целого `workbench.tsx`, `daily_driver_engine.py`, `interaction_surface.py`, `approval.py` или Setup Core из K05 в центральный Agent **запрещён**. Главный Agent развивает сохранение черновиков и Task/Result, T3 D3/D6, Office и другие программы независимо от K05; личная Task не должна ожидать Atlas/T3.

## Текущие owner-контракты и последствия для K05

| Контракт | Сверка с основным Agent | Правило K05 |
| --- | --- | --- |
| `DailyDriverEngine.task_detail(task_id)` и оригинальный `task_id/objective/status` | Метод присутствует в центральном и D6, без замены оригинального TaskCell | Read-only актуальные Task/Result; не копировать Task Engine |
| `interactive_submission_status(submission_id)` и `last_error_code` | Метод присутствует; в исходном installed K05 был `basic_runtime_output_invalid`, позже K03 достиг K05 UI | Не делать повторный model run во время сравнения; `PAUSED` не объявлять завершением |
| `BasicGGUFProvider` и `ProviderPort` | До K05-поправки базовый `iwxa_basic_model_provider.py` в центральном Agent совпадал с исходным K05 blob `a4fc6bd6` | Поддерживать совместимый контракт реального `llama.cpp`, не перезаписывать центральные owner-модельные маршруты |
| `ApprovalCell` | В K05 добавлены read-only методы `read_historical_plan_decisions/read_historical_revocations`, отсутствующие в центральном `ApprovalCell` | Историческую оценку не считать доказанной без оригинального owner extension; адаптировать адресно после K05 acceptance |
| WebView2 Result | Основной Workbench использует `documentTab=result`, `detailFresh` и `accepted_artifact_digest`; K05 добавляет необязательный сравнительный экран | UIA проверяет `saved-task-<id>` и принятый Result с Core-linked ID, не нормализованный SHA имени |
| T3 D3/D6/Office | Продвигаются на других владельческих ветках и отсутствуют в старом K05 слое | K05 не должен перекрывать их, быть обязательным runtime или принимать передачу через Atlas за стандартную личную Task |
| Provider usage | Тёплый локальный исполнитель K05 наблюдает actual `prompt_tokens/completion_tokens`, когда сервер предоставляет их; cold CLI токены остаются `UNKNOWN`, если нет owner count | Не оценивать потребление по длине промпта/лимиту токенов и не объявлять экономию без фактических затрат |

## Нативная история K05

- [#44105022163](https://github.com/Faust-S/Center/actions/runs/44105022163): оригинальный installed `K03_TASK_EXECUTE=FAIL`, код `basic_runtime_output_invalid` (истинный owner `PAUSED`).
- [#44348330057](https://github.com/Faust-S/Center/actions/runs/44348330057): исполнение K03 прошло; стадия `K05_GUI_NONCOMPARABLE/ACCEPTED_RESULT` FAIL. Причина bounded `UNKNOWN`. Старый UIA после проверки Task ID требовал SHA от доступного WebView2-имени многострочной objective; исходный SHA не обязан совпадать с нормализованным UIA Name.
- K05 source `3a8b579f`: только для K05 заменена избыточная проверка accessible-caption SHA на проверку фактического `accepted-task-objective-<taskId>` и видимого `Result accepted`. Оригинальное независимое чтение Task/Result SHA в Core до и после K05 сохраняется. Не изменены обычные GUI `result/review` и Quality K05. Установленная квалификация всё ещё необходима.

## Следующая работа без ранней интеграции

1. Получить итог installed [#44359264074](https://github.com/Faust-S/Center/actions/runs/44359264074), исправить выявленный конкретный блокер и повторить на том же exact Agent SHA, не маскируя прерывания.
2. Нативно завершить оригинальный K03→Human Review→cold Result и UIA `NOT_COMPARABLE` двух реально принятых разных Task, затем положительную source-equivalent пару разных реальных моделей.
3. Проверить фактические критерии качества, цену/время, активную работу человека и возвраты; `unknown` не переводить в ноль или успех.
4. Перед передачей в Agent 0.6 **заново** снять свежие HEAD/TREE Main/D3/D6/Office и проверить схему целевых owner методов. Не создавать новые Task Engine, Store, Kernel, Graph или mandatory runtime.

**Релизные флаги:** `K05_SOURCE_PASS=true`, `K05_NATIVE_ACCEPTED=false`, `READY_FOR_AGENT_INTEGRATION=false`, `PRODUCT_ACCEPTED=false`, `REAL_EFFECTIVENESS=NOT_MEASURABLE`.

**Приватность:** только разрешённый public `Faust-S/Center` Windows runner с временным read-only доступом private Agent; никаких private Actions, исходных архивов, EXE, пользовательских данных или модельных ответов в публичных артефактах.

## Дополнительная сверка владельцев, 18.11 (после новых K05 Windows)

Свежие SHA из **существующих**, независимо развиваемых Agent 0.6 owner-веток:
- Центральная `work/2026-11-15-agent-0-6-development`: `1bf0847ed069c86fe6a11380537535f0ce6c0b8e`.
- Office `work/2026-11-15-agent06-office-document-integration`: **`8c73fcda52cfb3dba8501a19203778e1bb916c19`**, позднее первоначальной сверки; original Task projection теперь проверяет 100-row contract для OCR. Нельзя переносить старый Workbench/Task readback из K05 поверх Office.
- T3 D3 `work/2026-11-16-agent06-corporate-t3-d3-current`: `16a5062eac537224cde22273c99e758ea5849a91`.
- T3 D6 `work/2026-11-16-agent06-original-t3-result-owner-d6`: `34d8f1a10b552f1d0c4108e012414648e71ce0a0`.
- Изолированный K05 `work/2026-11-15-agent06-k05-installed-package`: `9c8a0eee06f9fc9bda326c37f577e5cead923ec3`. Только он включает новый UIA идентификатор принятого результата; основной Agent его ещё не получил.

Актуальный GitHub compare (base = owner, head = K05), **точные числа по графу, не процент готовности**:

| Base owner | K05 ahead | K05 behind |
| --- | ---: | ---: |
| Agent main 0.6 | 81 | 232 |
| Agent Office | 81 | 249 |
| T3 D3 | 81 | 24 |
| T3 D6 | 81 | 124 |

Итог: источник K05 должен оставаться независимым до полной installed product qualification. Разница в истории достаточна для запрета на полный merge `workbench.tsx`, `daily_driver_engine.py`, `interaction_surface.py` и `approval.py`. Нативный CI [#44372957899](https://github.com/Faust-S/Center/actions/runs/44372957899) ещё выполняется. Источники [#44372957951](https://github.com/Faust-S/Center/actions/runs/44372957951) `SUCCESS` на `9c8a0eee` (117/117 Python, 26/26 package, cold Core 1/1). Статусы `READY_FOR_AGENT_INTEGRATION=false`, `PRODUCT_ACCEPTED=false` не меняются.
