# IWXA T3 One Core. D3, точные подтверждения асинхронного Host, передача 14.11.2026

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
