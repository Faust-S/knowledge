# Agent 0.6: T3 / Activity / внешние ERP и процессы

Дата: 2026-11-15. Ветка: work/2026-11-15-agent06-process-erp-integration.
Статус: SOURCE_CONTRACT_IMPLEMENTED, INSTALLED_ERP=NOT_ACCEPTED, REAL_PROCESS=NOT_ACCEPTED, T3_READY=false.

## Владельцы

- ORIGINAL T3 Host / inherited T2 Kernel 0.3.6 / Access D1 / D2 Activity / original .iwxa Exchange: `packages/t3-core`.
- Activity: отдельный подписанный read-only источник `modules/activity-base-anonymizer`; её OWNER_REVIEW_DRAFT не доказывает анонимность и не публикуется автоматически.
- Agent 0.6: ToolRuntime, n8n, аккаунты/автоматизации, Human Review, Task/Result, обработка HTTP/API. **Никаких ERP токенов, n8n ToolRuntime или исполнительного workflow внутри public T3.**
- ERP / BPMN / workflow provider: собственный durable state, API, авторизация, native operation receipt и восстановление после lost ACK.
- CehoVod: канонические order, operation-execution, production-actuals, quality-check, defect, plan-fact contracts в приватном `Faust-S/cehovod`; не менять статусы напрямую.

## Реализованная узкая функция

`src/t3/external-process-link.mjs`, экспорт через существующий `src/t3/index.mjs`:

`createTrustedExternalProcessLink({kernel,accessForWrite,currentWorkspace,externalOwner,confirmHuman,isHostActive})`

`externalOwner.readExact({record_kind,record_id})` вызывается за доверенной границей Host. Его ответ **должен быть проверен самим владельцем API**: `source_owner`, `record_kind`, `record_id`, `source_revision`, `source_digest` (SHA-256 exact canonical source snapshot), `source_receipt` (owner-native evidence), `source_state`. Клиент не вычисляет digest по неподтверждённому JSON. Credentials/secrets и raw customer fields в T3 не сохраняются.

Ввод Host: `{expected_workspace_id,record_kind,record_id}`. Host фиксирует выбранную Workspace и исходный signed D1 контекст. После двойного чтения ERP source и отдельного Human consent делается **один** оригинальный `t1.putObject`, `base_revision=0`, с предварительным D1 JIT через `createSubjectKernelBinding`. Контракт объекта: `iwxa.agent06.external-process-link@1.0.0`; event: `t3.external-process.record.reported`; D2 mapping всегда `semantic_kind=Evidence`, `epistemic_status=reported` (НЕ observed business activity). Существующий service passport T2 **обязан** объявить эту схему; без штатной декларации оригинальный Kernel должен отказать.

Ссылка имеет детерминированный ID по owner/type/source ID; одинаковая revision → `ALREADY_LINKED`, другая → `T3_EXT_REVISION_OR_SOURCE_CONFLICT` и read-only `REVISION_CONFLICT`. После неопределённого write ACK запрещён replay; `recover()` повторно читает реальный ORIGINAL Kernel + ERP owner. Успешное локальное восстановление НЕ является подтверждением исполнения ERP-операции.

Значение `LINK_PERSISTED` обозначает только существование и совпадение исходной ссылочной записи T3. Для реального внешнего действия использовать **имеющийся** `createTrustedNativeContinuation` D6 или Agent ToolRuntime, где `inspect → receive → receipt → readback` выполняются у исходного владельца. Требовать durable operationId, exact external source revision, original Result readback после cold reopen. Не создавать ещё один receipt store.

### Важные ограничения первого исходника

- В public T3 нет сетевого ERP-клиента, BPMN XML parser/renderer, n8n ToolRuntime или приватного CehoVod domain-mapper.
- Переход `reported → observed` **не выполняется** этим API. Подтверждённый объект Activity потребует отдельного доменного фактического Event и evidence refs от владельца.
- Текущий `readExact` является доверенным портом, а не криптографическим доказательством достоверности API-ответа. Продуктовый owner должен сверять TLS, ревизии и права; HTTP GET сам по себе не является owner receipt.
- При двух отдельных Host, пишущих один external-link ID, решающий конфликтом остаётся оригинальный Kernel base_revision. Volatile pending предотвращает лишь повтор одного Host.
- Запрет записи зависит от **оригинального** сервисного паспорта, signed D1 Access и Kernel. Не считать UI-подтверждение или Publisher licence правом `t1.putObject`.
- Модуль не подключён автоматически к приложениям, пока Agent/ERP owner и CehoVod производственный сервис не согласованы.

## Внешние программы: варианты подключения

| Система | Канал | Принадлежность записи | Кандидат |
|---|---|---|---|
| ERPNext / Frappe | `GET /api/resource/Sales%20Order/{name}`, собственный API token пользователя | ERPNext; использовать `modified` плюс самостоятельный digest и native receipt | Первый |
| Odoo Community | модель `sale.order`, версия-специфичный RPC / JSON-2, права конкретного развертывания | Odoo; `write_date`, `id`, company/DB scoping, явная повторная сверка | Второй |
| Dolibarr | REST `/api/index.php/orders/{id}`, DOLAPIKEY на владельце Agent | Dolibarr; ID/row_version или иной поддерживаемый контроль конфликта | Третий |
| n8n | существующий Agent ToolRuntime, webhook/execution ID, проверяемый outcome | n8n | Сохранить |
| Node-RED | HTTP In/HTTP Response с явным flow/job ID и пользовательским credentials | Node-RED | Альтернатива |
| Activepieces | официальный webhook/flow runs API с документированными permission/license limits | Activepieces | Альтернатива |
| Flowable / Operaton | BPMN engine deployments, runtime instances, job/task/incident APIs | Внешний BPM engine | Дополнительные исполнители |

Проверять версии и условия лицензий отдельно по официальным источникам до включения пакета. Odoo 19 JSON-2 API, например, документирован для оплачиваемых планов Odoo Online; это не доказательство доступности того же API у каждой Community installation. Не импортировать XML BPMN как исполненное событие: импорт проверяет структуру/версии/профиль, а реальность устанавливают original owner events.

## Первый предметный маршрут D05 CehoVod

1. Agent через выбранный пользовательский ERPNext аккаунт делает `readExact(Sales Order, SO-0042)`, проверяет API права, статус и snapshot digest; полученный документ остаётся у ERPNext.
2. Человек подтверждает привязку к уже выбранной CehoVod Workspace. ORIGINAL подписанный T3 Kernel пишет `iwxa.agent06.external-process-link`; D2 отображает `reported` Evidence, не физическую операцию.
3. CehoVod собственными исходными функциями создаёт/связывает production-order, operation-execution и их независимые факты, если это разрешено. Нельзя переводить заказ прямой записью `status`.
4. Agent через старый ToolRuntime выполняет ровно один согласованный owner-native ERP/workflow action. Для получателя требуется D6 operationId + original owner `receipt/readback`; lost ACK = `OUTCOME_UNKNOWN`, только чтение восстановления.
5. CehoVod сохраняет отдельные production-actuals, defect, quality result, plan-fact и доменный Result; Activity D2 получает только реально наблюдаемые события с точными revision/provenance.
6. После перезапуска Agent/Host читает оригинальный T3 объект, исходный owner operation receipt, доменный Result; сравнивает ревизии и не повторяет внешнюю операцию.

## Минимум квалификации до PRODUCT_ACCEPTED

- Original T3 Host (не изолированный stub) с подписанным D1, одним Kernel 0.3.6 и реальным зарегистрированным сервисным паспортом, T3 D2, Activity.
- Настоящий ERPNext owner с разрешениями; `modified`/digest/receipt, version conflict, дубль webhook, потеря ответа, HTTP/permission отказ.
- Реальный CehoVod заказ со штатной функцией переходов, факт, отклонение, дефект и Result.
- Статус внешнего workflow от исполнительного owner, подтверждённое действие, no replay, readback после двух cold opens.
- Оригинальный `.iwxa` и восстановление в новом получателе только при соответствующем подписанном grant.
- Тесты приёмки run в **открытом knowledge**, без приватных Actions. Не маркировать source fixtures как native acceptance.

## Подключение Agent 0.6 (отдельный интеграционный шаг)

1. В приватном Agent 0.6 сохранить его штатные n8n/ToolRuntime/ERP credentials. Никакие ключи не отправлять в public T3, JSON Event или .iwxa.
2. В **доверенном** Host установить `externalOwner.readExact` поверх существующего Agent аккаунта; утверждать только узкий документированный snapshot. Текущий renderer не выбирает `ownerId` и не может выдать подписанный D1 контекст.
3. Штатно зарегистрировать `EXTERNAL_PROCESS_LINK_DECLARATION` в разрешённом оригинальном T2 сервисном паспорте и D2 version-pinned binding. Только затем дать человеку команду link/recover.
4. Для действия у ERP использовать уже существующий Agent ToolRuntime с отдельным Human Review; связывать owner operationId с D6/оригинальным Result и выполнить cold readback.
5. Испытать с собственным реальным CehoVod доменным владельцем, затем независимо согласовать перенос в Agent 0.6. Central branches в этой работе не изменены.

Источники исходников: `packages/t3-core/src/t3/{subject-access-binding,native-result-continuation}.mjs`, `src/t3/activity/{index,kernel-reader}.mjs`, `src/modules/base/features/project-process/{project-process,process-intelligence}.mjs`, `Faust-S/cehovod/src/lib/{production-order,operation-execution,production-lifecycle}.ts`.

## Подтверждённые upstream источники API и условия поставки

- ERPNext/Frappe: https://docs.frappe.io/framework/user/en/api/rest (DocType REST, `Authorization: token api_key:api_secret`, /api/resource/..., операции от имени существующего пользователя); исходная лицензия ERPNext GPL-3.0-or-later: https://github.com/frappe/erpnext/blob/develop/license.txt . В Frappe `modified` имеет вид `2019-06-03 14:19:00.281026`; новый T3 source_revision принимает такие строки как данные, но НЕ как signed T3 IDs.
- Odoo 19 JSON-2: https://www.odoo.com/documentation/19.0/developer/reference/external_api.html . Документация Odoo Online прямо ограничивает внешний JSON-2 API планом Custom. Для локальной Odoo Community применять API только после проверки конкретной версии, установленных модулей и лицензии, а не автоматически обещать JSON-2 на любой инсталляции.
- Dolibarr: https://wiki.dolibarr.org/index.php/Module_Web_Services_REST (REST /api/index.php/..., `DOLAPIKEY`, optional multicompany `DOLAPIENTITY`), версия API и нужная операция в целевой инсталляции требуют проверки.
- Flowable BPMN: https://www.flowable.com/open-source/docs/bpmn/ch14-REST (runtime/process-instances, runtime/tasks и HTTP 409 conflict). Open-source engine Apache-2.0: https://github.com/flowable/flowable-engine/blob/main/LICENSE .
- Node-RED: open-source Apache-2.0 https://github.com/node-red/node-red/blob/main/LICENSE . HTTP endpoints требуют явной настройки flow/auth и штатного хранения результатов у владельца.
- Activepieces: core MIT, enterprise/commercial отдельная лицензия: https://github.com/activepieces/activepieces/blob/main/docs/about/license.mdx . Нельзя обещать enterprise API в Community по названию продукта.
- Operaton, n8n: до включения в сборку надо отдельно зафиксировать точную версию, API и реально применимые ограничения лицензии. Ни один из этих продуктов не встроен и не запускается данным исходным T3 контрактом.

Лицензия стороннего сервера и лицензия связывающего IWXA кода оцениваются раздельно. Использование стороннего REST API само по себе не даёт прав на перенос его исходников/коммерческих модулей.

## 15.11: original T2 Compare-and-Swap для ERP -> T3

После `link` доступен `refresh({expected_workspace_id,record_kind,record_id})`: пользователь согласует обновление внешнего source revision. Перед оригинальным `t1.putObject` проверяются неизменность source и исходной T3 ревизии; запись выполняется с `base_revision=old.revision` через существующий подписанный D1 + ORIGINAL Kernel. Повторная отправка после `OUTCOME_UNKNOWN` запрещена: `recover()` читает настоящую запись после холодного запуска. Если у внешнего владельца `source_revision` не меняется при изменении digest/state, `refresh` отказывает. Обновление ссылки всегда `reported`, даже при ERP состоянии Submitted или Completed.

`source_receipt` допускает null: чтение стандартного Frappe DocType REST не выдаёт durable operation receipt. Отсутствующую квитанцию нельзя выдумывать из HTTP 200. Для **настоящего действия** в ERP или workflow требуется существующий Agent ToolRuntime, D6 `createTrustedNativeContinuation` с durable operationId, `receipt/readback` от ERP owner, и отдельный доменный CehoVod Result. Это не вторая система процессов.

Публичный исходный CI baseline до изменения refresh: https://github.com/Faust-S/knowledge/actions/runs/43718835358 SUCCESS (test, original real-host, Windows credential); аппаратный WebGPU SKIPPED. Новый источник нуждается в квалификации на точном коммите; installed ERP/Agent/CehoVod E2E не принят.

## Agent 0.6 → D6: конкретное условие подтверждения внешней операции

`prepareContinuation({expected_workspace_id,record_kind,record_id})` допускается только после свежего `recover` со статусом `LINK_PERSISTED`, выдает exact `{workspace_id,object_id,schema_id,revision}` и сам НЕ выполняет внешнее действие. Это вход в **существующий** `createTrustedNativeContinuation`. D6 отдельно перечитывает исходный объект с original signed D1 и проверяет owner-native `operationId`, `receipt(COMMITTED)`, `readback(PERSISTED)`.

Подтверждено по исходному private Agent 0.6: `adapters/n8n_workflow_v1.py` передаёт `X-IWXA-Idempotency-Key`; HTTP 2xx возвращает `external_effect_state='ACKNOWLEDGED'` и необязательный `request_id`. Это **транспортный ответ**, а не подтверждение исполнения заказа в ERP. `runtime/tool_runtime.py` объявляет `n8n.workflow` как `WRITE/high/approval_required/PROVIDER_KEY`. Локальная ToolExecutionCell подтверждает собственное выполнение Agent, но не заменяет независимую durable-квитанцию n8n/ERP-владельца. При lost ACK владелец Agent должен сохранять `RECOVER_ONLY` в уже имеющемся durable ToolExecutionCell, не создавать второй журнал. Последующий независимый owner `receipt/readback` и исходный доменный Result CehoVod - отдельный интеграционный шаг.

Добавлен адресный публичный тест: `tests/t3-agent06-external-process-link.test.mjs`, scenario `fresh ERP source -> original D6`: ACK → OUTCOME_UNKNOWN, холодный Host не повторяет dispatch при RECOVER_ONLY, полученный позже настоящий по форме owner receipt → OWNER_READBACK_CONFIRMED. В тесте original T3 Kernel и n8n owner представлены контролируемыми double; это SOURCE_CONTRACT, не установленная ERPNext/n8n квалификация. Main T3, Activity и private Agent не изменены.

## Оригинальный T2 сервисный паспорт: закрытие схемного разрыва

Ранее `link/refresh` были исходными портами, но без сервисного паспорта оригинальный T2 Kernel справедливо отказывал в записи `iwxa.agent06.external-process-link`. Теперь `EXTERNAL_PROCESS_LINK_PASSPORT` декларирует *только* эту схему у `iwxa.agent06.external-process` и разрешает ограниченные `workspace.read`, `object.read/write`, `events.read_scope=service`. Запрещены Workspace create/list/delete/purge, object.delete, import/export .iwxa и любые чужие типы объектов. Подписанные права D1, гранты, owner account и Human Review это не заменяет.

`planOriginalT2ExternalProcessRegistration({domain,catalog,controlPlane})` находится в `src/t3/external-process-passport-registration.node.mjs`. Это **чистая build-time функция штатного оригинального Host**, не новая служба, IAM, registry, администратор или исполнитель процессов. Она возвращает нормальные `_iwxa/domain.json`, `_iwxa/service-catalog.json`, `_iwxa/security/capability-control-plane.json`, bytes штатного паспорта `_iwxa/services/iwxa.agent06.external-process.json` и его SHA-256. Повтор идемпотентен, подмена существующего паспорта и пересечение маршрутов отклоняются. Владельцем установки остается исходный Host compiler.

Тест `tests/t3-agent06-external-process-original-t2.browser.mjs` используется **только** в публичном real-host CI с точным исходным квалифицированным T2 Kernel 0.3.6/Runtime Contract 1.3.0, одним оригинальным IndexedDB Store: обычная регистрация, создание Workspace штатным writer, ограниченный ERP-link writer, сохранение 1→2 через `base_revision`, отказ чужой схемы и stale revision, затем холодный Browser Host restart с `getObject` и `listEventsSince`. Эти данные синтетические и не являются корпоративными. Этот тест не создает новой платформы, T2 Store, второго Control и не удостоверяет реальный подписанный установленный Agent. Продолжение D1 и native CehoVod/ERPNext требует настоящего owner.

В новой ветке подключено тестирование существующим публичным `t3-core-source-qualification`. Не запускать приватные Actions и не повышать `T3_READY` до полного G4.

## Испытание непосредственно подписанного link -> original Host (следующая ревизия)

`tests/t3-agent06-external-process-original-t2.browser.mjs` теперь не ограничивается записью через `link.t1.putObject`: внутри публичного теста исходный `createTrustedExternalProcessLink` из `src/t3/external-process-link.mjs` вызывается на реальном `IWXA.connect({service_id:'iwxa.agent06.external-process'})` через строго тестовый Node→browser facade. Данный facade не содержит Store: каждый вызов `getWorkspace/getObject/putObject/listObjects/listEventsSince` передаёт в настоящий T2 Kernel 0.3.6 / IndexedDB. **D1 не имитируется**: `createTemporaryOriginalPersonalAuthority` создаёт тестовый Ed25519-подписанный Access на Node Host с проверяемыми currentContext, proof и STATUS. Продуктовые ключи и installed IAM не задействованы.

Проверяется цепочка: USER_CANCELLED → разрешённый link (revision=1) → повтор=ALREADY_LINKED → конфликт ERP source → согласованное refresh (revision=2) → отказ D6 принимать устаревший source Object → lost ACK после оригинального putObject (revision=3) → signed recover без повторной записи → отзыв персонального гранта (запрет нового вызова) → исходная D2 Activity с `epistemic_status=reported` и без ERP customer text → D6 native owner без durable receipt возвращает только OUTCOME_UNKNOWN, не создает Result → cold Host reopen → новая Ed25519 Access с подписанной проверкой original Object revision=3. Это реальный ORIGINAL Kernel и исходные D1/D2/D6 исходники, но **ERP-владелец и native n8n recipient в этом тесте остаются контролируемыми внешними портами**. Не выдавать этот тест за реальную операцию CehoVod или ERPNext.

Приёмка этого нового маршрута = PENDING до проверки точного HEAD в публичном CI; ранее на `c87b35cf` публичный `#43720094913` SUCCESS, но он проверял только оригинальный Kernel напрямую. При сбое ревизии исправить тест/код в этой ветке, не менять T3/Activity/Agent main branches.
