# IWXA T3 One Core: D5, автономная модель и передача в новый чат

**Дата:** 14.11.2026. **Статус:** инженерный handoff. Это не утверждение о готовности G4 или продукта. В новом чате сначала читать **этот файл полностью**.

## 1. Код, ветки и единственный владелец

- **Единственный исполняемый T3:** `Faust-S/knowledge`, каталог `packages/t3-core/`, рабочая ветка `work/2026-11-10-t3-t2-activity-projection`. Точный исполняемый HEAD на момент этой передачи: **`ea704e547a72c2cdb990c1e25c54ad03a562a2bb`** (функциональное исправление `c1d7206`, затем контроль исходников и регрессии в `ea704e5`). Перед изменениями повторно получить live HEAD/TREE и проверить, нет ли параллельных коммитов.
- **Норматив наследования:** `Faust-S/T2@main` = `9c64951cd78411283e8a416641c36d71e169fc1d`; исходный Kernel `0.3.6`, Runtime Contract `1.3.0`, оригинальный `.iwxa`. После релиза T3 полностью заменяет T2 в обновлённом продукте, а не работает вторым ядром рядом.
- **Архитектура/исторические исходники:** `Faust-S/T3@work/2026-11-10-t3-t2-upgrade-core/planning/T3_DELTA_ACCEPTANCE_RU.md`, `architecture/T3_ONE_CORE_ALL_DOMAINS_SOFTWARE_AI_SOURCE_MAP_2026_11_11_RU.md`; `Faust-S/knowledge/AGENTS.md`; этот репозиторий не должен импортировать private T3 в публичный CI.
- **Запрещено:** отдельный T3 Control EXE/sidecar/установщик, новый Kernel/Host/Store/IAM/Task Engine/Exchange, иной формат вместо `.iwxa`, обёртка с урезанными штатными T2 capabilities. Нельзя изменять T2 или чужие продуктовые репозитории из этого потока без отдельного поручения.
- **Проверки:** публичные GitHub Actions только в открытом `knowledge`; Actions в закрытых репозиториях запрещены. Codex только для недоступных здесь Windows GUI операций и независимой финальной приёмки. Не запускать многократно одинаковые промежуточные тесты: функциональный дефект → адресное исправление → один полный source CI.

## 2. Последний принятый исходник до этой разработки

**D4 и базовый Host:** [GitHub Actions #43632734602](https://github.com/Faust-S/knowledge/actions/runs/43632734602) = **SUCCESS** на точном исполняемом `01aac43cd0aad5f7d40fc916bfefc0fcd2a420fd`: Node **681/681**, Workspace/DOM **1123/1123**, `real-host=SUCCESS`, `windows-credential=SUCCESS`, аппаратный `metal-webgpu=SKIPPED`. Документационный HEAD до D5: `858f6f01497d8dd5d107f72cbadccd964fa053a2`.

Что уже сделано в D4: два независимых технических получателя оригинального `.iwxa`/Store, сохранение оригинальных relations/events, import readback; original parser отказал unsupported format 99.0 и ZIP traversal; новые `ImportView` и `validateImportScope` показывают и блокируют missing/invalid/conflicting schema declarations даже без старых permission counters. Два **установленных** независимых потребителя и полный semantic/profile acceptance ещё отсутствуют. Подробности: `handoff/T3_ONE_CORE_D4_TWO_CONSUMERS_2026_11_13_NEXT_CHAT_RU.md`.

## 3. Продолжение D5 в этом чате: устранён воспроизводимый разрыв Stop

Исходная WebLLM/BLI функция уже встраивается в тот же Workspace: пользователь выбирает модель SmolLM2 360M или 1.7B, отдельно соглашается на загрузку, получает локальный draft `DRAFT_UNTRUSTED` и сохраняет его по явному нажатию в исходном T2/T3 Kernel. Без веса в дистрибутиве, без облачного inference fallback и без автоматического принятия AI результата. BLI/WebLLM `0.2.87` и оригинальный Cache Storage остаются единственными модельными владельцами.

**Найденный функциональный дефект:** нажатие «Остановить» во время асинхронного разрешения загрузки через Service Worker, ДО создания WebLLM Worker, раньше не прекращало установку. Потенциально скачивание могло начаться уже после Stop. И обратная гонка: Worker успел загрузиться, но разрешение Service Worker ещё не было закрыто; UI мог преждевременно показать «модель готова».

**Исправления:**
- `819c33eca891c920d08aa1193d1abbc6def99d99`: `integration-sources/bli1/LocalInferencePanel.tsx` ставит `AbortController` до начала установки, отменяет на смене Workspace/закрытии панели, передаёт `signal` в оригинальный WebLLM `engine.load`. Stop доступен только при загрузке/генерации, а не при сохранении в Kernel.
- Тот же коммит: `integration-sources/bli1/domain-model-install.mjs` после опоздавшего `MODEL_INSTALL_ALLOWED` **сам вызывает оригинальный `MODEL_INSTALL_END`** перед возвратом CANCELLED; код не создаёт другого Service Worker и не меняет SW lease-store. При отсутствии D5 у штатного Host T2/T3 продолжает работать.
- `0d5221156d8faca412798a2fa8ba4b9beade0df6`: один точечный `tests/t3-d5-model-install-cancellation.test.mjs` (проверяет abort до BEGIN и abort при позднем SW ACK/обязательном END).
- `c1d720650acd28a9d7510b2068700e59633db205`: UI объявляет `ready=true` **только после подтверждённого закрытия временного сетевого разрешения SW**. Отмена во время `MODEL_INSTALL_END` также останавливает Worker и запрещает переход в Ready. Ошибка закрытия разрешения оставляет модель остановленной, не выдаёт Success.

**Квалификация и provenance:** предыдущие запуски #43634089492 (`819c33e`), #43634137958 (`0d52211`) и #43634180957 (`c1d7206`) завершились FAIL по двум конкретным причинам: после изменения исходных BLI-файлов не был обновлён обязательный `SOURCE_PIN.json`; новый Node-тест напрямую импортировал отсутствующий в базовом Node-наборе пакет WebLLM. **Коммит `ea704e547a72c2cdb990c1e25c54ad03a562a2bb` исправил оба дефекта**: точные Git blob для трёх изменённых BLI-файлов обновлены с сохранением неизменных `upstream_blob`; тест выполняет исходный installer с подставленным каталогом WebLLM без установки его тяжёлого runtime в базовом Node. **Финальная публичная квалификация:** [GitHub Actions #43634380312](https://github.com/Faust-S/knowledge/actions/runs/43634380312) на ТОЧНОМ исполняемом `ea704e547a72c2cdb990c1e25c54ad03a562a2bb` завершилась **COMPLETED SUCCESS**: Node **682/682 PASS**, Workspace/DOM **1123/1123 PASS**, дополнительная Workspace/Activity проверка **21/21 PASS**, регрессия Stop/late SW ACK PASS, WebLLM `0.2.87` BLI build PASS, `real-host=SUCCESS` (исходный T2 0.3.6, подписанный Control и T3 Workspace, compiled BLI panel), `windows-credential=SUCCESS`; `metal-webgpu=SKIPPED`. CI не доказывает аппаратную генерацию и cold offline regeneration. Достоверные старые прогоны #43634089492, #43634137958, #43634180957 FAIL относились к доисправленным source pins/Node-test environment; они не являются продуктовым отказом после `ea704e5`.

## 4. D5: непокрытый продуктовый рубеж

**D5_HARDWARE_WEBGPU=NOT_ACCEPTED.** На штатных Linux CI применяется SwiftShader; браузерная сборка Worker и реальный Kernel readback не являются аппаратным inference. Отсутствует окончательно подтверждённое:
1. Настоящий WebGPU адаптер (не SwiftShader) + полная загрузка явно выбранной модели WebLLM с согласия пользователя.
2. Генерация ответа реальной моделью, целостная фиксация пользовательского `DRAFT_UNTRUSTED` оригинальным `putObject` + `getObject` readback.
3. **Холодный офлайн-перезапуск** после полной установки модели: без сети повторно открыть тот же Host и ту же модель из Cache Storage, выполнить новую генерацию, сохранить/прочитать draft из оригинального Kernel.
4. Отдельный поддерживаемый native inference owner без собственного inference-движка в T3. Нативная модель для Workspace НЕ обязательна и не должна автоматически скачиваться.

При отсутствии настоящей GPU среды сохранить `HOLD`, не подменять GPU «успешной» SwiftShader-симуляцией и не вызывать Codex для промежуточного тестирования без необходимости. Использовать штатный уже имеющийся `tests/t3-d5-full-bli.browser.mjs` на подходящем оборудовании, без написания второго GPU-тестера.

## 5. Текущий B0 / D1–D7 / G4 (не повышать без новых реальных доказательств)

| Рубеж | Состояние на 14.11.2026 |
|---|---|
| **B0** | Исходный T2 0.3.6/Host/Kernel/Exchange/Factory, проверенные real-host исходные capabilities, перенос `.iwxa`; в существующем квалифицированном T3 fixture PASS; не означает общий G4 |
| **D1** | Signed PERSONAL + 2 CORP/Ed25519/Control, origin-isolated UI и capability parity частично сделаны; нативный установленный подписант/полный пользовательский маршрут **HOLD** |
| **D2** | Детерминированная read-only T0/T1 проекция оригинальных T2 Object/Event/Result, source provenance и qualified links реализована; acceptance по реальным установленным владельцам отдельно |
| **D3** | Public Host Admission/Review/ACCEPT/REJECT, отдельный Apply, receipt recovery и оригинальная граница Kernel реализованы; **нативный original Reconciliation/D1 у Admin Center 0.3 ведёт другой чат**, настоящий E2E **NOT_ACCEPTED** |
| **D4** | Original `.iwxa`, два независимых technical consumers и негативный original parser частично PASS; два installed products/semantic profile **NOT_ACCEPTED** |
| **D5** | Source BLI/WebLLM + выбор модели + consent + offline cache + сохранение draft, Stop/lease исправлен в текущем кандидате; **реальный hardware inference и cold offline regeneration NOT_ACCEPTED** |
| **D6** | Контракты Host/Agent/Atlas/Admin/доменных продолжений существуют; полный signed web↔native Task/Project/Document/Result после cold reopen **NOT_ACCEPTED** |
| **D7** | Historical licence/access/age механизмы существуют; issuer→recipient signed licence/status, revoke/renew + фактическое age encrypt/decrypt у двух получателей **NOT_ACCEPTED** |
| **G4** | Нет единого locked release кандидата с B0+D1–D7 на одном наборе артефактов и действительных владельцев. **G4=NOT_ACCEPTED, T3_READY=false** |

## 6. Распределение работы по владельцам

**Этот чат / следующий:** только единый публичный исполняемый T3 в `Faust-S/knowledge/packages/t3-core`, D5→D6/D7 и G4 в установленных границах. Не трогать приватный код. `Faust-S/T3` только историческая логика/норматив.

**Параллельный чат Admin Center:** `Faust-S/Center` / `Faust-S/IWXA-Admin-Center`, подключение настоящего закрытого Reconciliation/подписанного D1 в существующий Tauri Native Host, без T3 Control EXE. Совпадение порта публичного D3 ещё не равняется принятой Admin 0.3.

**Другие владельцы:** Agent владеет своими Task/Review/Tool Runtime; Atlas — планированием; Publisher — лицензиями и издателем; Activity — обезличиванием. T3 не копирует их предметную логику. Домены активировать последовательно **после G4**, одно доменное направление за раз.

## 7. Точная следующая инженерная последовательность

1. Получить свежий HEAD/TREE `knowledge@work/2026-11-10-t3-t2-activity-projection`; точный последний исполняемый SOURCE PASS = `ea704e5`, [#43634380312](https://github.com/Faust-S/knowledge/actions/runs/43634380312) SUCCESS. Не повторять этот source CI без изменения соответствующей функции; после чтения handoff переходить к незакрытой продуктовой DELTA.
2. Если source PASS: **не разрабатывать снова loader/cache/WebLLM/Kernel и не умножать тесты**. Проверить один непройденный D5 аппаратный сценарий на поддерживаемом устройстве. Если такой доступ недоступен, явно оставить hardware gate HOLD и перейти к независимой реальной функциональной DELTA D6 или D7 в едином T3.
3. Для D6 использовать существующий signed owner + selected Result/WorkRef и оригинальный Kernel/Exchange; реальный web→native continuation с readback, без нового Task Engine и без встраивания чужого Agent/Atlas целиком.
4. D7: использовать исторический existing age/Publisher/licence исходник лишь через доверенную границу; не изобретать криптографию, не выносить закрытые ключи в public CI. Реальное native issuer/recipient окончательно квалифицировать отдельно.
5. Только после продуктового закрытия B0/D1–D7 проводить G4: одна зафиксированная версия + единый конечный `dist`, два cold restarts, no-egress для LOCAL_ONLY, свежая установка и независимая приёмка.

## 8. Готовое сообщение для начала нового чата

Продолжай самостоятельную инженерную разработку единого встраиваемого автономного **IWXA T3** непосредственно в `Faust-S/knowledge`. **Первым действием полностью прочитай:**

https://github.com/Faust-S/knowledge/blob/work/2026-11-10-t3-t2-activity-projection/packages/t3-core/handoff/T3_ONE_CORE_D5_TO_G4_2026_11_14_NEXT_CHAT_RU.md

Затем прочитай `AGENTS.md`, план B0/D1–D7/G4 в `Faust-S/T3`, карту 42 репозиториев и свежий HEAD/TREE. Текущий исполняемый ориентир `ea704e547a72c2cdb990c1e25c54ad03a562a2bb`: функциональный Stop/lease исправлен в `c1d7206`, BLI provenance и Node regression исправлены в `ea704e5` (Actions #43634380312 = SUCCESS: 682 Node, 1123 DOM, real-host и windows-credential PASS; аппаратный WebGPU SKIPPED). Не повторяй уже принятый source baseline без выявленного дефекта. Предыдущее D4: `01aac43`/Actions #43632734602 SUCCESS. Admin Center D3/Tauri разрабатывается параллельно в другом чате: не вмешивайся. Не создавай новые Core/Store/IAM/Exchange/EXE, не трогай нормативный T2, не запускай приватные Actions. Меньше промежуточных тестов, больше законченной функциональности: один установленный дефект → исправление → адресная проверка → единый source build. Аппаратный WebGPU и cold offline regeneration остаются HOLD, пока не подтверждены настоящей генерацией. `T3_READY=false` до G4.
