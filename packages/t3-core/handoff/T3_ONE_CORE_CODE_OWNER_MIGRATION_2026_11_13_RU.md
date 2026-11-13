# IWXA T3: единый исполняемый исходник и квалификация

**Решение владельца, 13 ноября 2026 года.** Весь код, сборка, разработка и испытания единого автономного IWXA T3 выполняются только в открытом `Faust-S/knowledge`, в `packages/t3-core/` и GitHub Actions этого же репозитория. Готовый `dist/` должен включать оригинальные механизмы T2, Workspace, Host, Kernel, BLI и согласованные функции T3. Другие репозитории не используются как CI-посредники и не должны быть runtime-зависимостями T3.

## Разделение ответственности

- `Faust-S/knowledge`: **единственный исполняемый T3**, все тесты и GitHub Actions, включая Control и итоговую G4.
- `Faust-S/T3`: теория, логика, архитектурная карта и исторические наработки; можно читать как справочный материал, но нельзя тянуть исходники приватного Control в сборку, делать checkout или запрашивать токен для CI.
- `Faust-S/Center`: независимый продукт; **не участвует** в разработке, сборке, тестировании и квалификации T3.
- Нормативный T2 и сторонние продукты не изменять. Не создавать второй Kernel/Core/Store/IAM/Task Engine/Router или альтернативный формат `.iwxa`.

## Исправление ошибочной ветви разработки

13.11 была ошибочно создана схема `knowledge → Center → исторический закрытый T3 → Control → knowledge`. Это искусственная межрепозиторная зависимость, противоречащая выбранному процессу. **Она отменена как способ разработки и приёмки T3.** Требование `IWXA_PRIVATE_SOURCE_READ_TOKEN` не является и не должно становиться блокером T3.

Из активного `knowledge` удаляются вспомогательные `scripts/stage-original-control-consumer.mjs`, `tests/t3-d1-control-consumer-stage.test.mjs` и соответствующий этап Actions: они проверяли копирование исторического исходника, а не работоспособность единого продукта. Их прошлые PASS означали лишь успешное тестовое стадирование и не означали приёмку подписанного Control. История коммитов GitHub сохранена. Репозитории Center и T3 этой корректировкой **не изменяются**.

## Действующие подтверждённые механизмы

- `src/t3/isolated-ui-server.mjs`: отдельный локальный origin, канонический `/workspace/`, CSP, модельный Worker.
- `src/t3/signed-access-host-port.mjs`, `src/t3/subject-access-binding.mjs` и `src/t3/control-loopback-owner.mjs`: существующие мосты к проверке полномочий; это **не** доказательство настоящего интегрированного подписанта.
- `scripts/assemble-signed-control-dist.mjs`: сборка подписанной Workspace поверх неизменного оригинального Kernel и регистрация BLI.
- [knowledge Actions #43446211040](https://github.com/Faust-S/knowledge/actions/runs/43446211040): `test=SUCCESS`, `real-host=SUCCESS`; подтверждены оригинальный Kernel 0.3.6, подписанный UI, работа панели BLI и копия черновика через Kernel с **синтетическим** владельцем полномочий.
- Предыдущая аппаратная D5 WebGPU Apple/Kernel/cold-offline квалификация имеет отдельное подтверждение; её результат **не** означает прохождение настоящего подписанного D1/G4.

## Что осталось до продукта

1. В `knowledge` определить существующий исходный механизм Ed25519/AccessRegistry и соединить его с установленным единым Host/Control без заимствования кода из другого репозитория при сборке или тестировании. Не изобретать вторую систему полномочий.
2. В **публичных Actions knowledge** пройти действительный маршрут выдачи/отзыва полномочий, изоляции двух организаций и PERSONAL, настоящий Kernel read/write, экспорт/импорт `.iwxa` и холодный повторный запуск.
3. Выполнить окончательный пользовательский маршрут BLI и общую G4, используя единый установленный `dist/`.

Текущий статус: `D1_REAL_SIGNED_CONTROL=NOT_ACCEPTED`; `T3_READY=false`; `G4=NOT_ACCEPTED`. Нельзя считать успешное стадирование закрытого исходника приёмкой продукта. Публиковать новые исполняемые изменения только в `knowledge`.


## D1: original local signed Access and encrypted vault qualification

Executable source: knowledge@d567eaa45b869cd14f90a51c97dd8758683b73de.
Public Actions: https://github.com/Faust-S/knowledge/actions/runs/43456298605
**COMPLETED SUCCESS**: test SUCCESS, real-host SUCCESS, metal-webgpu SKIPPED (not requested).

Everything below resides and executes in knowledge/packages/t3-core. No Center checkout, private T3 checkout, cross-repository token, private Actions or CI intermediary was used.

Implemented:
- src/t3/access/core.mjs: original versioned T3 Access evaluator, real Ed25519 verification of signed grant, actor proof and STATUS. Adopted into the single source tree, not a new IAM, Kernel, Store or transfer format.
- src/t3/access/original-personal-evaluator.mjs: uses the existing signed-access-host-port; signed registry state is read AFTER the asynchronous actor proof. No cached grant rights.
- src/t3/access/local-vault.mjs and strict-json.mjs: original offline encrypted Ed25519 key-vault algorithm and strict JSON decoding. No real private keys committed.
- src/t3/access/original-vault-proof.mjs: authentic local actor signature after authorized vault unlock, without putting private keys into Browser, WebLLM Worker or IWXA packages.
- New executable Node regressions and the real compiled browser/Kernel test use the original T2 Kernel 0.3.6.

Observed Chromium real-host marker T3_D1_REAL_ED25519_PERSONAL_ORIGINAL_KERNEL_COLD_PASS: realEd25519Grant=true, realSignedActorProof=true, realSignedStatus=true, originalKernelColdReadback=true, revokedAfterCold=true, originalKernelWriteCount=1, privateControlUsed=false, completeControlProductAccepted=false.

The existing T3_D1_D5_SIGNED_BLI_COPY_SAVE_ORIGINAL_KERNEL_PASS user-flow still uses a synthetic Control for that UI route. The vault tests cover encrypted disk reload, a fresh verifiable signature with the recovered key, wrong passphrase, tampering and duplicate-key refusal. This is NOT an end-to-end process restart of a persistent live issuer with signed STATUS chronology.

Remaining: bind authentic signed Access to the installed loopback AppShell using the original Host mechanisms, persist authentic monotonic STATUS/registry state without a second Store, qualify two corporate organizations and PERSONAL, real revocation and cold restart, T2 .iwxa roundtrip, hardware BLI and G4 in public knowledge Actions only.

**D1_PERSONAL_SIGNED_KERNEL_E2E=PASS. D1_INSTALLED_CONTROL=NOT_ACCEPTED. G4=NOT_ACCEPTED. T3_READY=false.**


## 13.11.2026: PWA в едином T3, точные результаты

**Владелец кода и CI: только Faust-S/knowledge.** T3 исторически хранит теорию. Center, нормативный T2, опубликованные сайты и другие репозитории не изменялись.

Интеграция: [ec545b10](https://github.com/Faust-S/knowledge/commit/ec545b10f0cae9a8b67cc8a46b42d6fa39299f63), [49e5ee85](https://github.com/Faust-S/knowledge/commit/49e5ee85bc2fe2e58d57fdfcbd385ab030c435a0), [f120757e](https://github.com/Faust-S/knowledge/commit/f120757e27838a50b3858e04ac84bd3465097fe1). Основная ветка обновлена обычным fast-forward, исходный TREE 72fce3ae8c1759217d17d995462c1aec2560c922. Изменены существующие материализатор Domain Mode, UI Domain Mode и браузерный тест; добавлены генератор установочного манифеста, иконки и тесты PWA. Единый исходный SW src/t3/domain-mode/t3-sw.js остался байтово идентичным (blob ccf04d88d2e38d9df6e89245b8342ae87c4dd8b9). Нет второго Kernel, Store, IAM, Router, Service Worker или формата пакета.

[PWA Windows/Linux в основной ветке #43459673018](https://github.com/Faust-S/knowledge/actions/runs/43459673018): оба job SUCCESS; на каждой ОС 10/10 unit PASS, браузерная автономность, обновления, два окна и холодный перезапуск PASS. Реальная команда OS PWA.install в обоих браузерах отсутствует: **SKIPPED**, не PASS; Android и iOS **NOT_RUN**.

[Полный T3 в основной ветке #43459673007](https://github.com/Faust-S/knowledge/actions/runs/43459673007): test SUCCESS, real-host SUCCESS. В новом E2E настоящая квалифицированная T2 0.3.6 Kernel/Store выполняет write/receipt, второе окно читает результат; исходный T2 Exchange создаёт .iwxa, независимый получатель импортирует его через оригинальный Kernel, после холодного офлайн-перезапуска исходный результат читается из прежнего Store. Ошибка первого теста IMPORT_EVENT_ID_COLLISION возникла при повторном импорте уже существующего события обратно в ту же БД: корректная защита Kernel. Только тест исправлен с раздельным получателем; исходный Exchange не менялся. Подтверждено #43459263795 SUCCESS.

PWA - штатная установка того же сайта и T3. Установка ОС и включение автономного T3 независимы; модель не загружается автоматически; предложение обновлений только после согласия. Генератор применяется к собранному финальному доменному dist, но сайты пока не менялись. Готово к последующему поочерёдному испытанию на одном домене, не является выпуском T3.

## 13.11.2026: оригинальный Ed25519 PERSONAL на существующем Host HTTP(S)

[D1 HTTP ad00d622](https://github.com/Faust-S/knowledge/commit/ad00d622f166a6be169dd8506c55494c5b64d10e): новый обработчик src/t3/original-control-http-handler.mjs НЕ создаёт сервер, Store, IAM или издателя подписи; подключает существующий протокол браузерного control-loopback-owner к доверенному Host. Он использует штатный signed-access-host-port, проверяет на стороне Host оригинальный WeakMap decision binding, эпоху контекста, Bearer, origin и SSE-инвалидацию. [Публичный CI #43460542952](https://github.com/Faust-S/knowledge/actions/runs/43460542952) SUCCESS.

[D1 HTTPS real Kernel e784eb05](https://github.com/Faust-S/knowledge/commit/e784eb058912419f57c87d7250edf5d5a18ad9a5): на том же квалифицированном HTTPS Host, где работает оригинальный T2 Kernel 0.3.6, выполнены действительные Ed25519 grant, actor proof и STATUS, запись/receipt, отказ чужой Workspace, подписанный отзыв, SSE-инвалидация, холодный браузерный restart/readback и продолжающийся отказ по отозванным правам. Используется существующий сервер через optional controlHandler, не второй локальный сервер. [Публичный CI #43461333618](https://github.com/Faust-S/knowledge/actions/runs/43461333618): COMPLETED SUCCESS; test SUCCESS, real-host SUCCESS, metal-webgpu SKIPPED.

**Границы:** тестовый Host использует исходный Kernel, но полный установленный подписанный Control ПО ещё не прошёл пользовательский маршрут. Во время перезапуска браузера сам доверенный процесс Host остаётся запущенным, поэтому перезапуск процесса с восстановлением сохранённого подписанного STATUS floor NOT_ACCEPTED. Две корпоративные организации с подлинными enrolment proof NOT_RUN. Отдельный UI-маршрут BLI в подписанном AppShell по-прежнему тестируется с синтетическим Control. D1_PERSONAL_REAL_SIGNED_KERNEL_HTTPS=PASS; D1_INSTALLED_CONTROL=NOT_ACCEPTED; G4=NOT_ACCEPTED; T3_READY=false.

Следующие продуктовые шаги в knowledge: привязать подписанта к запуску установленного Host; использовать исходный реестр и штатное долговременное хранение статуса (не создавать второй Store); квалифицировать PERSONAL и 2 CORP после полного перезапуска, затем общую G4. Отдельно провести нативную PWA установку на Windows/Android/iOS.


## D1: original Kernel keeps signed AccessRegistry STATUS after cold browser restart

- Source [a9462bf3](https://github.com/Faust-S/knowledge/commit/a9462bf31f47f5cf255f346a3fda01db28c3e207). Public [knowledge Actions #43464416528](https://github.com/Faust-S/knowledge/actions/runs/43464416528): **COMPLETED SUCCESS**, test SUCCESS, real-host SUCCESS, metal-webgpu SKIPPED.
- Durable STATUS is implemented in src/t3/access/original-kernel-registry-state.mjs. Signed grants/STATUS and their floor are stored as an ordinary T2 typed object (iwxa.t3.access.signed-registry) inside the ORIGINAL Kernel 0.3.6 Store; chronology is recorded through the original T2 Event journal. No new Store, database, IAM, signer, task runtime, or package format.
- Trust roots are pinned by the trusted Host, not read from user-editable objects. Every read verifies original Ed25519 signatures, signed sequence and journal high-water evidence. Updates use the unchanged Kernel base_revision and the existing status transition check.
- The existing real HTTPS Control/Kernel browser test now persists signed STATUS seq=2 and its original Journal evidence, then recreates BOTH Chromium browser profile and native registry adapter before checking revoked rights. The real Kernel object, grant/STATUS and prior receipt survive; unsigned and signed-stale rewrites are refused. Unit regression also covers original object replay despite journal higher floor.
- Boundary: this does NOT prove a complete restart of the native Host process with keys recovered from encrypted vault. Product Windows Control and original 2-CORP enrollment are not accepted. The separately compiled signed AppShell BLI UI route still uses synthetic Control for its qualification. T3_READY=false, G4=NOT_ACCEPTED.


## D1: full trusted Node Host process restart, genuine Ed25519 and original T2 Store

**Public knowledge source commit:** [d395c082](https://github.com/Faust-S/knowledge/commit/d395c0824150bba545e776cbbebd13ba580848f8).
**Public [Actions #43465755241](https://github.com/Faust-S/knowledge/actions/runs/43465755241): COMPLETED SUCCESS**, test SUCCESS, real-host SUCCESS, metal-webgpu SKIPPED.
**Observed real-host marker**: T3_D1_REAL_NODE_HOST_PROCESS_RESTART_STATUS_PASS with separateHostProcesses=true, originalKernel=0.3.6, oneOriginalKernelStore=true, originalAccessEvaluator=true, localEncryptedVaultRecovered=true, revokedSequenceRecovered=2, rejectedAfterProcessRestart=true, originalKernelReadback=true.

Added tests/t3-d1-real-host-process-restart.browser.mjs: it starts TWO independent operating-system Node processes, each hosting the ORIGINAL qualified Kernel/Store on the same HTTPS origin and opening the same persistent real Chromium profile in succession. The first signs PERSONAL grant and STATUS, persists both into the original T2 Object/Event Store, produces an actual Kernel write/receipt, signs and persists sequence-2 REVOKED. It then terminates completely. The second process reopens the unchanged original Kernel/profile, reconstructs a fresh trusted Access port from the same pinned public policy and recovers an Ed25519 actor signer from the ORIGINAL encrypted key vault; it reads seq=2 from the original Kernel and refuses a new write while retaining the original object. No private keys committed. The test creates temporary test credentials/vault and public pinned policy in the CI scratch area ONLY; no additional domain-data Store, new signer algorithm or runtime was introduced.

The real-kernel qualification helper now accepts a fixed validated listenPort for this cold Host test; its original default and all other tests are unchanged. The full T3 build, original T2 checks, D2, PWA, BLI and existing signed Control routes passed on the same revision. **This is a real Host process restart test, not merely browser restart or object serialization.**

Acceptance boundary: Host is the real original-Kernel qualification environment and uses a CI-only temporary issuer. Installed signed Windows Control, two independently enrolled CORP principals, and full compiled signed AppShell with authentic Control on the BLI user journey remain NOT_ACCEPTED. No new branch was merged into other repositories. G4=NOT_ACCEPTED; T3_READY=false.


## 13.11.2026: D1+D5 — подлинный PERSONAL Control на собранном AppShell

Разработано только в knowledge, без изменений T3 (теория), Center, T2 и доменов.

- [Коммит 3f093dae](https://github.com/Faust-S/knowledge/commit/3f093dae7c3d7138a2df097ff59397c444613e8c): исправлен реальный продуктовый дефект первого запуска PERSONAL. Исходные SignedSelectedWorkspaceGate.tsx, main-trusted-kernel-realm.ts и origin-isolated-kernel-transport.mjs теперь принимают и CORP, и PERSONAL при правильном подписанном контексте. PERSONAL требует organization_id=null. Создание той же оригинальной Workspace только по отдельному подписанному разрешению, выбор ID по-прежнему запрещён. Исходные маршруты CORP не заменены. Тесты DOM/MessagePort подтверждают успех PERSONAL и отказ при подмене организационного контекста.
- [Коммит 8ce71fb5](https://github.com/Faust-S/knowledge/commit/8ce71fb50a6d653b25c03d9dbadb5216f8debb62): публичный тест собранного AppShell расширен настоящим подписантом Ed25519 через существующий Control HTTP. Применяется исходный createSignedAccessHostPort + original-personal-evaluator + encrypted vault, оригинальный T2 0.3.6 KernelFacade и два локальных origin. Поддержаны адресные JIT-действия getWorkspace/createWorkspace/getObject/listObjects/listEventsSince/putObject, без синтетического PERMITTED. Пользователь в собранном AppShell явно создаёт PERSONAL Workspace, открывает BLI, читает существующий черновик, редактирует и сохраняет новый; другой браузерный контекст проверяет оригинальные квитанцию и объект. Модель автоматически не скачивается.
- [Actions #43468408703](https://github.com/Faust-S/knowledge/actions/runs/43468408703) и [Actions #43468925912](https://github.com/Faust-S/knowledge/actions/runs/43468925912): COMPLETED SUCCESS, test SUCCESS, real-host SUCCESS, metal-webgpu SKIPPED. В последнем real-host журнале: T3_D1_COMPILED_APP_REAL_PERSONAL_ED25519_BLI_KERNEL_PASS (proofCount=13, registryReads=13, syntheticControl=false, originalKernel=0.3.6), затем T3_D1_COMPILED_APP_REAL_PERSONAL_REVOCATION_PASS (SSE отключил подписанный AppShell, не открыл сырой Kernel).
- Существующий синтетический CORP-кейс в этом же большом тесте остаётся отдельным и не засчитывается как корпоративная приёмка. Перед новым PERSONAL-кейсом syntheticOwner выключен, запросы обслуживает оригинальный Control HTTP обработчик с реальной Ed25519-проверкой.
- **Граница:** PERSONAL на настоящем собранном AppShell в квалификационном Host — PASS. Настоящая установленная Windows программа, два отдельных реальных корпоративных issuer/enrollment и общая G4 — NOT_ACCEPTED. PWA системная установка отдельно NOT_ACCEPTED. T3_READY=false, G4=NOT_ACCEPTED.


## D1: две независимые организации, исходная логика enrolment и настоящий Kernel

**Исходники:** [744ef96a](https://github.com/Faust-S/knowledge/commit/744ef96a802f5e8a5189b9fb03fc18cd7e1a3496) и [d779bfe7](https://github.com/Faust-S/knowledge/commit/d779bfe78dfd4b3b85c298d3259ea1237ce4cba0). Обе проверки публичны и выполнены ТОЛЬКО в knowledge: [Actions #43470342865](https://github.com/Faust-S/knowledge/actions/runs/43470342865) и [Actions #43471036776](https://github.com/Faust-S/knowledge/actions/runs/43471036776): **COMPLETED SUCCESS**, test SUCCESS, real-host SUCCESS; metal-webgpu SKIPPED.

Портированы исходные IWXA T3 организационные контракты и Ed25519 enrolment / operation evaluator из исторических наработок T3 в каноническую директорию knowledge/packages/t3-core/src/t3/access. Единственный источник текущего подписанного Access — уже существующий оригинальный Kernel-persisted AccessRegistry, без второго IAM, Store, формата пакета или внутреннего issuеr. Корпоративный gate привязан строго к реальному объекту original-kernel-registry-state через внутренний WeakSet. Его preview и authorize перечитывают signed state оригинального Kernel (после подписания credential proof), поэтому отзыв, появившийся между preview и authorize, не игнорируется. Общий signed-access-host-port совместим с синхронным старым и асинхронным JIT gate.

Испытание: один оператор, две разные организации (north и south), ДВА отдельных подлинных Ed25519 issuer и два credential, два независимо подписанных enrolment и grants, разные Workspace, общий исходный T2 Kernel 0.3.6 / Store. Через оригинальный Kernel в браузере сделаны две разные записи с квитанциями и чтением; запись в чужую Workspace запрещена. После подписанного отзыва org:north / STATUS sequence 2 org:south сохраняет разрешения, STATUS south sequence 1. После холодного браузерного перезапуска состояние проверено заново по сохранённому ORIGINAL T2 Store и Event. Старой организации новая запись запрещена, второй разрешена. Никаких синтетических PERMITTED в этих корпоративных проверках.

**Граница:** криптографическая Node/реальный Kernel-квалификация для двух организаций PASS. Полный установленный Windows Control и переключение контекста через СОБРАННЫЙ корпоративный AppShell не квалифицированы; корпоративный UI из старого сценария отдельно остаётся синтетическим. Глобальные D1–D7/G4 и системная установка PWA остаются NOT_ACCEPTED. T3_READY=false; G4=NOT_ACCEPTED.
