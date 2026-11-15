# IWXA K05 / Agent 0.6 — настоящая ToolExecution V1 и полная история Task

Дата: 15.11.2026. Исходная ветка: \`Faust-S/knowledge@work/2026-11-15-agent06-effectiveness-evaluation\`. Изменения ограничены публичным K05. Общую ветку приватного Agent/T3/Activity не менять. Никаких пользовательских данных и приватных исходников в публикации.

## Установленный дефект предыдущего адаптера

Предыдущие публичные тесты \`FakeToolRuntime\` использовали неактуальную структуру receipt \`0.12\` с плоскими полями \`plan_id\`, \`plan_digest\`. Но в действующем приватном Agent 0.6 в \`ToolExecutionCell._load_receipt\` уже используется оригинальный контракт \`execution-receipt-v1.schema.json\` (\`schema_version=1.0.0\`):
- \`execution_contract=PA.CONTRACT.TOOL_EXECUTION@1.0.0\`;
- \`plan_ref={kind:"tool_execution_plan",ref_id,digest_sha256}\`;
- \`approval_ref\` с проверяемым typed ref;
- \`contract_state=SUCCEEDED|FAILED_KNOWN|UNKNOWN_RECONCILIATION_REQUIRED\`;
- \`external_effect_state=NONE|ACKNOWLEDGED|UNKNOWN\`;
- \`receipt_digest\` подтверждается оригинальным \`ToolExecutionCell._load_receipt\`.

План уже \`tool-execution-plan-v1.schema.json\` с \`plan_contract=PA.CONTRACT.TOOL_PLANNING@1.0.0\`. Старый K05 мог не пройти ни одну настоящую квитанцию: MOCK PASS был ложной уверенностью в интеграции. Исправление относится к **потребителю K05**; исходный ToolRuntime остаётся неизменным.

## Исправленный read-only interface

\`k05_agent06_owner_port.py\`:

- \`read_agent_execution_receipts(task_cell=...,task_id=...,tool_runtime=...,receipt_ids=[...])\`: читает через **действующие оригинальные** \`ToolRuntime.read_execution_receipt\`, \`read_execution_plan\`. Сверяет \`plan_ref\`, digest, contract, approval ref, idempotency, provider binding, exact Task и AcceptedArtifact; отдельно \`contract_state\`, \`external_effect_state\`, статус \`SUCCEEDED/FAILED/INPUT_REQUIRED\` и start/finish. Это интерфейс адресного чтения, но переданные receipt IDs **могут быть неполными**. Явный статус \`receipt_list_completeness=NOT_ATTESTED_USE_TASK_EXECUTION_HISTORY\`.
- **Новый рекомендуемый метод** \`read_agent_task_execution_history(task_cell=...,task_id=...,tool_runtime=...)\`. Вместо передачи вручную выбранного перечня квитанций вызывает оригинальный \`ToolRuntime.task_execution_history(task_id,task_digest)\`. Оригинальный ToolRuntime фильтрует все сохранённые планы/receipts одной Task, проверяет receipts через \`ToolExecutionCell._load_receipt\`, plan через \`read_execution_plan\`; перечень последних N записей других Task **не** используется.
- K05 повторно проверяет каждый исходный план и квитанцию, exact refs, исходный accepted Result и идентичность snapshots. Сверяет два readback history и Tasks; если записи появились/изменились в процессе чтения, возвращает HOLD вместо ложного подтверждения полного набора. Дополнительно повторно сверяет `execution_states_for_plans`: смена состояния intent между чтениями вызывает HOLD даже при неизменном списке receipts. Статусы `NOT_STARTED` с уже записанным receipt и `SUCCEEDED` без соответствующего `SUCCEEDED` receipt не допускаются; квитанция выбранного состояния должна относиться к тому же idempotency key.
- \`execution_states_for_plans\` оригинального ToolRuntime учитывает durable execution intents. Если после вызова нет receipt, но intent был сохранён, состояние \`OUTCOME_UNKNOWN\`, а **не** \`NOT_STARTED\`. Такое состояние отражается в \`uncertain_execution_plan_count\` и никогда не повышается до успешного бизнес-результата.
- \`sum_receipt_duration_ms\` — только арифметическая сумма времён ToolExecution receipt windows. **Не** end-to-end Task elapsed, не человеческое время, не время процесса T3 (окна могут пересекаться). \`retry_count\` остаётся \`UNKNOWN\`, даже когда несколько receipts имеют один idempotency key.
- В public projection не передаются raw arguments, secrets, tool IDs, output content, личные имена, исходные Task IDs и receipts; K05 не создаёт новую базу событий, новый ToolRuntime или систему записи.

## Использование внутри оригинального Agent

\`\`\`python
# После штатного завершения Task и одобрения человеком:
view = read_agent_task_execution_history(
    task_cell=original_task_cell,
    task_id=accepted_task_id,
    tool_runtime=original_tool_runtime,
)
# view['uncertain_execution_plan_count'] может быть >0 даже без TXR.
# Full accounting, accepted business effect, human time and unit costs
# still require their respective original owner receipts.
\`\`\`

Ключевая граница: **этот код пока публично проверен только на mock ports и контрактных фикстурах.** Полнота оригинального ToolRuntime подтверждается только оригинальным установленным Agent и cold readback. Два последовательных readbacks не являются транзакционным snapshot; K05 возвращает \`snapshot_atomicity=NOT_ATTESTED\` и \`cold_restart_readback=NOT_TESTED\`, пока это не подтверждено владельцем.

## Квалификация и негативные случаи

\`python -m unittest research/cross-lab/tests/test_k05_agent06_owner_port.py -v\`

\`python -m unittest discover -s research/cross-lab/tests -p 'test_*.py' -v\`

Проверки: V1 receipt принимается, legacy 0.12 receipt отклоняется; forged plan_ref/plan_digest, неподходящий contract_state, отсутствующий approval_ref — HOLD; полная история без ручных IDs; сохраняемый intent с UNKNOWN и отсутствующим receipt; посторонний план, дубликаты и изменение history между чтениями — HOLD. Нет разрешения на повторный вызов provider или сбор личных фактов.

Следующее действие после source-contract PASS: провести owner-local установленный тест Agent 0.6 Task→Review→Result→TXR→cold restart→\`task_execution_history\`, затем разрешённое фактическое сравнение двух Task. Не включать пустые или частично известные квитанции в ROI.


## Историческое человеческое разрешение на каждую ToolExecution TXR

Дополнение 15.11.2026, отдельная приватная интеграционная ветка Agent:
\`Faust-S/iwxa-personal-agent@work/2026-11-15-agent06-k05-owner-readback\`.

Исходная \`ToolRuntime.read_execution_receipt\` проверяет схему и digest записи, но
**не перечитывает по её \`approval_ref\` оригинальное решение человека**. Нельзя
принимать любой видимый \`SUCCEEDED\` как подтверждённое авторизованное действие.
При этом прямой вызов \`ApprovalCell.validate\` для старого действия неверен:
после выполнения approval мог законно истечь или быть отозван.

В исходный ToolRuntime Agent (ТОЛЬКО независимая рабочая ветка, без общего
Agent 0.6 и приватных Actions) добавлен read-only метод
\`read_historical_execution_approval(receipt_id)\`. Он использует существующие
\`read_execution_receipt\`, \`read_execution_plan\`, \`ApprovalCell._load\`,
\`ApprovalCell._revocation_for\` и оригинальную \`cells.approval._scope_digest\`;
сверяет Plan/Approval/Receipt, время старта относительно срока утверждения и
плана, и дату отзыва полномочия. Никогда не вызывает provider и не выдаёт
новое разрешение. Поздний отзыв не отменяет исторический факт разрешения;
отзыв до запуска или отклонение/подмена scope вызывают HOLD.

Публичный K05 вызывает этот исходный порт, только если он доступен:
\`read_agent_task_execution_history(..., require_historical_approval=True)\`.
Для старого Agent без нового порта — строгий отказ
\`HISTORICAL_APPROVAL_OWNER_PORT_REQUIRED\`. В совместимом нестрогом режиме
возвращается \`NOT_VERIFIED_OWNER_PORT_UNAVAILABLE\`, а не вымышленное
подтверждение. При наличии порта K05 проверяет совпадение digest/ID исходных
Plan/Receipt/Approval и отсутствие новых полномочий; наружу выдаёт только
статус и счётчики, без сырых записей и персональных данных.

**Статус испытаний**: публичные моковые тесты K05 выполняются в открытом
CI. Исходный приватный Agent с реальным \`ApprovalCell\` снабжён адресными
pytest-тестами на отдельной ветке, но приватные Actions запрещены; их запуск
в установленном Windows Agent и cold restart остаётся \`NOT_TESTED\`.
Ни один public mock PASS не означает подтверждённую пользу реального Agent.
