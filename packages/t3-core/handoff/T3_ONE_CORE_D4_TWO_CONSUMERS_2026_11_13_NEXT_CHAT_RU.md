# IWXA T3 One Core — D4, два независимых получателя, передача 13.11.2026

## Дополнение 14.11.2026: предметная совместимость D4, параллельно Admin Center D3

**Владелец:** только исполняемый `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`. Admin Center D3 разрабатывается независимо в `Faust-S/Center`; не переписывать его Review/нативного владельца отсюда. **Точный функциональный T3 HEAD: `01aac43cd0aad5f7d40fc916bfefc0fcd2a420fd`.**

D4 исходного Exchange исправлен в `1650cd2` и `01aac43`:
- `features/state/import-machine.ts`: несовместимые объявления `preview.schemas` со статусами `missing`, `invalid`, `conflict` теперь дают отдельные причины и блокируют подтверждение оригинального `importCommit`, даже когда `preview.unsupported` не повторяет эту ошибку. Проверка содержимого выполняется **до** раннего выхода из legacy preview без `included/excluded_by_permission`; недостающие счётчики современной scoped preview остаются самостоятельным отказом.
- `features/packages/ImportView.tsx`: пользователю показаны точные исходные `unknown_schema`, `forbidden_for_service`, а также дополнительные `extension_field` без вывода конфиденциального значения `sample`. Дополнительные поля пока обозначены требующими проверки владельцем схемы, а не ложно «поддерживаемыми».
- Существующие `import-local-validation-authority.test.ts` и `import-view-mode-panels.dom.test.tsx` дополнены адресными сценариями; нет нового parser, Kernel, Store, формата или отдельного Exchange.

**Отдельное исправление базового T3 Host:** `2c153b` сохраняет работоспособность подписанной Workspace при *отсутствии необязательного D3* у более старого Control (`CONTROL_OWNER_UNAVAILABLE`). Неизвестная/отозванная D1 сессия продолжает блокировать запуск: нет unsigned fallback. Корень найден в ранее красном публичном `real-host` на `ed33ed8`: ожидание `t3-d1-selected-workspace-message` в signed first-run. Не смешивать это с текущей интеграцией Admin Center.

**Проверки:** первый публичный [Actions #43632563213](https://github.com/Faust-S/knowledge/actions/runs/43632563213) выявил точное несовпадение UI-проверки (1122/1123 DOM PASS, кнопка не блокировалась на legacy preview), исправленное `01aac43`. Финальный на момент записи [Actions #43632734602](https://github.com/Faust-S/knowledge/actions/runs/43632734602) для `01aac43` запущен, **результат не подтверждён**. На этой ветке не объявлять `D4_PRODUCT_ACCEPTED` без двух реально установленных потребителей, original parser negative matrix, пользовательского cold readback. `T3_READY=false`; аппаратный WebGPU остаётся отдельно.


**Статусы:** `T3_READY=false`, `G4=NOT_ACCEPTED`, `D4_PUBLIC_TWO_PORTS=PASS`, `D4_PRODUCT_NATIVE=NOT_ACCEPTED`, `D4_NEGATIVE_MATRIX=PARTIAL`. T3 — встраиваемый технологический уровень существующих доменов и программ, **не** отдельное приложение.

## Дополнение 14.11.2026: реальный отказ оригинального T2 на опасных архивах (D4)

**Квалифицированный код:** ветка `work/2026-11-14-t3-d4-original-parser-negative`, commit `bc140f096265660c2a90897e7314dc8f429d847b`, [публичный CI #43509132218](https://github.com/Faust-S/knowledge/actions/runs/43509132218) **SUCCESS** (`test`, `real-host`, `windows-credential`; `metal-webgpu=SKIPPED`). В существующем `tests/t3-pwa-original-kernel.browser.mjs` реальные DEFLATE-записи исходного `.iwxa` извлечены **только для создания негативных CI-образцов** штатной утилитой `unzip` в Linux; `scripts/zip-store.mjs` уже существующим тестовым writer пересобрал вариации. Runtime parser и Kernel не изменены.

Оригинальный T2 0.3.6 `t2.importPreview` **отказал** в двух вариантах до выдачи разрешённого предпросмотра:
- `format_version: 99.0` вместо `1.0` → **`UNSUPPORTED_FORMAT`**.
- ZIP с entry `content/../../escape.json` → **`VERIFY_FAILED`** (отказ в архиве с выходом пути за корень; не заявлять, что код доказывает отдельный path-specific validator).
- После этих отказов независимый получатель остался без импортируемого объекта (`recipientStoreUnchanged=true`). Затем обычный оригинальный `.iwxa` импорт и холодное восстановление продолжили успешно работать.

Отрицательная D4 матрица **PARTIAL**: специализированные `unsupported semantic data`, отдельная проверка `unsupported profile` и полноценная приёмка двух разных установленных программ ещё не проведены. Нельзя объявлять `D4_PRODUCT_ACCEPTED` или `G4=ACCEPTED`. Не создавать второй ZIP/parser/Exchange; все будущие проверки — через оригинальный Kernel. В тот же период в основной ветке другая разработка добавила независимый ключ делегированного агента и отзыв родительского grant после импорта — сохранены, не заменены этой правкой.

**Следующий приоритет:** закончить только оставшуюся существенную D4 совместимость, затем D3 signed owner Task→selected Result→separate Human Review/Accept→Apply с независимыми субъектами. `Faust-S/iwxa-personal-agent@work/2026-11-13-agent-0-5-inprocess-k02-k04` содержит штатные `desktop/src/task-review-readback.ts` и `cells/reconciliation.py`: первый проверяет конкретное Human Review, второй устраняет неопределённый внешний эффект; **не** копировать их в T3 как новую универсальную Review/Reconciliation систему. T3 должен обеспечить подписанный перенос и оригинальный Kernel/Store, а решение остаётся у владельца Agent/Admin/домена.

## 1. Первое действие нового чата

Прочитать полностью этот документ, затем [AGENTS.md](https://github.com/Faust-S/knowledge/blob/work/2026-11-10-t3-t2-activity-projection/AGENTS.md), [карту 42 репозиториев](https://github.com/Faust-S/T3/blob/work/2026-11-10-t3-t2-upgrade-core/architecture/T3_ONE_CORE_ALL_DOMAINS_SOFTWARE_AI_SOURCE_MAP_2026_11_11_RU.md), [план B0/D1-D7/G4](https://github.com/Faust-S/T3/blob/work/2026-11-10-t3-t2-upgrade-core/planning/T3_DELTA_ACCEPTANCE_RU.md) и [предыдущую передачу](https://github.com/Faust-S/knowledge/blob/work/2026-11-10-t3-t2-activity-projection/packages/t3-core/handoff/T3_ONE_CORE_NO_STANDALONE_D1_TWO_COLD_NEXT_CHAT_2026_11_13_RU.md). После чтения получить **свежие** HEAD/TREE ветки `work/2026-11-10-t3-t2-activity-projection`, `Faust-S/T2@main` и последние публичные Actions. Не перезаписывать параллельные изменения.

## 2. Важная архитектура владельца

- **Единый T3** развивается только в открытом [knowledge/packages/t3-core](https://github.com/Faust-S/knowledge/tree/work/2026-11-10-t3-t2-activity-projection/packages/t3-core), наследует **все** способности нормативного T2 0.3.6 / Runtime Contract 1.3.0. Не создавать второй Kernel/Host/Workspace/Store/IAM/Task Engine/Router/Exchange, новый формат вместо `.iwxa` или обёртку, теряющую T2 methods/capabilities.
- **Отдельный T3 Control EXE категорически запрещён** как фатальная самовольная архитектурная ошибка ИИ. Он удалён; не восстанавливать GUI, установщик, sidecar, специальный Host/DPAPI из Git history. Подписанный Control HTTP — только технологический API, подключаемый к штатному Host владельца.
- Исполняемый T3 и CI только в публичном `knowledge`. `Faust-S/T3` содержит теорию и исторические источники, без runtime checkout. **Не использовать Center** как CI/транзитную сборку. Не трогать T2, закрытые репозитории, Agent, Admin, Publisher, Atlas, Activity и опубликованные домены. Codex только для недоступного Windows GUI и независимой финальной приёмки.
- Продукты используют существующие U01/U03/U04, свои Host и права; Publisher licence не даёт доступа к чужой Workspace, Agent владеет своим Task/Graph/Review, а Activity остаётся отдельным read-only consumer.

## 3. Выполненная D4-инженерия и точная квалификация

**Квалифицированный исходный HEAD:** `Faust-S/knowledge@work/2026-11-13-t3-d4-two-independent-consumers` → `9eb2ad787a011fdfedaf0c703a32cffe7106088a`. [GitHub Actions #43504604724](https://github.com/Faust-S/knowledge/actions/runs/43504604724): **SUCCESS**: `test`, `real-host`, `windows-credential`; `metal-webgpu=SKIPPED`. Не принимать все B0–D7/G4 на основании этого PASS. При интеграции определить HEAD заново, а не использовать эту квалификационную ветку как релиз.

**Настоящая ошибка T3:** signed `createSubjectKernelBinding` ошибочно требовал поле `workspace_id_map` после любого `t2.importCommit`, хотя исходный T2 `full/selective` может сохранять оригинальный workspace_id без отображения. В `src/t3/subject-access-binding.mjs` исправлен контроль оригинальной квитанции: для `full/selective` и **точно совпадающего** source/destination отсутствующая или пустая карта допускается. При foreign source, `merge` и реальном remap обязательна точная однозначная пара source → выбранный авторизованный recipient; чужой адресат отклоняется. Добавлена адресная регрессия против неверной квитанции в `tests/t3-subject-kernel-scope.test.mjs`. Это исправление существующего продукта, **не** новый импортер.

**Испытание двух потребителей** в прежнем `tests/t3-pwa-original-kernel.browser.mjs`: один настоящий T2 0.3.6 owner экспортирует архив `.iwxa` и подтверждает экспорт; независимый подписанный T3 selected Workspace consumer получает неизменённые байты через original Kernel `merge`; другой независимый потребительский профиль использует **прямой исходный T2 Exchange**, без нового парсера, и получает **тот же архив** в своём отдельном Original Store. Проверяется исходный объект и event ID, отказ оригинального parser на обрезанном ZIP, закрытие и холодное повторное открытие второго recipient с сохранением объекта и события. Исходная PWA автономность/история остаются работоспособны.

**Достоверные маркеры `real-host` в Actions #43504604724:**
- `T3_D4_SIGNED_FOREIGN_WORKSPACE_IWXA_ORIGINAL_KERNEL_PASS`: signed Ed25519 preview→merge→readback, три действительные проверки signed Access и foreign source→selected recipient
- `T3_D4_TWO_INDEPENDENT_CONSUMERS_ORIGINAL_IWXA_PASS`: `consumerPorts=["signed-selected-T3","original-T2-Exchange"]`, `independentlyPersistedRecipientStores=2`, `corruptZipRejectedByOriginalParser=true`, `originalEventProvenanceRecovered=true`, `secondConsumerColdRestartReadback=true`
- `T3_D1_TWO_COLD_NODE_HOST_PROCESS_RESTART_STATUS_PASS`: 3 процесса и 2 cold restart на одном original T2 Store, тестовый issuer
- В существующем D2 real-host также был `T3_D4_TWO_INDEPENDENT_ORIGINAL_KERNEL_CONSUMERS_PASS` с двумя T2 consumer stores, объектами, связями, событиями и cold readback

**Граница:** технически независимые потребительские **порты и Store**, **не два разных установленных коммерческих продукта**. Тестовые issuer/ключи, native product owner и полный Human Review не приняты. Не объявлять `D4_PRODUCT_ACCEPTED`, `G4=ACCEPTED` или `T3_READY`.

Ранний [Actions #43504177307](https://github.com/Faust-S/knowledge/actions/runs/43504177307) был FAIL из-за тестового неверного ожидания `workspace_id_map` в полном импорте. Это позволило обнаружить указанную настоящую ошибку T3. Итоговые код и CI — `9eb2ad7`, #43504604724 SUCCESS.

## 3.1. Продолжение D4: получателем оригинального .iwxa выступает личный агент

**Новый квалифицированный коммит:** [ffb61e85](https://github.com/Faust-S/knowledge/commit/ffb61e859d7d8e0e7b5674a949d8e9c7186b893c). [Публичный Actions #43508967493](https://github.com/Faust-S/knowledge/actions/runs/43508967493): **COMPLETED SUCCESS** (test, real-host, windows-credential; metal-webgpu skipped). Изменены только существующие `tests/support/t3-original-personal-authority.mjs` и `tests/t3-pwa-original-kernel.browser.mjs`; исходные Kernel, Host, Exchange, Store, IAM, Task Engine не переписывались.

В существующем полном real-host D4 исходный человек подписывает Ed25519 дочерний GRANT личному `agent:recipient-analyst`, агент предъявляет **свой** proof key через оригинальный encrypted Vault и принимает **неизменённый ZIP .iwxa** в независимый T2 Kernel 0.3.6 / Runtime Contract 1.3.0. Сохраняются объект, исходные Event IDs и границы выбранной recipient Workspace. После успешного импорта signed revocation **корневого человеческого GRANT** запрещает новые операции агента; полученный ранее объект не удаляется без отдельного законного основания.

Маркеры из настоящего real-host:
- `T3_D4_SIGNED_FOREIGN_WORKSPACE_IWXA_ORIGINAL_KERNEL_PASS`: `delegatedAgentRecipient=true`, `independentAgentKey=true`, `humanParentRevokedAfterImport=true`, `signedOperationProofs=4`, `originalKernelRecipientReadback=true`.
- `T3_D4_TWO_INDEPENDENT_CONSUMERS_ORIGINAL_IWXA_PASS`: `independentlyPersistedRecipientStores=2`, `originalEventProvenanceRecovered=true`, `secondConsumerColdRestartReadback=true`, `twoDifferentInstalledProductsAccepted=false`.

**Граница приёмки:** это `D4_SIGNED_PERSONAL_AGENT_RECIPIENT_NODE_REAL_HOST_PASS`, а не живой установленный Personal Agent, не корпоративный issuer-отправитель, не доменный Task→Result→Human Review/Accept/Apply и не отдельный холодный перезапуск credential-подписанта агента. Общие `T3_READY=false`, `G4=NOT_ACCEPTED` остаются. Продолжение по D3 делать без нового Task Engine, Review Store и ручного импорта чужого private repo.

## 4. Следующий продуктовый порядок

1. **D4:** закрыть оставшиеся отрицательные условия через **оригинальный** parser: unsupported profile/version, ZIP path traversal, unsupported semantic data, а также проверить сохранение поддерживаемых полей/relations/refs в конечном пользовательском маршруте. Обычный corrupt ZIP и два независимых технических consumers уже проверены; **не плодить повторяющиеся тесты**. Отдельная квалификация двух установленных продуктов выполняется через штатные Owner Host, когда они доступны.
2. **D3:** главный следующий функциональный участок: существующий Reconciliation/Agent/Admin owner, `signed Task→selected Result→Human Review/Accept→Apply→Kernel receipt→cold reopen` между независимыми roots. Неправильный recipient, replay, stale signed revision и `ACCEPT != APPLY` должны отказываться. Не создавать новый Task Engine/Review Store.
3. **D1, D5–D7 и G4:** PERSONAL + 2 CORP с производственным issuer внутри настоящего потребительского Host; WebGPU и native inference; signed Result между программами; age/licence trust; единый B0+D1–D7 локальный кандидат с двумя холодными перезапусками. Не возвращаться к самостоятельному Windows Control EXE.

**Source owners:** T3 `src/t3/subject-access-binding.mjs`, `src/t3/signed-access-host-port.mjs`, `src/t3/original-control-http-handler.mjs`, `src/t3/access/original-kernel-registry-state.mjs`, T2 Exchange `src/modules/exchange/features/state/import-machine.ts`, Runtime Contract `src/kernel-client/contracts/runtime-1.3.0/index.ts`. Тесты: `tests/t3-pwa-original-kernel.browser.mjs`, `tests/t3-subject-kernel-scope.test.mjs` и действующий публичный `.github/workflows/t3-activity-projection.yml`. Для внешних owners сверять `Faust-S/iwxa-personal-agent` (Agent Task/Result/Review), `Faust-S/Center` (Admin/Publisher), `Faust-S/Atlas`, `Faust-S/Br-test` (U01–U04), `Faust-S/knowledge@work/2026-11-10-activity-base-anonymizer`; **не изменять их из ядра T3**.

## 5. Готовый промпт для следующего чата

Продолжай самостоятельную инженерную разработку единого автономного IWXA T3 в открытом `Faust-S/knowledge`. **Первым действием полностью прочитай:**

https://github.com/Faust-S/knowledge/blob/work/2026-11-10-t3-t2-activity-projection/packages/t3-core/handoff/T3_ONE_CORE_D4_TWO_CONSUMERS_2026_11_13_NEXT_CHAT_RU.md

Затем прочитай `AGENTS.md`, карту 42 репозиториев, план D1–D7/G4 и предыдущее handoff. Сверь свежие HEAD/TREE T3/T2 и последние Actions. Исполняемая квалификация D4: `9eb2ad787a011fdfedaf0c703a32cffe7106088a`, публичный Actions #43504604724 SUCCESS. Используй текущий **основной** HEAD из GitHub, сохраняй чужие изменения. T3 — встраиваемые функции внутри уже существующих Host; отдельный Windows T3 Control EXE и его возобновление запрещены. Не создавай второй Core/Kernel/Store/IAM/Task Engine/Exchange/`.iwxa` и не изменяй Agent/Admin/Publisher/Atlas/Activity/домены без отдельного поручения. После адресного завершения D4 переходи к пользовательскому D3 signed Task→Result→Review/Accept→Apply с независимыми roots. Публикуй завершённые исправления и точную квалификацию в `knowledge` GitHub Actions, Codex только для недоступного Windows GUI и независимой финальной приёмки. До общей G4 `T3_READY=false`, `G4=NOT_ACCEPTED`.
