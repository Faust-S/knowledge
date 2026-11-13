# IWXA T3 One Core. Передача в новый чат, 13 ноября 2026

**Статус:** продолжается разработка единого автономного T3 как технологической основы существующих программ и доменов. **T3_READY=false, G4=NOT_ACCEPTED.** Этот документ заменяет недействительный путь разработки самостоятельного Windows Control.

## 1. Первый маршрут нового чата

1. Прочитать этот файл полностью, затем корневой [AGENTS.md](https://github.com/Faust-S/knowledge/blob/work/2026-11-10-t3-t2-activity-projection/AGENTS.md), [карту 42 репозиториев](https://github.com/Faust-S/T3/blob/work/2026-11-10-t3-t2-upgrade-core/architecture/T3_ONE_CORE_ALL_DOMAINS_SOFTWARE_AI_SOURCE_MAP_2026_11_11_RU.md) и [план B0, D1-D7, G4](https://github.com/Faust-S/T3/blob/work/2026-11-10-t3-t2-upgrade-core/planning/T3_DELTA_ACCEPTANCE_RU.md).
2. Получить **свежие** HEAD/TREE двух веток `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection` и `Faust-S/T2@main`; проверить новейшие публичные Actions knowledge, не доверять датированным HEAD как вечным.
3. Учесть новые правила: T3 - **библиотеки и исполняемые функции внутри существующих Host**, не самостоятельный Windows EXE или обязательный sidecar. Первая задача - продолжить недостающие D1-D7 операции в оригинальном T3, без новой инфраструктуры.
4. Перед кодом проверить исходные порты Kernel/Host/Access/Exchange и owners конкретного продукта. Один предметный потребитель за раз, сначала фактический пользовательский маршрут.
5. Не откатывать параллельные изменения; создавать рабочую ветку от свежего T3; проверять только публичными Actions в **knowledge**; интегрировать обычным fast-forward или честным merge, без force push.

## 2. Исправленная архитектура (обязательно)

- **Единственное исполняемое T3:** [knowledge/packages/t3-core](https://github.com/Faust-S/knowledge/tree/work/2026-11-10-t3-t2-activity-projection/packages/t3-core). Содержит преемника T2 0.3.6 / Runtime Contract 1.3.0, прежний Kernel, Host, Store, Workspace, Object/Event/Result, Lifecycle, Factory, Exchange, BLI и дополняющие T3 функции.
- [T3](https://github.com/Faust-S/T3) - **теория и история**, не runtime-import, не рабочая CI/внешний checkout. [T2@main](https://github.com/Faust-S/T2/tree/main) - нормативная база только для чтения.
- **Никакого отдельного T3 Control EXE, установщика, нативного меню или второго Host-процесса как обязательного приложения.** Разработка этого EXE была фатальной инициативной ошибкой ИИ, отменённой владельцем. Исходники и CI удалены в [коммите efcc46bb](https://github.com/Faust-S/knowledge/commit/efcc46bbf31263ad1b15ebad000462994ff4eaa8) и квалифицированы [#43495419145](https://github.com/Faust-S/knowledge/actions/runs/43495419145). Старые ветки и CI-артефакты исторические, их нельзя восстанавливать.
- **Сохраняются как технологические API:** `src/t3/signed-access-host-port.mjs`, `src/t3/original-control-http-handler.mjs`, `src/t3/control-loopback-owner.mjs`, `src/t3/access/original-kernel-registry-state.mjs`, `src/t3/access/local-vault.mjs`, `src/t3/access/original-vault-proof.mjs`, `src/t3/subject-access-binding.mjs`. Их назначение - подключение к собственному доверенному Host, а не самостоятельное ПО.
- Не создавать новый Core, Kernel, Store, IAM, Router, Task Engine, Project engine, Service Worker или формат вместо `.iwxa`. Изданная лицензия Publisher не равна полномочию на Workspace, работа Agent не требует Admin или модели T3.

## 3. Выполнено и проверено в этой передаче

**Исходная база основной ветки:** `b7dd5edebeee05718cece5fa03e557de55583d2d`; позже параллельно пришёл документальный коммит `8903575e1d4402598f62dddfdd1d2a5c4eca4a82`, он сохранён.

**Новая D1-квалификация:** изменён только существующий `tests/t3-d1-real-host-process-restart.browser.mjs` и название шага в существующем workflow. Теперь проверка поднимает **три отдельных процесса Node Host**: первая запись исходным T2 Kernel, подписанный отзыв; первый холодный restart; второй холодный restart. Каждый повторно открывает **один и тот же** T2 0.3.6 Store/Chromium profile, расшифровывает неизменённый original encrypted Ed25519 vault, видит STATUS seq=2 и отвергает запись отозванного субъекта, сохраняя прежний объект.

Квалификационная ветка: `work/2026-11-13-t3-d1-two-cold-hosts-and-handoff`, проверенный исходник `e126c35ff9368ca914b03d876ef577a49e90cd99`. Публичный [Actions #43497173470](https://github.com/Faust-S/knowledge/actions/runs/43497173470): **COMPLETED SUCCESS**; `test=SUCCESS`, `real-host=SUCCESS`, `windows-credential=SUCCESS`; `metal-webgpu=SKIPPED`. Исполняемый реальный Host test marker: `T3_D1_TWO_COLD_NODE_HOST_PROCESS_RESTART_STATUS_PASS`.

**Что этот PASS доказывает:** две остановки и новые процессы Host, сохранность STATUS/Kernel данных/дискового зашифрованного vault в PERSONAL-профиле, отказ после signed revoke. Он **не** доказывает завершённое D1 для PERSONAL + двух CORP в одной установленной программе, производственного issuer или G4. Две CORP подписанные организации и собранный AppShell ранее проверялись отдельным настоящим тестом [Actions #43475202419](https://github.com/Faust-S/knowledge/actions/runs/43475202419), но не склеивать два раздельных PASS в ложное продуктное принятие.

**Проверка архитектуры:** не добавлены новый Host, отдельная программа, стороннее хранилище, собственный сертификатор, формат или приватные зависимости. Параллельные изменения Activity и `AGENTS.md` не перезаписаны.

## 4. Где подключать к существующему ПО (только через штатные порты)

- [Personal Agent](https://github.com/Faust-S/iwxa-personal-agent): Tauri/React + Python Core, Task/Graph/Result. Действующий частичный T2 consumer `adapters/t2_domain_exchange_v1.py`, `runtime/t2_domain_file_bridge.py`; `t3_enabled` сам по себе не означает встроенный T3 Kernel. Не вводить второй Task Engine.
- [Atlas](https://github.com/Faust-S/Atlas): `src/project-host-port.mjs`, `desktop/src/embedded-host.ts` и `desktop/src/iwxa-portfolio.mjs`; ещё требуется реальный T3 Host owner для корпоративных операций, а не новая оболочка.
- [Admin Center](https://github.com/Faust-S/Center): `runtime/t3-admin-port.mjs`, `runtime/cen-corporate-owner-host.mjs`, `src-tauri/src/t3_consumer.rs`; без одобренного signed owner оставлять `REFERENCE_ONLY`.
- [Publisher](https://github.com/Faust-S/Center): `publisher/src-tauri/src/t3_owner.rs`, `native/t3_product_component.rs`; уже использует служебный owner/consumer конкретной программы, не T3 Control GUI. Производственное подписание и коммерческая активация отдельно не приняты.
- [IWXA Activity](https://github.com/Faust-S/knowledge/tree/work/2026-11-10-activity-base-anonymizer): `modules/activity-base-anonymizer/t3-control-host-link.mjs` и `t3-selected-host.mjs` читают через существующий selected Host с read-only authority. Это consumer, а не часть ядра.
- P/U/K owner-источники: [U01-U04](https://github.com/Faust-S/Br-test), T0/T1, исходный T2. Не заменять эти механизмы собственным T3 Router/Program Center.
- **Ни один из сторонних owner-репозиториев при этой работе не изменён.** Встраивание в конкретный продукт вести его отдельным циклом, после завершения подходящей версии T3.

## 5. Незакрытые продуктовые критерии

1. **D1:** на одном штатном Host потребителя PERSONAL + две независимо подписанные CORP, операции в собственных Workspace, два cold Host restart, реальный отзыв и изоляция, Result/`.iwxa` roundtrip. Не отдельный EXE. Без реального производственного issuer не ставить продуктовый PASS.
2. **D2:** продолжить T0/T1 read-only semantic projection и измеряемые оригинальные Object/Event/Result; не дублировать текущую параллельную ветку Activity.
3. **D3-D4-D7:** независимые owner/recipient signed Task/Result и Review/Accept/Apply, общий исходный `.iwxa` и возрастное age-шифрование через оригинальные функции, без подмены лицензии правами на данные. Точный статус каждой строки подтвердить кодом и CI перед разработкой.
4. **D5-D6:** browser-local WebGPU/WebLLM и одна выбранная нативная модель; продолжаемый signed Result между настоящими consumer Host. Не требовать установленного Agent/Control/другой программы ради домена, не автоматизировать скачивание весов.
5. **G4:** единый зафиксированный кандидат B0 + D1-D7, отказовые кейсы, 2 cold restart, один dist на продукт/домен, нулевой обязательный внешний egress в LOCAL_ONLY. Только после этого `T3_READY`, а затем по одному домену.

**Не создавать очередной gate из-за отсутствующего Windows T3 Control.** Пробелы закрывать в существующих технологических функциях и штатных программах. Уже поддерживаемые функции T2 не разрешается терять из-за обёрток D1. Тесты с TEST issuer не повышают коммерческий статус.

## 6. Точный промпт для нового чата

Продолжай самостоятельную разработку единого автономного IWXA T3 как **встраиваемого технологического уровня**, а не отдельной программы. Первым действием полностью прочитай:

https://github.com/Faust-S/knowledge/blob/work/2026-11-10-t3-t2-activity-projection/packages/t3-core/handoff/T3_ONE_CORE_NO_STANDALONE_D1_TWO_COLD_NEXT_CHAT_2026_11_13_RU.md

Затем `AGENTS.md`, архитектурную карту 42 репозиториев, план B0/D1-D7/G4 и отмеченные owner-source файлы. Сверь новые HEAD/TREE, CI и соседние ветки; не откатывай чужие изменения.

Продолжай в `Faust-S/knowledge/packages/t3-core`; весь исполняемый код и публичные Actions только там. T3 - полный преемник T2 без второго Kernel/Host/Store/IAM/Task Engine и без нового `.iwxa`. Отдельный Windows Control EXE и его специальные Host/DPAPI/UI механизмы запрещены как ошибка ИИ; не восстанавливай их из истории. Admin Center, Publisher, Atlas, Personal Agent, Activity и домены подключаются через **свои действующие** Host и исходные интерфейсы U01/U03/U04. Не изменяй их владельческие репозитории без отдельного поручения.

Исходная новая D1 проверка с двумя холодными перезапусками: `e126c35ff9368ca914b03d876ef577a49e90cd99`, Actions #43497173470 SUCCESS. Это точная квалификация PERSONAL, не вся G4. Выбирай следующую конкретную недостающую **пользовательскую** функцию D1-D7, сначала анализируй исходного owner и действующий T2 API, затем реализуй минимальную правку, испытай на настоящем Kernel и `.iwxa`, опубликуй коммиты и точные результаты CI. Codex использовать только для недоступного Windows GUI или независимой финальной приёмки. В завершение обнови handoff и статусы; пока G4 не принят, `T3_READY=false`.
