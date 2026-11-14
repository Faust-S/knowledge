# IWXA T3 One Core. D3, точные подтверждения асинхронного Host, передача 14.11.2026

## Дополнение 14.11.2026: D4 открытие `.iwxa` в установленной PWA и D1 общий входной Host

**Последняя исполняемая ветка**: `Faust-S/knowledge@90bf76b3871cfd7aa7040f1b4d8de82fd5409dac`.

**D4 функциональность:** в исходной `scripts/t3-pwa-manifest.mjs` установщик PWA объявляет обработчик `.iwxa` **только** при наличии `workspace/exchange/index.html` и активного модуля `iwxa.workspace.exchange` в `workspace/workspace.config.json`; необновлённые продукты без Exchange не меняются. В `PackagesView` используется штатный браузерный `launchQueue.setConsumer` и переход на существующую вкладку «Импортировать», без второго маршрута или импортёра. `ImportView` показывает полученный системный FileHandle; его `getFile()` и оригинальный `importPreview` разрешены лишь по явному нажатию пользователя, `importCommit` остаётся отдельным действием после просмотра. Обычный импорт файла, оригинальный `.iwxa` и original Kernel 0.3.6 неизменны. Коммиты [`867b2de`](https://github.com/Faust-S/knowledge/commit/867b2de671e7ff08e799d381934e5df2e7d126a8) и [`5580e54`](https://github.com/Faust-S/knowledge/commit/5580e547689193c23493977eb9f301aa51c38291); [CI #43588677494](https://github.com/Faust-S/knowledge/actions/runs/43588677494), [CI #43588766684](https://github.com/Faust-S/knowledge/actions/runs/43588766684) и [PWA Linux/Windows #43588677445](https://github.com/Faust-S/knowledge/actions/runs/43588677445) SUCCESS. Важно: ни один из этих CI не доказал **системное открытие двойным щелчком .iwxa через установленную Windows PWA**; `D4_TWO_INSTALLED_PRODUCTS=NOT_ACCEPTED`.

**D1 функциональность:** [`e0dc7be`](https://github.com/Faust-S/knowledge/commit/e0dc7beb04e7fedd5d1d39d899b145fd5401c9f0) дополнил existing `original-control-http-handler.mjs`: в подписанном split-origin Host запрещены raw HTML entries `/`, `/workspace/`, Exchange, Lifecycle, Studio и isolated signed HTML на доверенном Kernel origin. Ранее проверялся только `/workspace/index.html`. [`90bf76b`](https://github.com/Faust-S/knowledge/commit/90bf76b3871cfd7aa7040f1b4d8de82fd5409dac) исправил dispatch существующего настоящего browser Host: сначала существующий original Control handler для любого URL, потом штатная static fallback; иначе альтернативные страницы обходили запрет. Original T2 с неподписанным режимом, исходный Kernel, Store и T2 capabilities не подменялись. [CI #43588940414](https://github.com/Faust-S/knowledge/actions/runs/43588940414) SUCCESS. На финальном `90bf76b` запущен [CI #43589055301](https://github.com/Faust-S/knowledge/actions/runs/43589055301) FAIL (неправильно расположенная browser assertion, 404 вместо 403 до включения signed Host); [коммит `a0aa84e`](https://github.com/Faust-S/knowledge/commit/a0aa84ef7160fb24e2182d2e0560cf1107f217ee) перенёс проверку после установки настоящего signed Host. Финальный [CI #43589268606](https://github.com/Faust-S/knowledge/actions/runs/43589268606) = **SUCCESS** на точном исполняемом `a0aa84ef7160fb24e2182d2e0560cf1107f217ee` (675/675 Node, 1121/1121 Workspace/DOM, real-host и windows-credential PASS; metal-webgpu SKIPPED). Проверенный исходник не означает полную native Store/issuer приёмку D1. Полная установленная native Store boundary/issuer still `D1_PRODUCT_NATIVE=NOT_ACCEPTED`.

**Дальше:** не увеличивать тесты уже работающего транспорта/PWA. Следующая содержательная задача `D3`: только правомерный original private Reconciliation owner и настоящий Human Review/Accept, **отдельный** Apply в ORIGINAL Kernel, запись квитанции и холодное чтение. Нельзя копировать приватный код в публичный `knowledge`, писать его суррогат, отдельный Windows T3 Control или второй Kernel/Store/Exchange. `T3_READY=false`, `G4=NOT_ACCEPTED`.



## Дополнение 14.11.2026: D5 выбор локальной модели в едином Host

**Исполняемый исходник:** `Faust-S/knowledge@4cfa43a7ddf1b466374a150428c79d87bcea8539`. [GitHub Actions #43587738425](https://github.com/Faust-S/knowledge/actions/runs/43587738425) = **SUCCESS**: 674/674 Node product tests, 1121/1121 Workspace/DOM, `real-host` и `windows-credential` PASS. `metal-webgpu` SKIPPED: аппаратная WebGPU генерация модели ещё не подтверждена.

Действующий D5 теперь использует **один** pinned upstream WebLLM `0.2.87` и одну модель одновременно. Пользователь может выбрать SmolLM2 360M Instruct q4f32_1 (~580 МБ GPU) либо SmolLM2 1.7B Instruct q4f32_1 (~2693 МБ GPU), явно разрешить и подтвердить скачивание именно выбранной модели, проверить индивидуальный CacheStorage и запустить из кеша без сети. Общий автономный `t3-sw.js` разрешает только точные пары репозиторий весов / совместимая WebGPU WASM в пределах временного consent. Никакой новый Store, inference engine или формат `.iwxa` не создавались. Максимум токенов ответа в UI увеличен с 256 до 1024 (первоначально выбирается 256); Result продолжает сохраняться только отдельным нажатием через ORIGINAL Kernel в статусе `DRAFT_UNTRUSTED`.

Изменение D5 в основном `knowledge` означает, что исходный BLI1 больше нельзя называть source-identical. `integration-sources/bli1/SOURCE_PIN.json` сохраняет оригинальный исторический `Faust-S/T3@680375c9`, все 15 текущих Git blob и для семи изменённых файлов отдельно `upstream_blob`. Компилятор проверяет реальные исполняемые SHA. Промежуточный CI обнаружил устаревший pin и тип функции установки; исправления вошли в коммиты [`d7ffd9f`](https://github.com/Faust-S/knowledge/commit/d7ffd9f31c5554a6722c17ecdb8548a24191e810), [`a4de366`](https://github.com/Faust-S/knowledge/commit/a4de366a233f4e082b78f68ca9bb74e720e2a994), [`4cfa43a`](https://github.com/Faust-S/knowledge/commit/4cfa43a7ddf1b466374a150428c79d87bcea8539). Последний CI SUCCESS, дополнительные тестовые подсистемы не создавались.

**Следующая предметная работа:** сквозной D3 `signed Task → selected Result → Human Review → ACCEPT → отдельный APPLY → original Kernel receipt/cold reopen` с исходным владельцем Reconciliation, который остаётся в закрытом историческом T3. Без разрешения на публикацию его исходника нельзя копировать его в публичный `knowledge`; второй engine запрещён. Альтернативно закрывать следующую реальную функциональную дельту D5/D6/D7. `D3_END_TO_END=NOT_ACCEPTED`, `D5_HARDWARE_WEBGPU=NOT_ACCEPTED`, `G4=NOT_ACCEPTED`, `T3_READY=false`.



## Дополнение 14.11.2026: D3 штатный двухсторонний readback без нового Reconciliation

**Исполняемый исходник:** `Faust-S/knowledge@33c1af93fd2eda650269abbd89a4ab162480341f`. Коммиты: [`c761895`](https://github.com/Faust-S/knowledge/commit/c7618950e49766c4c7c905f9dbda5040fe7e44db), [`59f8bc1`](https://github.com/Faust-S/knowledge/commit/59f8bc17e2d196f5e19fe087c801da9c44ebe6f7), [`33c1af9`](https://github.com/Faust-S/knowledge/commit/33c1af93fd2eda650269abbd89a4ab162480341f).

В существующих `site-handoff/host-receiver.mjs`, `site-handoff.mjs`, `site-restore.mjs` появился **обязательный для включившего его T3-владельца** readback original Kernel: `verifyAppliedBeforeSend(raw)`, `verifyAppliedReceipt(raw,ownerResult)`, `verifyAppliedAfterRestore(raw,result)`. Проверка назначается доверенным Host/доменом и может быть асинхронной. Отказ/незавершённая запись/потеря подтверждения не дают положительную квитанцию. Host с активным строгим режимом различает `WRITE_RECEIPT_SITE_APPLIED_VERIFIED` и `WRITE_RECEIPT_SITE_APPLICATION_NOT_CONFIRMED`. Старый T2 `void` callback работает без изменения, но его ACK **не объявляется проверенным применением**. Исходный protocol `IWXA_T2_SITE_HANDOFF/1` и формат `.iwxa` сохранены; добавлено лишь необязательное поле подтверждения на сообщении ACK.

**Квалификация**: [Actions #43586505059](https://github.com/Faust-S/knowledge/actions/runs/43586505059) = SUCCESS; [Actions #43586614456](https://github.com/Faust-S/knowledge/actions/runs/43586614456) = SUCCESS; [Actions #43586755907](https://github.com/Faust-S/knowledge/actions/runs/43586755907) = **SUCCESS** на точном `33c1af93fd2eda650269abbd89a4ab162480341f`, TREE `8107e1a6f0883fb1d50865566c30ec884283ca2d`. Node product 674/674, Workspace/DOM 1121/1121, `real-host` и `windows-credential` PASS. Metal/WebGPU **SKIPPED**. Это Host transport-qualified code, не D3 owner E2E или G4.

**Недостающая продуктовая работа D3:** настоящий приватный owner `Faust-S/T3/reconciliation` предоставляет `OfflinePackageReconciler.receive/preview/accept/inspectApplicationProjection` и `application-host-binding`, но не входит в публичный runtime `knowledge` и не подлежит копированию сюда. Реальный владелец Admin/PERSONAL должен передать проверяемые signed Task/selected Result в текущий Host; подписанное `ACCEPT` не является `APPLY`. Последующее Application проходит отдельно через штатный JIT и оригинальный Kernel `commitObjectGraph`/readback/cold reopen. Колбэки readback из этого изменения позволяют честно подтверждать результат, но **сами не исполняют Reconciliation или Apply**; `D3_END_TO_END=NOT_ACCEPTED`.

**Правило продолжения:** не добавлять тестовых хранилищ, сценариев-посредников или новой universal Windows T3 программы. Следующая инженерная правка только там, где доступен действительный owner и исполняемый Apply; иначе перейти к следующему невыполненному D1–D7 продукту. Базовые T2 и `.iwxa` оставлять без переписывания.



## Актуализация 14.11.2026: готовый пользовательский импорт D4, без промежуточных подсистем

**Последний исполняемый qualified source:** `Faust-S/knowledge@cb30b30efef44d017878f09857e81b8f746700c1`. [Actions #43585691465](https://github.com/Faust-S/knowledge/actions/runs/43585691465) COMPLETED SUCCESS: `test`, `real-host`, `windows-credential`; `metal-webgpu` SKIPPED. Node product `672/672` PASS, Workspace/DOM `1121/1121` PASS. Документационный коммит после этого не изменяет исполняемый source.

**D1:** `34f8db31bfcf771ac1006b09bac5fa03cb8ba69b` [Actions #43583089313](https://github.com/Faust-S/knowledge/actions/runs/43583089313) SUCCESS: исходный same-origin signed Workspace больше не загружает React или Kernel, доверенный Host перенаправляет в canonical isolated UI; обычные `/workspace/` и `/workspace/index.html` в signed product route закрыты. Полный native Store/issuer acceptance по-прежнему не заявлен, нельзя возвращать старый UI.

**D4:** [`67c74c7`](https://github.com/Faust-S/knowledge/commit/67c74c75c76436bd3ba81de904c41f9339774f95) добавил выбор штатного `merge` при переносе source `.iwxa` из другой Workspace в одну действительно доступную локальную и оригинальный Kernel readback после `importCommit`. [`9364e44`](https://github.com/Faust-S/knowledge/commit/9364e44331f415e6ebec4bee10347fd6e2b3d0da) исправил опасное смешение неполного импорта с неопределённой записью: состояния `incomplete` и `unconfirmed`, сохранение подлинной квитанции даже при конфликте digest, запрет автоматического повтора/«отмены» уже потенциально совершённого импорта. [`cb30b30`](https://github.com/Faust-S/knowledge/commit/cb30b30efef44d017878f09857e81b8f746700c1) поправил устаревшее ожидаемое состояние старого регрессионного теста. Не создавать ещё одну проверочную подсистему; D4 двух разных установленных products остаётся NOT_ACCEPTED.

**Следующий предметный шаг:** оригинальный Reconciliation остаётся внутри закрытого исторического `Faust-S/T3`, именно он выполняет `receive → preview → accept` и готовит отдельный `application-host-binding`. До официального доступа к owner-коду в рабочем T3 нельзя ни копировать private source в открытый `knowledge`, ни писать второй reconciliation engine. Подключить owner как штатную capability доверенного Host, реализовать реальную связку `signed Task → selected Result → Human Review → ACCEPT → отдельно APPLY → original Kernel receipt/cold reopen` без автоматической выдачи полномочий из transport ACK. Не делать ещё один Windows EXE, Store, Exchange или IAM. При невозможности легального доступа к owner коду прогрессировать по другим D1–D7 функциональным дельтам, не тратить время на параллельную имитацию.

**Решения:** `D1_PRODUCT_NATIVE=NOT_ACCEPTED`, `D3_END_TO_END=NOT_ACCEPTED`, `D4_TWO_INSTALLED_PRODUCTS=NOT_ACCEPTED`, `D5_HARDWARE_WEBGPU=NOT_ACCEPTED`, `G4=NOT_ACCEPTED`, `T3_READY=false`.



## Ревизия продукта 14.11.2026: изменение приоритета

Результаты полной проверки B0/D1–D7/G4, обнаруженные defects и нормативный конечный план: [T3_PRODUCT_ENGINEERING_AUDIT_2026_11_14_RU.md](../docs/T3_PRODUCT_ENGINEERING_AUDIT_2026_11_14_RU.md).

**До продолжения D3 обязательно закрыть D1 raw Kernel bypass**: опубликованный browser witness `T3_D1_RAW_ORIGINAL_KERNEL_BYPASS_CONFIRMED_NOT_ACCEPTED` зафиксировал реальное same-origin чтение чужой Workspace через `IWXA.connect` в подписанном режиме. Отдельный изолированный UI origin решает проблему только на поддерживаемом split-origin маршруте. До общей подтверждённой границы и сохранения всех исходных T2 capabilities `D1_PRODUCT_READY=false`, `G4=NOT_ACCEPTED`. Нельзя выдавать успешный CI или тестовую визуальную изоляцию за продуктовую субъектность.

В коммите `5ba9fc469b5c78361c264943cb50f4b713f5edb1` исправлены явные HOLD/BLOCKED/false/null в штатных transport receipt; [CI #43579800166](https://github.com/Faust-S/knowledge/actions/runs/43579800166) = SUCCESS, 671/671 Node product tests, `real-host` и `windows-credential` PASS. Параллельные коммиты D3/D2 после этого коммита проверять по их собственным exact CI. Старый исходник handoff ниже остаётся историческим: обновление имеет приоритет для выбора следующей работы.

## Обновление 14.11.2026: D3 transport, verified exact source

**Квалифицированный исполняемый исходник:** `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`, коммит `2cf200ad0f1beb4c783ff89b6ba2a3c2aa5308bb`, TREE `d5d2fa68171e6573efddc11e9e854f27b7c0452b`. [GitHub Actions #43578735999](https://github.com/Faust-S/knowledge/actions/runs/43578735999): **COMPLETED SUCCESS**: `test`, `real-host`, `windows-credential`; `metal-webgpu=SKIPPED`. В `test` подтверждены `668/668` Node product tests, включая три новых сценария границы D3, без FAIL. Следующий документационный коммит не является новым исполняемым кандидатом. Повторно проверить live HEAD/TREE перед продолжением.

**Исправлены действительные ошибки Host, без второго Reconciliation/Store/Engine:**
- [`3479903`](https://github.com/Faust-S/knowledge/commit/347990349a0a9e713ec9675988c08074369b718d): `site-handoff` больше не отправляет `APPLIED`, если `onReceipt` явно возвратил `false`, отказ или незавершённое состояние. `host-receiver` не разрешает отправку квитанции после отклонённого `onPreview`. Существующие void callbacks сохранены. [Actions #43578629595](https://github.com/Faust-S/knowledge/actions/runs/43578629595) SUCCESS.
- [`97c2352`](https://github.com/Faust-S/knowledge/commit/97c2352e956c85e127d20eeaffeb3ca9377d6627): входной `validateSource` не может передавать в UI пустой или явно отклонённый candidate. Неизменённый протокол; no release/status claims. [Actions #43578687445](https://github.com/Faust-S/knowledge/actions/runs/43578687445) SUCCESS.
- [`2cf200a`](https://github.com/Faust-S/knowledge/commit/2cf200ad0f1beb4c783ff89b6ba2a3c2aa5308bb): раздельно обрабатываются ошибка ДО вызова сохранения и ошибка ПОСЛЕ входа в local writer/Kernel readback. Во втором случае статус `WRITE_RECEIPT_APPLICATION_NOT_CONFIRMED`, а не ложное `SOURCE_UNCHANGED`. Регрессия проверяет выброшенную ошибку после уже возможной записи. [Actions #43578735999](https://github.com/Faust-S/knowledge/actions/runs/43578735999) SUCCESS.
- Для асинхронных `validateSource/onPreview/onCandidate` обновлены существующие `.d.mts` контракты. Нового Task Engine, Approval API, независимого IWXА-формата или специальной T3 программы не создано.

**Граница результата:** это штатный *транспорт* предложений и подтверждений, а не доказательство `D3_END_TO_END`. Сама передача, `preview` и даже успешное `accept` в исходном Reconciliation **не** осуществляют `Apply` в предметный Kernel. Никаких новых product/native PASS.

**Одна следующая зависимость D3:** действующий исторический owner `Faust-S/T3/reconciliation/engine.mjs` уже имеет `OfflinePackageReconciler.receive/preview/accept/inspectApplicationProjection`; его `application-authorization-observer.mjs`, `application-effect-snapshot.mjs`, `application-host-binding.mjs` формируют отдельный application JIT, sealed effect и независимую проверку Human Review. **Не копировать приватные исходники в открытый knowledge и не писать заменяющий Reconciliation.** Связать именно эти штатные владельческие функции с доверенным Host-портом T3, выбранным Result и оригинальным T2 Kernel/Store. Сквозная приёмка: подписанная Task с конкретной revision → selected Result от иного root → explicit Human Review/Accept → отдельное Apply → original Kernel receipt и cold reopen; отказ при wrong recipient/key/role, stale revision и replay. Настоящую установленную интеграцию Agent/Admin выполнять в их owner-среде, не делать T3 Windows Control EXE.

**Статус:** `D3_END_TO_END=NOT_ACCEPTED`, `D4_PUBLIC_TWO_PORTS=PASS`, `D4_PRODUCT_NATIVE=NOT_ACCEPTED`, `T3_READY=false`, `G4=NOT_ACCEPTED`. Результаты старых разделов ниже оставлены как исторические, это обновление имеет приоритет по CI и HEAD.



## 1. Обязательное начало следующего чата

Сначала прочитать этот документ, корневой AGENTS.md репозитория knowledge, архитектурную карту 42 репозиториев в Faust-S/T3@work/2026-11-10-t3-t2-upgrade-core/architecture/T3_ONE_CORE_ALL_DOMAINS_SOFTWARE_AI_SOURCE_MAP_2026_11_11_RU.md и план B0/D1-D7/G4 в том же репозитории. Прочитать также предыдущий handoff packages/t3-core/handoff/T3_ONE_CORE_D4_TWO_CONSUMERS_2026_11_13_NEXT_CHAT_RU.md.

Получить ЖИВОЙ HEAD/TREE, последние Actions, статусы действующих owner веток; не принимать нижеприведённые HEAD за вечные. Не откатывать параллельные изменения.

## 2. Строгие архитектурные правила

T3 = встраиваемый технологический преемник T2, а НЕ отдельная Windows-программа. Отдельный T3 Control EXE, его GUI, installer и sidecar запрещены решением владельца; не восстанавливать из Git history. Код и CI T3 только в открытом Faust-S/knowledge/packages/t3-core, главная рабочая ветка work/2026-11-10-t3-t2-activity-projection. Исторический Faust-S/T3 только источник чтения. Нормативный Faust-S/T2@main не изменять. Никакого второго Kernel, Store, IAM, Task Engine, Exchange, формата взамен .iwxa и подменяющего T2 capabilities allowlist. Не изменять Agent, Center, Publisher, Atlas, Activity и домены без отдельного разрешения. GitHub Actions только в открытом knowledge. Codex только для недоступных операций / независимой приёмки.

## 3. Проверенные результаты D4

На основной ветке исходный T2 0.3.6 parser отказал unsupported-version кодом UNSUPPORTED_FORMAT и ZIP path traversal кодом VERIFY_FAILED, не изменяя целевой Store. Подтверждены два независимых потребительских порта и два независимых исходных Kernel Store с исходным архивом .iwxa и историей после холодного открытия. GitHub Actions #43510706212 SUCCESS, реальный host marker T3_D4_ORIGINAL_T2_UNSUPPORTED_VERSION_AND_TRAVERSAL_PASS, T3_D4_TWO_INDEPENDENT_CONSUMERS_ORIGINAL_IWXA_PASS. Это НЕ квалификация двух разных установленных продуктов. Ветка work/2026-11-14-t3-d4-original-parser-negative уже устарела относительно main: не заменять ею исходники, иначе потеряются параллельные delegated-agent/revocation тесты.

Исходные T2@main HEAD 9c64951cd78411283e8a416641c36d71e169fc1d, исходная версия Kernel 0.3.6, Runtime Contract 1.3.0. Проверять HEAD заново.

## 4. Новые D3-исправления (только действующий inherited Host/transport)

Проверена реальная проблема: исходный Host receiver считал Promise от validateSource()/onPreview() успешным preview немедленно и позволял sendReceipt до завершения проверки источника. Исправлено в src/workspace-host/site-handoff/host-receiver.mjs, 2 регрессии tests/site-handoff-transport.test.mjs. Коммит 6436136c5f0bd43256a3690c1eaede64e8805853. Actions #43512396372 COMPLETED SUCCESS (test, real-host, windows-credential); metal-webgpu SKIPPED. Это полноценный подтверждённый адресный fixed defect, не вся D3.

Следом в src/workspace-host/site-handoff/site-handoff.mjs и site-restore.mjs исправлено ложное APPLIED: после асинхронного onReceipt()/onCandidate() результат отправляется только по settled callback, а ошибку сохранения/Kernel readback нельзя выдавать за успех. Добавлены 4 regression tests в tests/site-handoff-transport.test.mjs и tests/site-restore.test.mjs. Коммит 3b0334b771b9e6895f5283c34f4f5e919a15cc45. На момент подготовки документа CI #43513015756 был IN_PROGRESS. Статус проверять заново; не объявлять PASS раньше завершения.

Проверен ещё один отдельный fail-open случай: Promise.reject(null) от onCandidate мог считаться APPLIED, так как прежняя ветка проверяла truthiness ошибки. Исправлено отдельным булевым признаком failed и регрессионным тестом в site-restore. Коммит fab394155d0534ed17ec648b3a0e5b878117dd6e. На момент handoff CI этого коммита НЕ ПОДТВЕРЖДЁН, обязательно проверить exact workflow для этого HEAD.

Ни один из этих transport fixes сам по себе не создаёт Human Review или полномочия: тот же Host обязан независимо проверить signed source, explicit consent, JIT authority, настоящий Kernel receipt/readback, revision and recipient. ACCEPT != APPLY, preview и postMessage не разрешают запись.

## 5. Следующий один продуктовый участок

1. Сверить CI на exact last HEAD; при FAIL исправить действительную причину с одной регрессией без расширения scope.
2. В D3 повторно использовать существующие исходные reconciliation/application-host-binding.mjs, application-effect-snapshot.mjs, application-projection.mjs, application-authorization-observer.mjs из исторического T3 (только разрешённые для public переносы), существующий signed-access-host-port.mjs и оригинальный Kernel/Exchange. Не создавать второй Reconciliation engine.
3. Выполнить на независимых roots действительный signed Task → selected Result → явный Human Review/Accept → отдельный Apply → исходный Kernel receipt/readback → cold reopen. Негативные wrong recipient/key/role, replay, stale signed revision, acceptance without apply. Проверять с owner interfaces, а не synthetic success. Для реального Agent и Admin Host потребуется отдельная собственная интеграция; от тестового портового PASS нельзя объявлять native product acceptance.
4. Не отвлекаться на новые тестовые фреймворки: если D3 пробел требует новой функциональности — реализовать её в действующем owner. Далее D5/WebGPU, D6, D7 и единый G4.

## 6. Отчётность

T3_READY=false, G4=NOT_ACCEPTED, D4_PUBLIC_TWO_PORTS=PASS, D4_PRODUCT_NATIVE=NOT_ACCEPTED, D3_END_TO_END=NOT_ACCEPTED. Фиксировать exact source HEAD/TREE, URL Actions, фактические positive/negative результаты. Не смешивать runtime mock, synthetic issuer, CI PASS с продуктовым финальным acceptance.
