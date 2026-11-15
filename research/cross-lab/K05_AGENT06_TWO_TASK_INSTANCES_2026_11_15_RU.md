# K05 / Agent 0.6 — сравнение двух независимых принятых Task

Дата: 15.11.2026. Ветка: \`Faust-S/knowledge@work/2026-11-15-agent06-effectiveness-evaluation\`. Общие Agent/T3/Activity/Atlas ветки неизменны. Статус: source-bound public contract; настоящий установленный Agent 0.6 с пользовательскими Task **не испытывался**.

## Причина

Старый компаратор \`compare_task_executors\` требовал \`baseline.task_sha256 == alternative.task_sha256\`. Для **двух самостоятельно созданных Task** настоящего Agent это обычно неверно: Task — разные канонические JSON-записи, со своими identity/digest, даже когда человек решает одну и ту же проблему с помощью двух выбранных исполнителей. Подставлять один Task digest вместо другого нельзя.

Сохраняем старый строгий gate для **буквально одной записи Task**. Добавляем отдельный доказуемый случай равенства **определений задач**, но не их индивидуальных identity.

## Реализовано

- \`k05_agent06_admission.py:compare_verified_task_runs(..., task_equivalence_evidence=...)\` сначала повторно проверяет исходные bytes обеих Task/Result/measurements/acceptance через исходный K05 и \`owner_verify\`. Две разные Task допускаются к числовому сравнению только при source-bound \`TASK_EQUIVALENCE\` от оригинального владельца.
- Owner proof \`values\` должен включать exact baseline/alternative \`task_sha256\`, общий \`input_sha256\`, общий \`cohort_sha256\`, \`owner_contract=PA.CONTRACT.TASK/1.0.0\`, \`purpose=EXECUTOR_TASK_INSTANCE_COMPARISON\`, \`original_task_readback=true\`, подтверждение эквивалентности goal, expected Result, acceptance criteria, constraints, execution permissions и source revision. \`proof.task_sha256=None\`, поскольку свидетельство относится **к паре**. Каждое \`Task\` сохраняет исходный digest. Неверифицированный proof/byte hash => HOLD.
- Дополнительно обязательно одинаковые входные данные, cohort, currency и \`phase=RUN\`, разные execution/run IDs и исполнители. Смена этих измерений не может быть «исправлена» сертификатом эквивалентности.
- \`k05_agent06_effectiveness.py\`: одиночный \`compare_task_executors\` требует \`phase=RUN\`. Единая функция \`_project_task_pair\` выполняет сравнение известных metric deltas для обоих случаев, без второго агрегатора или двойного вычисления.
- \`k05_agent06_owner_port.py:compare_two_agent_accepted_task_instances\`: штатный read-only путь, который вызывает **оригинальный** \`TaskCell.read_task/accepted_artifact/task_digest\` для каждого task ID, а затем исходный K05. При несовпадающем Result или отсутствии принятого Human Review: HOLD. Состояние TaskCell повторно читается после проверки AcceptedArtifact для защиты от рассинхронизации; \`TXR\` readback также завершается повторной сверкой Task.
- \`METRIC_SOURCE_KINDS\`: длительность/трудозатраты, возвраты, токены и стоимость теперь имеют явные допустимые типы источников. \`TASK_EQUIVALENCE\`, \`ATLAS_PLAN_FACT\`, Human Review и receipt управления инструментом не разрешены как actual usage/cost/time. Отсутствующие метрики по-прежнему \`UNKNOWN\`; текстовое качество не ранжируется.

## Где находится граница доверия

\`owner_verify\` — **интерфейс доверенного оригинального владельца**, а не доказательство внутри K05. В приватном установленном Agent его реализация должна на самом деле прочитать оба Task, проверить immutable state chain, разрешение пользователя, источник данных и equality полей. Отдельные \`source_bytes\` должны быть теми же байтами, которые owner проверил. Публичная фикстура с mock verifier проверяет лишь отказ на подмены и алгоритм сравнения; это **не независимая экспертиза реальных Task**.

**Не путать:** две Human-accepted Task ещё не означают, что внешний ToolRuntime добился подтверждённого business effect. Результаты делятся на \`ACCEPTED\`, \`SOURCE_COMPARABLE\`, \`TOOL_EXTERNAL_EFFECT=NOT_VERIFIED\`, \`CAUSAL_BENEFIT=NOT_MEASURABLE\`. Для денег нужен только owner-bound \`COST_INVOICE\` с точным Task/Result, для труда — \`TIME_TRACKING\`, а не host-reported latency.

## Пример входов внутри доверенного Agent

\`\`\`python
from k05_agent06_owner_port import compare_two_agent_accepted_task_instances

view = compare_two_agent_accepted_task_instances(
    run_a, run_b,
    task_cell=original_task_cell,
    baseline_task_id=original_a_task_id,
    alternative_task_id=original_b_task_id,
    source_bytes=owner_local_verified_source_bytes,
    owner_verify=original_owner_verifier,
    task_equivalence_evidence=original_task_comparability_pin,
)
\`\`\`

K05 не обходит его ToolRuntime/Kernel, не создаёт новый Task/Store, не публикует данные и не отправляет их в OpenTelemetry. Установка Agent 0.6 **не выполнялась в этом эксперименте**; нет права повысить \`IWXA_VERIFIED\` по синтетическому PASS.

## Проверки и передача

\`python -W error::ResourceWarning -m unittest research/cross-lab/tests/test_k05_agent06_task_instances.py -v\`

\`python -W error::ResourceWarning -m unittest discover -s research/cross-lab/tests -p 'test_*.py' -v\`

Негативные случаи: два разных Task без сертификата => NOT_COMPARABLE; подменённый digest, изменившиеся критерии и права, иной source revision, bytes mismatch, несовпадение входов/cohort => HOLD. Изменение состояния original TaskCell между двумя чтениями => HOLD. Возвраты, плановые длительности Atlas и модельные токены не могут выступать подтверждёнными временем человека/оплаченными расходами.

Непосредственный следующий прикладной этап: в **отдельной интеграционной ветке владельца Agent** подключить original \`owner_verify\` и выполнить настоящий Task A → Human Review → accepted Result, Task B → Human Review → accepted Result, ToolRuntime receipt, восстановление после cold restart. Обе Task identity сохраняются, критерии эквивалентности проверяются на исходных договорах и источниках внутри владельца. Не добавлять обязательный счёт за модель и не оценивать литературное качество ответа.
