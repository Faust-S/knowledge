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

## Фактическая приёмка signed source link на ORIGINAL T2, 15.11.2026

Исполняемый source HEAD `213159efaefc863715a3e3252504f17ac22457f3`, TREE `c6f4d8688f7521c4af787f616807fe3bdd160005`.

Публичный оригинальный [GitHub Actions #43721311039](https://github.com/Faust-S/knowledge/actions/runs/43721311039) завершён **SUCCESS на точном source HEAD**:
- `test=SUCCESS`, `real-host=SUCCESS`, `windows-credential=SUCCESS`; `metal-webgpu=SKIPPED`.
- T3 product-core Node `730/730 PASS`; T3 product Workspace/DOM `1141/1141 PASS`.
- **Реальный ORIGINAL T2 0.3.6/Contract 1.3.0**, один IndexedDB Store, штатный сервисный паспорт, signed T3 D1 через временного Ed25519 TEST владельца и существующий `createTrustedExternalProcessLink`: `T3_AGENT06_SIGNED_D1_REAL_KERNEL_PROCESS_PASS`. Подтверждены `signedProofs=47`, `revision=3`, `originalActivityEvents=5`, `lostAckNoReplay=true`, `d6HttpAckRemainsUnknown=true`.
- Два последовательных исходных сеанса T2 browser Host: `T3_AGENT06_SIGNED_D1_COLD_RECOVERY_PASS` с новым временным Ed25519 владельцем, `revision=3`, `signedProofs=6`.
- Отказ `foreign schema`, `stale base_revision`, отмена Human Review, conflict external revision, D1 revoke, устаревшая D6 ссылка, невозможность повышения нативного HTTP ACK до `OWNER_READBACK_CONFIRMED` без настоящего owner receipt.
- Первый прогон #43721113055 доходил до подписанной исходной операции, но падал на устаревшем тестовом ожидании двух Event после добавления трёх новых; код исправлен `213159ef`, новый прогон полностью PASS.

**Не подменять статус:** подпись действительно построена оригинальным T3 Ed25519 Test Access с временными ключами на публичном CI; установленный продакшн T3 Host и его native signer НЕ запускались. Снимок внешней записи предоставляет контролируемый test `readExact` со значением `source_owner=erpnext:shop1`, реального ERPNext API, аккаунта, перехода CehoVod, подтверждённого native n8n `receipt/readback` и конечного доменного Result пока нет. `SOURCE_QUALIFICATION=PASS`, `ORIGINAL_T2_SIGNED_ROUTE=PASS_TEST_HOST`, `LIVE_ERP_EXECUTION=NOT_ACCEPTED`, `CEHOVOD_RESULT=NOT_ACCEPTED`, `T3_READY=false`.

Следующий интеграционный шаг, требующий владельца Agent: отдельный подписанный реальный `ERPNext.readExact` с API current revision + digest; использование текущего `adapters/n8n_workflow_v1.py` исключительно через Agent ToolRuntime и существующий журнал ToolExecutionCell. Только после настоящего durable owner `operationId, receipt, readback` допускать D6 `OWNER_READBACK_CONFIRMED`; CehoVod канонически выполняет `production-order → operation-execution → production-actuals / quality / defect → plan-fact Result`, не прямыми изменениями поля status. Проверить обрыв ACK, webhook duplicate, изменение записи внешним пользователем, отзыв подписанного гранта, холодный readback обоих owners и отдельную штатную .iwxa передачу. Не копировать приватный Agent в public T3.

## Дополнение: восстановление по самостоятельному подписанному read-only Access

Ранее `recover()/prepareContinuation()` требовали `accessForWrite('t1.putObject')`, хотя обе операции только читают original Kernel. Исправлено в рамках исходного `createTrustedExternalProcessLink`: необязательный `accessForRead('t1.getObject')` применяется к `getWorkspace/getObject`, независимо от grants на изменение. При отсутствии write provider read-only Host может вызвать `recover()/prepareContinuation()`, но `link()/refresh()` возвращают `T3_EXT_WRITE_NOT_GRANTED` **до** внешнего ERP чтения или Human Review. Write-owner по-прежнему проверяется штатным D1 при каждом original `t1.putObject`. Если оба порта отсутствуют, Host отказывает. Предыдущее подключение без отдельного read owner продолжает использовать write owner для чтения, пока установленный Agent не передаст независимый правомерный read Access.

Адресный исходный браузерный тест добавляет вторую подписанную PERSONAL authority с **только** `t1.getWorkspace/t1.getObject`; проверяет readback того же original T2 Object после отзыва write-гранта другого владельца и невозможность любой записи. Этот test signer является проверяемым ORIGINAL D1 в disposable Host, не продуктовой лицензией.

## BPMN 2.0: сопоставление модели с Process Intelligence без имитации факта

Добавлен ограниченный read-only import `inspectExternalBpmn2Model({xml,processId,workspaceId,DOMParser})` и `compareExternalBpmn2ToProcessDefinition({candidate,definition})` в исходный `src/t3/external-bpmn-model.mjs`. Это **не новый движок процессов** и не Flowable/Operaton workflow executor: стандартный браузерный DOMParser только извлекает BPMN namespace `http://www.omg.org/spec/BPMN/20100524/MODEL`, процесс, task IDs, gateways и sequenceFlows, без выполнения/деплоя/записи. XML ограничен 256 KiB, DTD и ENTITY запрещены; неоднозначный выбор нескольких процессов, неизвестные flow references, вложенные подпроцессы и сложные flow constructs отвергаются, не интерпретируются молча. Поддерживается только простая top-level task/sequenceFlow схема (включая Flowable namespace metadata, которое не исполняется). Версии и права внешнего процесса продолжают принадлежать BPM engine.

Любой результат имеет `status=UNTRUSTED_MODEL_NOT_EXECUTED`, `sourceTruth=false`, `observed=false`, даже если в XML `isExecutable=true`. Сопоставление с ORIGINAL нормализованным `IWXA_T2_PROCESS_DEFINITION_V1` только по **точным идентификаторам задач**, а не по хронологии/изображению BPMN. Результат `TASK_IDS_MATCH` или `REVIEW_MAPPING` и `conformance=NOT_EVALUATED`; это не Execution receipt, не фактическая Activity и не доменный Result. Только независимые события исходного owner с `evidenceRefs`, привязкой к Workspace/WorkRef и временной провенансом могут поступить в существующий `deriveProcessIntelligence`. Подключение Flowable/Operaton остается за Agent 0.6, без его ToolRuntime и секретов в T3.

Исходный `tests/t3-agent06-bpmn2-model.test.mjs` проверяет Flowable XML и опасные структуры. Реальный Flowable/Operaton engine и прямой импорт BPMN в предметные IWXA объекты **не квалифицирован**.

## Приёмка схем BPMN и независимого D1 чтения, 15.11.2026

**Точный исполняемый HEAD `f4708bea116c605bdd270815643c604acf395194`, TREE `32b2f895f23bba0315e73028e01590f57c612ba2`.** Публичный [GitHub Actions #43725567410](https://github.com/Faust-S/knowledge/actions/runs/43725567410) завершился `SUCCESS`: `test/real-host/windows-credential=SUCCESS`, `metal-webgpu=SKIPPED`. Node product core `737/737 PASS`, Workspace/DOM `1141/1141 PASS`; исходный T2 0.3.6 real-host с signed D1, Activity/D6 и раздельным read-only D1 grant `PASS`. В реальном Host логе: `T3_AGENT06_SIGNED_D1_REAL_KERNEL_PROCESS_PASS`, 47 подписанных proof, 5 Original Activity Event, revision 3, native ACK не равен Result; `T3_AGENT06_SIGNED_D1_COLD_RECOVERY_PASS`, 6 proof новой сессии и revision 3. BPMN модели прошли шесть адресных Node-проверок. Ранее чтение D1 было отдельно квалифицировано на `20d8d441` в [CI #43725296243](https://github.com/Faust-S/knowledge/actions/runs/43725296243).

### Проверенные BPMN владельцы и API для последующей интеграции Agent

**Flowable OSS:** [официальный REST API](https://www.flowable.com/open-source/docs/bpmn/ch14-REST) определяет `GET repository/process-definitions/{processDefinitionId}` (id, version, key, deploymentId, resource) и `GET repository/process-definitions/{processDefinitionId}/resourcedata` (исходный развернутый BPMN 2.0 XML). Вызывать Agent-пользовательским аккаунтом, закрепляя точный `processDefinitionId` и `version`. Возвращённый XML необходимо передавать в `inspectExternalBpmn2Model` **только для сопоставления**, не для исполнения.

**Operaton:** [официальный API и гарантии совместимости](https://docs.operaton.org/docs/documentation/introduction/public-api/), [процессные key/version](https://docs.operaton.org/docs/documentation/user-guide/process-engine/process-versioning/), [лицензия Apache 2.0](https://operaton.org/faq/). Отличать `processDefinition.key` внутри BPMN XML от ID развернутой версии, не выбирать незаметно newest/latest вместо версии заказа. Точный REST URL XML подтверждать по закреплённой версии Operaton при непосредственном подключении, а не переносить endpoint Flowable механически.

### Agent 0.6, точный следующий шаг без публичного копирования приватного кода

1. В штатном Agent Account Setup добавить выбранный пользователем ERPNext/Flowable/Operaton аккаунт и adapter `externalOwner.readExact` через действующие Account/ToolRuntime-порты; не создавать новый Token Store. `source_revision` и `source_digest` сверить с original provider response; HTTP GET не является долговременным receipt.
2. Для CehoVod сохранить точную связь `ERP sales order ID+sourceRevision+digest` → подписанная `Workspace` → канонический `production-order` / `operation-execution`, используя только исходные функции переходов CehoVod. Настоящий `WorkRef`/доменный `Result` допускается только после чтения его у оригинального владельца; `reported` ERP-событие не назначает статус `observed`.
3. Любое изменение ERP/n8n осуществлять штатным `Agent ToolRuntime` с отдельным Human Review; D6 `OWNER_READBACK_CONFIRMED` разрешать только после durable `operationId,receipt(COMMITTED),readback(PERSISTED)` с той же original reference/revision. `ACKNOWLEDGED`, timeout и transport 2xx остаются `OUTCOME_UNKNOWN`, без автоматического retry.
4. Через original T3/Activity проверить дубли событий, конфликт двух версий, отмену, потерю ответа, запрет записи и два cold opens; затем получить подлинный CehoVod Result и его независимый original Kernel readback. Только после этого `LIVE_ERP_EXECUTION` и `CEHOVOD_RESULT` могут стать PASS.

**Границы:** в текущей работе только `Faust-S/knowledge`, отдельная `work/2026-11-15-agent06-process-erp-integration`. Ветки T3/Activity/Agent и исходный T2 не менялись, приватные Actions не запускались. `LIVE_ERP_EXECUTION=NOT_ACCEPTED`, `CEHOVOD_RESULT=NOT_ACCEPTED`, `BPMN_MODEL_INSPECTION=SOURCE_PASS`, `T3_READY=false`.

## Offline-first: подписанное чтение сохранённой ERP-ссылки без подключения аккаунта

При отключённом интернете, недоступной ERP или после холодного перезапуска пользователь должен видеть свою сохранённую ссылку, но **не** подменять её последней подтверждённой ревизией ERP. В существующем `createTrustedExternalProcessLink` реализован `readSaved({expected_workspace_id,record_kind,record_id})`. Он использует ORIGINAL T2 `getWorkspace/getObject` с подписанным D1 Access; не вызывает внешние API, не выдаёт HTTP-запрос, не создаёт Task/Store/Result и не изменяет состояния. Доверенный Host передаёт зафиксированный `externalOwner.ownerId` (без `readExact`), чтобы определить тот же deterministic object_id. Сохранённое тело повторно валидируется по канонической схеме; чужая/удалённая запись и несоответствие данных не показываются как допустимая ссылка.

Ответ имеет `status=SAVED_UNVERIFIED`, original `workspace_id/object_id/revision`, последнее сохранённое `source_revision`, `source_state` и digest; обязательные флаги `owner_current=false`, `can_execute=false`, `epistemic_status=reported`. Это не T3 факт выполненного заказа и не независимая квитанция ERP. `recover()/prepareContinuation()` по-прежнему **требуют** онлайн `externalOwner.readExact` и запрещены без него (`T3_EXT_OWNER_ONLINE_REQUIRED`). `link()/refresh()` требуют подписанного write Access, без него `T3_EXT_WRITE_NOT_GRANTED` ещё до внешнего API.

UI-подсказка Agent/CehoVod: «Сохранена ссылка на заказ ERP. Данные ERP сейчас не проверены. Обновить сведения» и отдельное действие обновления только с явным разрешением пользователя. Не выдавать кэш за статус «Исполнено». В публичной оригинальной Host-квалификации добавлен read-only browser cold-reopen с физически отсутствующим `readExact`: original T2 объект доступен, D6 недоступен, новые записи не происходят.

## 15.11.2026: исходная автономность внешнего заказа, фактический результат CI

**Исполняемый коммит `53f408a94e154630bb8223c0ab2902dd656327d9`, TREE `b32ffa451f6a8afc1572e86a2ae30edbac8dcab7`.** Публичный [GitHub Actions #43726587459](https://github.com/Faust-S/knowledge/actions/runs/43726587459) = `SUCCESS`: Node `739/739 PASS`, Workspace/DOM `1141/1141 PASS`, `real-host`/original T2 0.3.6 и Windows Credential `SUCCESS`, hardware WebGPU `SKIPPED`. В оригинальном Kernel при холодном открытии: `T3_AGENT06_ORIGINAL_T2_OFFLINE_ERP_SNAPSHOT_PASS` с `revision=3,readOnly=true,ownerCurrent=false,canExecute=false`. Дополнительная D1-подпись на новом сеансе подтверждена: `T3_AGENT06_SIGNED_D1_COLD_RECOVERY_PASS`, `signedProofs=9`. Операция ERP отсутствует, и этот тест намеренно не имитирует исполненный Result.

**Новый интерфейс владельца:**

- `externalOwner:{ownerId}` с корректным ID достаточно для `readSaved()` в доверенном Host при отключённой сети; `readExact` для этого метода не требуется.
- `readSaved(reference)` возвращает только подписанное сохранённое состояние с `SAVED_UNVERIFIED`, `owner_current=false`, `can_execute=false`, `epistemic_status=reported`. Перед возвратом заново проверяются schema/version, identity, original T2 revision, имена полей и отсутствие неизвестных данных. Никакой нативный write, ToolRuntime, ERP GET и Result при этом не выполняются.
- `recover()` и `prepareContinuation()` требуют `readExact` (внешняя проверка) и без него строго отказывают `T3_EXT_OWNER_ONLINE_REQUIRED`. `link()/refresh()` требуют подписанного write Access, иначе `T3_EXT_WRITE_NOT_GRANTED`. Утраченные ERP credentials не позволяют создавать фиктивное состояние `LINK_PERSISTED`.

**Инструкция первому Agent/CehoVod владельцу, по фактически прочитанным исходникам:**

1. Зафиксировать в штатном аккаунте Agent только public account descriptor `ownerId=erpnext:<instance>`, а секреты оставить в существующем Account/ToolRuntime. Его trusted `readExact` получает ERPNext Sales Order с точным `name,modified` и вычисляемым digest однозначного снимка. При offline Account он передаёт тот же ownerId без readExact и получает сохранённую ссылку через `readSaved`. Не менять исходное правило `epistemic_status=reported`.
2. Оригинальный `Faust-S/cehovod@074dd31fa447870b9c876f3d45e65aace77e8df7` (предметная логика) создаёт immutable `production-order` только через `createProductionOrderFromDraft` и утверждённый draft; `production-lifecycle.ts` меняет фазу только `transitionProductionOrder`. Не строить `production-order` из статуса ERP и не менять статус прямым присваиванием.
3. Истинное производство: `createProductionExecution`, отдельные append-only `createProductionActuals` с `sequence`, сохранённые `quality-check-result` через `recordControlPointResult`, `defect-record` через `recordDefect`, все со строгими `production_order_ref` / `production_execution_ref`. Вендорный HTTP ACK не создаёт эти факты.
4. Последнее вычисление `assembleKernelPlanFact(rows,{orderId,executionId,final,actualsCompleteAcknowledged})` из `src/lib/kernel-plan-fact.ts` принимает только **уже авторизованные сохранённые T2 Kernel readbacks**: проверяет immutable план, единственную execution, последовательные append-only факты, наличие и качество источников. Свой `plan-fact-analysis` как отдельный доменный Result сохраняет оригинальный CehoVod owner; T3 не заменяет доменный алгоритм.
5. `D6 OWNER_READBACK_CONFIRMED` допустим только при исходном durable `operationId` + original owner `receipt(COMMITTED)` и `readback(PERSISTED)` с тем же `reference,revision,resultRef`; отдельно сверить `resultRef` с сохранённым у CehoVod `plan-fact-analysis`. При потере ACK только чтение; повтор n8n webhook/ERP действие запрещён. После холодного открытия читать тот же оригинальный Result и оригинальную Activity; не считать журнал `sessionStorage` самостоятельным подтверждением T2. Текущий потребитель T2 — `Faust-S/cehovod.ru@work/2026-10-23-t2-site-only`, на момент проверки HEAD `9148b46c40efbf0c5d679b360c9a4f608c128634`.
6. Отдельно проверить (а) дубль события, (б) конфликт ERP modified/revision, (в) потерянный ответ внешнего workflow, (г) отказ подписанной записи, (д) независимый импорт original `.iwxa` в новый получатель. До этого `LIVE_ERP_EXECUTION=NOT_ACCEPTED`, `CEHOVOD_RESULT=NOT_ACCEPTED`, `T3_READY=false`.

**Границы:** этот поток меняет только отдельную ветку `Faust-S/knowledge@work/2026-11-15-agent06-process-erp-integration`, не изменяет Agent 0.6/Activity/T3 main и не запускает private Actions. Встраивание в приватный Agent и реальное исполнение ERP требуют отдельного штатного интеграционного шага на стороне владельца Agent, а не переноса секретов/ToolRuntime в публичный T3.

## 15.11: второй независимый owner для проверки канонического CehoVod Result

После самостоятельного аудита D6 выявлено: `OWNER_READBACK_CONFIRMED` проверяет только durable `nativeOwner.receipt/readback` и `resultRef`, но НЕ гарантирует существование и полноту предметного Result CehoVod. Реализована **необязательная** read-only проверка через оригинальный установленный доменный владелец: `createTrustedNativeContinuation({...,resultOwner:{ownerId,resultType,orderRef,verifySaved}})`. Старые получатели без `resultOwner` сохраняют прежний статус `OWNER_READBACK_CONFIRMED`, но он не означает предметной приёмки.

`resultOwner.verifySaved({resultRef,operationId,recipientId,sourceReference})` разрешено вызывать **только после** совпадения исходных native `receipt(COMMITTED)/readback(PERSISTED)`, с теми же OperationId, RecipientId, ResultRef и подписанной T2 source Object revision. Вызов выполняется через доверенный Host, не из UI, и не вызывает внешнее действие. Для CehoVod владелец обязан вызвать существующий **`verifyStoredFinalPlanFact(rows,saved,orderId)`** из `Faust-S/cehovod/src/lib/kernel-plan-fact.ts` на своих независимо прочитанных оригинальных Kernel rows. Т3 не дублирует этот алгоритм и не сохраняет его данные. Возвращаемый владельцем нормализованный proof должен совпадать по `resultRef`, `ownerId`, `resultType`, `orderRef`, `workspaceId`, `operationId`, `recipientId`, `sourceReference`, `stage=final`, `resultRevision>0` и `canonicalVerified=true`; T3 повторно читает подписанный источник после этой проверки.

При отсутствующем/ошибочном доменном readback результат **`DOMAIN_RESULT_UNVERIFIED`**, `owner_action_confirmed=true`, `domain_result_confirmed=false`, `can_retry=false`; это не команда повторить n8n/ERP и не успешный CehoVod Result. Только после совпадения двух независимых владельцев возвращается `DOMAIN_RESULT_READBACK_CONFIRMED`. Отсутствие самого native receipt остаётся `OUTCOME_UNKNOWN`. Статус `DOMAIN_RESULT_READBACK_CONFIRMED` подтверждает договор доверенных read-only owner ports, а не установленный production ERPNext; до реального CehoVod Host и пользователя `CEHOVOD_RESULT=NOT_ACCEPTED`.

В тестовом source-fixture callback `verifySaved` эмулирует контракт настоящего CehoVod verifier, поэтому квалификация новых правил **не** является испытанием настоящего доменного Result. Позднее отдельный Agent/CehoVod integrator должен подать оригинальные сохранённые `KernelPlanFactRow[]` в `verifyStoredFinalPlanFact`, передать в D6 только нормализованный proof и выполнить readback после двух cold opens, включая дубли и ошибочную ревизию. Никакой новый Store/Task Engine/Process Engine, IAM или private Action не создаётся.

## Оригинальный T2 Host: проверка двух владельцев на источнике D6

Адресный тест `tests/t3-agent06-external-process-original-t2.browser.mjs` дополнительно выполнит следующую цепочку на оригинальном T2 Kernel 0.3.6 с настоящими подписанными D1 reads:

1. n8n `ACKNOWLEDGED` без durable receipt → `OUTCOME_UNKNOWN`, `verifySaved` не вызывается;
2. после появления native `receipt(COMMITTED)/readback(PERSISTED)`, но до доказательства CehoVod Result → `DOMAIN_RESULT_UNVERIFIED` + `can_retry=false`;
3. при тестовом `verifySaved`, дополнительно читающем актуальный original T2 source Object через signed D1, → `DOMAIN_RESULT_READBACK_CONFIRMED`;
4. после холодного browser Host reopen / новой D1 подписи повторный независимый readback возвращает тот же статус, `n8n` dispatch остаётся единственным.

Важное ограничение: в этом публичном CI `resultOwner.verifySaved` - **контрактный double**, поскольку канонический `Faust-S/cehovod` приватный и не переносится в публичную `knowledge`. `syntheticDomainOwner=true` в CI логе. Никакой демонстрационный Result не объявлять настоящим; только отдельная подключенная установка CehoVod с его исходным `verifyStoredFinalPlanFact` может закрыть `CEHOVOD_RESULT`.

## Финальная квалификация двух владельцев, исходный CI от 15.11.2026

**Исполняемый HEAD `c3da0efa8cb998e8e0d0b3a2f9db25b5d9027a9d`, TREE `1dccae00ea28d6dd65732db4f7127866e015b902`.** Публичный оригинальный [CI #43727539506](https://github.com/Faust-S/knowledge/actions/runs/43727539506) = `SUCCESS`: `test=SUCCESS`, `real-host=SUCCESS`, `windows-credential=SUCCESS`, hardware `metal-webgpu=SKIPPED`. В полном product source qualifier Node `741/741 PASS`, Workspace/DOM `1141/1141 PASS`, исходный T2 Kernel 0.3.6/Runtime Contract 1.3.0 PASS. Это второй успешный прогон после первого [CI #43727308430](https://github.com/Faust-S/knowledge/actions/runs/43727308430), который уже подтвердил новый runtime-контракт D6 до расширения real-host теста.

Из точного исходного real-host лога:
`T3_AGENT06_D6_TWO_OWNER_CONTRACT_PASS` → `originalKernel=true`, `signedD1=true`, `syntheticDomainOwner=true`, `externalDispatches=1`, `domainProofs=2`, `domainResultInCehoVod=false`.
`T3_AGENT06_SIGNED_D1_REAL_KERNEL_PROCESS_PASS` → `signedProofs=55`, `originalActivityEvents=5`, `revision=3`, `lostAckNoReplay=true`.
`T3_AGENT06_SIGNED_D1_COLD_RECOVERY_PASS` → `revision=3`, `signedProofs=13`, `executedExternalERP=false`.

**Что подключает оригинальный Agent/CehoVod владелец, без создания движка:**

- Выбрать конкретный `ProductionOrderRecord.object_id` из настоящей CehoVod Workspace; ERP-ссылка `sourceReference` из `prepareContinuation` и `orderRef` должны быть согласованы у доверенного владельца, а не взяты из редактируемого поля UI.
- Штатный `Agent ToolRuntime`/n8n остаётся исполнителем разрешённой операции, его durable `operationId` и `receipt/readback` даются в существующий D6 `nativeOwner`; HTTP ACK и локальная квитанция отправки не становятся COMMITTED.
- Доменный `resultOwner.verifySaved` внутри штатного CehoVod Host получает `resultRef` от `nativeOwner`; читает **оригинальным авторизованным T2 Kernel** конкретный saved `plan-fact-analysis`, `production-order`, `production-execution`, append-only `production-actuals`, результаты контроля, дефекты и другие обязательные источники.
- Вызвать **существующий** `verifyStoredFinalPlanFact(rows,saved,orderId)` из `Faust-S/cehovod/src/lib/kernel-plan-fact.ts`. Только `true` по оригинальному readback допускает нормализованный `ORIGINAL_DOMAIN_RESULT_VERIFIED` с точными `resultRef,orderRef,resultType,workspaceId,sourceReference,operationId,recipientId,stage=final,resultRevision>0,canonicalVerified=true`.
- Выполнить как минимум две независимые холодные проверки D1/D6/Result, включая `RECOVER_ONLY` при lost ACK, чужой `orderRef`, конфликт source revision, неполный QC/actuals и отзыв подписанного read grant. **Не** вызывать `receive()` повторно, если native owner уже подтвердил действие.
- После полученного подтверждения отдельно сверить оригинальную Activity: пять `reported` T3 ERP events **не равны** ни одной реально произведённой операции. Производственные `observed` events допускаются только по исходным CehoVod фактам, с WorkRef и evidence в его собственном подписанном Host.
- Только затем `LIVE_ERP_EXECUTION` и `CEHOVOD_RESULT` можно переводить из `NOT_ACCEPTED`; сейчас source-порт `PASS`, `ORIGINAL_T2_SIGNED_ROUTE=PASS_TEST_HOST`, `LIVE_ERP_EXECUTION=NOT_ACCEPTED`, `CEHOVOD_RESULT=NOT_ACCEPTED`, `T3_READY=false`.

**Существенная граница квалификации:** public CI проверял оригинальный T2 Kernel/D1/D6 и подписанные чтения источника, но CehoVod owner и n8n/ERPNext были *контрактными тестовыми портами*. Приватные исходники CehoVod и Agent не копировались в публичный репозиторий, Actions приватных репозиториев не запускались; настоящая корпоративная ERP, реальные документы, физические факты и canonical `plan-fact-analysis` НЕ выполнялись и НЕ объявлены принятыми.

## D6: предотвращение отправки устаревшего заказа после Human Review

Обнаружен реальный функциональный разрыв: `external-process-link.prepareContinuation` проверяет source revision/digest в момент открытия задачи, но заказ ERP может быть изменён другим оператором пока пользователь подтверждает действие. Исходный D6 уже перепроверял оригинальный T2 Object, но это **не** означает, что заказ всё ещё актуален в ERP. При установленном доверенном портe `sourceCurrent(reference)` D6 **после Human Review** и **после последнего поиска owner-native receipt**, но **до единственного native `receive()`** повторно вызывает уже существующий `external-process-link.prepareContinuation({expected_workspace_id,record_kind,record_id})`. Это повторно проверяет настоящий `externalOwner.readExact`, digest, identity и подписанное original T2 readback. D6 сравнивает ровно четыре поля ORIGINAL `workspace_id/object_id/schema_id/revision`; `readSaved` со статусом `SAVED_UNVERIFIED` никогда не является разрешением записи.

При изменении ERP, отсутствии аккаунта, сбое/отзыве подписанного чтения или чужой source reference D6 возвращает `T3_D6_EXTERNAL_SOURCE_NOT_CURRENT` **без вызова receive, без добавления dispatched и без признания UNKNOWN результата**. Для новой попытки пользователь сначала отдельно согласует `refresh` исходной ERP-ссылки в штатном T3. Если действие уже могло уйти, этот callback нельзя применять к восстановлению: `D6.recover()` по-прежнему получает оригинальную квитанцию/readback даже если ERP изменилась после предыдущего исполнения; автоматически повторять нельзя.

Это опциональный read-only callback исходного **trusted Agent Host**, не новый аккаунт, клиент ERP, Process Engine, ToolRuntime или IAM. Для любого внешнего write Agent 0.6 должен подключить штатный `sourceCurrent`; остальные D6 потребители (например Atlas) могут его не использовать. ERP owner должен повторно проверять свою CAS-ревизию уже на стороне native `receive` из-за неатомарности remote preflight + mutation.

Проверки: Node-тесты об изменении ERP **во время** Human Review, offline owner, подмене fresh Reference / stale local T2 revision и original T2 0.3.6 signed Host-тест. `SOURCE_QUALIFICATION=PENDING` до результата публичного CI на точном исполняемом HEAD. Реального ERPNext аккаунта этот тест не эмулирует.

## D6 ERP revision race: точный результат квалификации 15.11.2026

**Исполняемый HEAD `9310a9a09bf361e29f95f8b913e75fec76be8963`, TREE `74738f4a4a96f9d841f623346921044858751abf`.** Публичный [GitHub Actions #43729354592](https://github.com/Faust-S/knowledge/actions/runs/43729354592) полностью `SUCCESS`: product-core Node **743/743 PASS**, Workspace/DOM **1141/1141 PASS**, original real-host и Windows Credential **SUCCESS**, аппаратный WebGPU **SKIPPED**. Предшествующее `SOURCE_QUALIFICATION=PENDING` теперь заменено точным подтверждением `SOURCE_QUALIFICATION=PASS` на этом исполняемом SHA.

Адресный original signed Host-тест прошёл с запретом отправки после изменения ERP `source_revision` **между Human Review и native dispatch**, затем успешной независимой проверкой того же source через существующий `sourceCurrent -> external-process-link.prepareContinuation`. Оригинальный Kernel 0.3.6/Contract 1.3.0: `T3_AGENT06_SIGNED_D1_REAL_KERNEL_PROCESS_PASS`, `signedProofs=62`, `revision=3`, `originalActivityEvents=5`, `lostAckNoReplay=true`. После холодного открытия: `T3_AGENT06_SIGNED_D1_COLD_RECOVERY_PASS`, `signedProofs=13`, `revision=3`. Отдельный `T3_AGENT06_D6_TWO_OWNER_CONTRACT_PASS`: `externalDispatches=1`, `domainProofs=2`, **`syntheticDomainOwner=true`**, `domainResultInCehoVod=false`.

**Конкретная стыковка в Agent 0.6, не изменяя общую ветку:**
`sourceCurrent: async ref => trustedExternalLink.prepareContinuation({expected_workspace_id: ref.workspace_id,record_kind: selectedOriginalRecordKind,record_id: selectedOriginalRecordId})`, где тип/ID берутся из выбранной исходной привязки trusted Host (а не из произвольного renderer). В обычном workflow это обязательный порт; без него исходный generic D6 сохраняет обратную совместимость для иных получателей (Atlas). После `T3_D6_EXTERNAL_SOURCE_NOT_CURRENT` показать пользователю «Заказ изменился в ERP, обновите ссылку перед выполнением», дать только согласованный `refresh`. При native `OUTCOME_UNKNOWN` показывать восстановление у владельца, не повторную отправку.

**Не принимать source test за реальную ERPNext:** test `readExact` и n8n/CehoVod recipients являются управляемыми тестовыми портами, несмотря на настоящий оригинальный T2 Kernel/D1. `LIVE_ERP_EXECUTION=NOT_ACCEPTED`, `CEHOVOD_RESULT=NOT_ACCEPTED`, `T3_READY=false`. Пользовательское подключение ERP/производственные факты/WorkRef и независимый canonical `verifyStoredFinalPlanFact` остаются обязательным следующим интеграционным шагом у установленных Agent/CehoVod владельцев.
