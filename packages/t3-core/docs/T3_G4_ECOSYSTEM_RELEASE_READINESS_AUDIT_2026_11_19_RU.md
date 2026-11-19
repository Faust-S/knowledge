# IWXA T3 G4: инженерная ревизия ядра, программ и доменов

Дата фиксации: 19.11.2026. Статус: `T3_READY=false`, `G4=NOT_ACCEPTED`.

## 1. Проверяемые исходники и доказательства

- Исполняемый One Core: `Faust-S/knowledge@6ad3a3e5d5bca0d091503a275a4d786e48524a97/packages/t3-core`. Нормативный `Faust-S/T2@main 9c64951cd78411283e8a416641c36d71e169fc1d`, оригинальный Kernel 0.3.6, Runtime Contract 1.3.0. Зафиксированный T2 runtime квалифицируется по SHA-256; поздние обновления нормативного main являются документацией.
- Оригинальный подписанный Windows Owner: `Faust-S/T3@b897404432cec18144942758d296c19d76232f55`. Это исходный владелец signer/Access/Reconciliation, **не** второй исполняемый T3 Kernel/Host.
- Установленный Admin Center: `Faust-S/Center@2628c4bc1b20b4393c485d12513f029fdea8b082`.
- Agent 0.6 development: `Faust-S/iwxa-personal-agent@1bf0847ed069c86fe6a11380537535f0ce6c0b8e`; отдельно подписанный D3 source `5638684ab952dffa545d8a374507f494a1a5ef2a`, D6 source `34d8f1a10b552f1d0c4108e012414648e71ce0a0`.
- Atlas 0.9: `Faust-S/Atlas@19ea3d228c585a1c50e749632c2f2df1a71c7c33`; Publisher PERSON: `Faust-S/Center@3397d4d7e599760a07662e766ed3e4cf6ecc2a23`; Activity source: `Faust-S/knowledge@2383c58f88901f16aa2a5fa780de447dba3d4750`.
- Единственная явно названная пилотная ветка T3 среди 11 парных веб-доменов: `Faust-S/club.iwxa.ru@868bf42f0462268ae82da6db62443b90606e77fe`.
- Исходная квалификация Core [#44537675955](https://github.com/Faust-S/knowledge/actions/runs/44537675955): PASS, 801/801 Node; real-host и Windows credentials PASS; Metal, native age и native model SKIPPED именно в этом прогоне.
- Установленный Admin D3 [#44537675979](https://github.com/Faust-S/knowledge/actions/runs/44537675979): **SUCCESS**, 19.11.2026. Публичный One Dist и приватная нативная сборка PASS; реальный Setup Core и WebView2 PASS; Workspace без Atlas PASS; физический NO и затем YES регистрации PASS; исходный подписанный Owner готов; отдельное дисковое чтение черновика, пять необходимых файлов, независимый второй процесс оригинального Owner с DPAPI и GUI cold restart PASS.

## 2. Уровень готовности B0 и D1-D7

| Уровень | Доказано | Что НЕ принято |
| --- | --- | --- |
| B0, единый T2/T3 | Qualified T2 0.3.6 в One Dist, Core/Host/Kernel/Workspace/Exchange/Lifecycle исходно работают; установленный Admin Setup PASS | Универсальное промышленное обновление всех продуктов |
| D1, подписанные полномочия | Исходные Access/Ed25519, DPAPI; установленный Admin Owner и холодное восстановление PASS | Два независимых Windows-субъекта, оригинальный installed employee Agent, единая сверка их прав |
| D2, Event/Activity | Контрактные original T2 Object/Event и выбранная D2-проекция | Установленный Activity с подписанным reviewer passport и строго разрешённым derived Result |
| D3, Task -> Result -> Human | Оригинальный Windows Node/Python source-сценарий 20/20, реальный Kernel APPLY и два source-cold чтения; установленный Admin Owner enrollment PASS | Installed Agent с настоящей модельной Task и Result, физические отдельные ACCEPT и APPLY, Kernel Object/Event и два cold readback между установленными продуктами |
| D4, Exchange | Два технических адресата, существующий .iwxa и подписанные технические контракты | Универсальная самостоятельная установленная передача между независимыми владельцами |
| D5, browser local model | Apple Metal WebGPU/WebLLM, первая генерация и вторая холодная офлайн-генерация на source-кандидате, [#44340207574 attempt 2](https://github.com/Faust-S/knowledge/actions/runs/44340207574) | Принятый именно конечный self-contained T3 domain dist, пользовательская установка модели, настоящий web-product cold restart для финального G4 |
| D6_GENERIC | Public original signed-context, обычный другой домен без Atlas, source tests PASS | Реальный отдельный установленный получатель, его собственное сохранение и lost-ACK read-only recovery |
| D7_PERSON | Контракты original Publisher PERSON и age, исходные проверки подписей и STATUS | Установленный Publisher/recipient: issue, renew, STATUS, revoke, independent cold readback |
| G4 | Отдельные технические части квалифицированы | **NOT_ACCEPTED**, `T3_READY=false` |

Отдельные успешные испытания не суммируются автоматически в G4. Прогон одного Windows OS-пользователя с разными тестовыми ключами не равен двум отдельно установленным владельцам.

## 3. Готовность программы

| Программа | Что уже есть | Т3 до промышленного завершения |
| --- | --- | --- |
| Admin Center | Установленный native Center, T2 One Dist, обычная Workspace без Atlas, real Win32 Human enrollment, original DPAPI Owner и полный холодный restart PASS (#44537675979) | Реальный второй сотрудник/Agent, отдельные native Human ACCEPT/APPLY, original Kernel Event/Object и двухкратное cold-чтение результата |
| Personal Agent 0.6 | Нативный Agent/One Dist и Setup 0.6 с обычным cold-open и same-version Repair PASS; D3 подписанные Task/Result source, локальные модельные компоненты | Реальная установленная корпоративная Task + локальный inference + Human Review + подписанный Result под другой Windows-учётной записью; cross-version rollback и independent D6 |
| Atlas 0.9 | Самостоятельный Tauri и original U05 Store, installed Project/Work save, два отдельных cold-read PASS; optional T3 WorkRef/Decision source | Только факультативный оригинальный signed recipient; private Ed25519 installed Agent -> Atlas не принят и НЕ блокирует G4_GENERIC |
| Publisher 0.5 | PERSON request/renew/STATUS/revoke и строгий original signer readback представлены исходниками; TEST лицензии отделены от PERSON | Native PERSON signer и адресат должны пройти issue, renew, STATUS/revoke и cold readback |
| Activity Analyzer | Source original T2 D2 reader, selected Workspace, separate reviewer passport, явная граница read / derive / publish | Установленная программа и реальный owner-approved derived Result с проверенной анонимизацией/правами |
| Веб-домены D01-D11 | T2 product-first позволяет продолжать предметные функции и собственные Workspace; пилот D02 имеет отдельную экспериментальную T3-ветку | Пока нет доказательств общего G4 self-contained T3 release в 11 production domain dist. D02 candidate builder сейчас требует `IWXA_T3_CORE_SOURCE_DIR` и `IWXA_T3_BLI_SOURCE_DIR`, поэтому не является автономной хостинговой сборкой |

## 4. Сверка архитектуры и обнаруженные ошибки

**Правильно:** исполняемый T3 только `knowledge/packages/t3-core`; оригинальный T2 Kernel/Host/Store/Exchange не копировать; оригинальный приватный подписант остается у своего владельца. Admin владеет организационным решением, Agent исполнением, Publisher лицензией, Activity правомерной производной проекцией, Atlas проектом и WorkRef. Для обычной Task Atlas не требуется. Получатель D6 может быть любым авторизованным доменом.

**Исправлено и проверено:** исходный Rust Center неверно отклонял собственное действие `d3-enroll`; private Bun EXE терял JSON-каталог `domain-registry.json` при чтении через `import.meta.url`, а импортированные Server/License CLI могли выполнять собственные точки входа; нестабильный Windows UIA ввод прежде принимался без точного ValuePattern readback. Исправления исходных владельцев подтверждены установленным PASS #44537675979.

**Исправлена ошибка релизного учёта:** прежний `G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json` всё ещё отмечал cold Owner как HOLD после успешного CI. Обновлён отдельный точный gate `D3_INSTALLED_ADMIN_OWNER_ENROLL_AND_DPAPI_COLD=PASS`; общий D3 остаётся PARTIAL и G4 NOT_ACCEPTED. Эти статусы нельзя взаимозаменять.

**Открытые инженерные риски:**
1. Нельзя считать source 20/20 полноценным installed Human ACCEPT/APPLY. Нет сквозного продукта под двумя OS-пользователями.
2. Нельзя считать Metal source PASS квалификацией ровно выпускаемого доменного T3, пока не собран самостоятельный сайт, выбранная модель не установлена по явному согласию и холодный офлайн-маршрут не пройден на том же выпуске.
3. Нельзя подменять generic D6 цепочкой Agent -> signed file -> Atlas: Atlas факультативен; сама подписанная .iwxa с полезным текстом не означает его шифрования (для конфиденциальности нужен оригинальный age).
4. Нельзя считать T3 self-contained domain готовым, пока обычный site `build` требует checkout разработческих T2/T3/BLI. Сборка должна использовать проверенный release artifact из своего веб-репозитория с SHA/provenance, а не дублированный развиваемый Core.
5. Нельзя продолжать выдавать устаревшие report/AGENTS/handoff HEAD за текущие: read live SHA, compare CI pin and scope; точная релизная запись машинного реестра приоритетнее исторического рассказа.

## 5. Решение о трансформации доменов

**Сейчас:**
- Продолжать T2 product-first сервисы, Result/receipt/readback/cold restart/.iwxa по доменам без ожидания G4.
- Вести отдельную не-production T3 пилотную ветку для одного сайта за раз (D02): явный переключатель T3; модель только после отдельного выбора и согласия пользователя; все ресурсы локальны и после установки доступны офлайн; сайт не обращается к репозиториям T2/T3 при build/runtime.
- Подготовить у предметных владельцев собственные Result/Task и разрешённые projection contracts. Данные чужого домена доступны только через D1/D6, не общие коллекции, Atlas или новый Store.
- **Не переводить T3 в production по умолчанию** и не снимать стабильный T2, пока не прошли необходимые installed и доменные сценарии на одном закреплённом выпуске.

**Далее, в этом порядке:** (1) установленный Agent под вторым Windows-пользователем и настоящий model/Task/Result, (2) реальные native ACCEPT и отдельно APPLY с Kernel Object/Event и двумя cold-восстановлениями, (3) generic D6 к независимому не-Atlas получателю, (4) PERSON D7 Native Publisher, (5) точная hardware/Host D5 квалификация конечного доменного выпуска, (6) сборка/проверка D02 из одного site checkout, (7) G4 и последовательное по одному домену внедрение.

**Вердикт:** архитектура годится для продолжения. Исходная технологическая зрелость высокая относительно начала разработки; межпродуктовая промышленная готовность пока **частичная**. Проценты без фиксированного набора проверок скрыли бы эту разницу. До независимых installed D3/D5/D6/D7 `T3_READY=false`.
