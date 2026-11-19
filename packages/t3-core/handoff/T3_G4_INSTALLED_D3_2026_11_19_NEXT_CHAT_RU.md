# IWXA T3 G4: передача установленного D3, 19.11.2026

> Первое действие нового чата: **полностью прочитать этот документ**, затем
> `AGENTS.md` репозитория `Faust-S/knowledge`,
> `packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`,
> `packages/t3-core/docs/T3_G4_D3_NATIVE_HUMAN_DECISIONS_AND_PRODUCT_GATE_2026_11_19_RU.md`,
> актуальный нормативный T2 и проверенные CI. **Сразу** опросить живые
> HEAD/TREE всех затрагиваемых веток и исходы Windows
> [#44505177227](https://github.com/Faust-S/knowledge/actions/runs/44505177227)
> и повторного [#44507093613](https://github.com/Faust-S/knowledge/actions/runs/44507093613).
> HEAD внутри этого документа — зафиксированный ориентир, не вечный pin.

## 0. Цель, недопустимые архитектурные отклонения

Закончить **единый автономный исполняемый IWXA T3** как преемник T2
до установленного G4, а не расширять набор исследовательских обёрток.
Единственный общий исполняемый T3: `Faust-S/knowledge/packages/t3-core`;
нормативный наследуемый Kernel **T2 0.3.6**, Runtime Contract **1.3.0**.
Частный `Faust-S/T3` — **исходный владелец** подписанта/Access,
корпоративного Native D3, доверенного импорта и существующих приватных
проверок, не второй T3 Core. Center и Agent владеют своими нативными
интерфейсами, локальным состоянием и предметными операциями.

**Не создавать** другой Kernel/Host/Workspace/Store/IAM/Exchange/
Router/Task Engine, другой `.iwxa` формат, отдельный Control EXE
или фиктивные квитанции. Atlas — подключаемая самостоятельная программа
Agent/Admin, **не обязательный** посредник D3, D5, generic D6 или D7.
Обычная Task и Workspace должны работать без WorkRef/Atlas.
Для сайтов каждый конечный `dist/` собирается из **одного репозитория
сайта**, где закреплён проверенный выпуск T3; обычная сборка не
клонирует репозитории разработчиков T2/T3.

Публичные GitHub Actions допускаются **только в `Faust-S/knowledge`**.
Частные оригинальные T3/Center/Agent при необходимости читаются там
только из точно закреплённых SHA, выборочно, с минимально разрешённым
`Contents: Read`, затем полностью удаляются с runner.
**Не запускать Actions в закрытых репозиториях**, не загружать
приватные исходники, EXE, `dist/`, журналы ошибок с секретами,
DPAPI-ключи/архивы и пользовательские данные в открытые artifacts.
Секрет `DOMEN` использовать только в доступных конкретному
репозиторию рамках. Не прибегать к Atlas ради прохождения G4.
Самостоятельная реализация и GitHub Windows CI первичны;
Codex допустим только для действительно недоступной операции
и независимой финальной приёмки.

## 1. Точные исходные владельцы на момент передачи

| Владелец | Рабочая ветка и ориентир HEAD | Назначение |
| --- | --- | --- |
| One Core + публичный Windows CI | `Faust-S/knowledge@work/2026-11-10-t3-t2-activity-projection`; текущий проверенный исходный срез **381e7fd25a885bda5145ac3d56de858551f2f21b** (точный CI pin нового installed ретеста, затем registry/handoff обновлены) | единственный T3, квалифицированный T2, One Dist, публичная приёмка |
| Оригинальный частный подписант | `Faust-S/T3@work/2026-11-16-admin03-independent-employee-owner`, **ea1700ec0ce8524ead8b30f23ddb7a8611597ba8** | оригинальный корпоративный DPAPI Owner, Ed25519, Human ACCEPT/APPLY и сборщик native D3 |
| Нативный Admin Center | `Faust-S/Center@work/2026-11-18-admin03-generic-d3-lazy-atlas`, **cbad39d9d06e6f7c3c18abdc285bc1569c557976** (исправление реального native d3-enroll argv) | Rust Tauri GUI, OS dialog, Setup Core, предметный профиль T2 |
| Оригинальный Agent IPC в source D3 | `Faust-S/iwxa-personal-agent`, **5638684ab952dffa545d8a374507f494a1a5ef2a** | строго исходный проверенный Node/Python signed Task/Result witness; **не** объявлять текущим HEAD Agent 0.6 без сверки |

Последний установленный workflow пинит именно T3 `ea1700ec`
и Center `cbad39d9`. Точные версии обязан подтверждать CI,
а не автоматически брать HEAD сторонних веток.

## 2. Подтверждённые технологические результаты

**Source/Owner D3: 20/20 PASS.**
[Windows CI #44406073956](https://github.com/Faust-S/knowledge/actions/runs/44406073956)
завершён успешно: производственный оригинальный Windows DPAPI Admin,
отдельно зарегистрированный ключ сотрудника, два оригинальных
подписанных права и Task; настоящие Agent Python/Node IPC,
подписанный Result, исходный Reconciliation, отдельный Human ACCEPT,
**отдельный** Human APPLY, оригинальный `t1.commitObjectGraph`,
Object/Event/read-only recovery и **два холодных браузерных чтения**
того же Kernel. Исторический CLI не может выполнить Human ACCEPT
без подтверждения. Здесь Human действия **явно вооружены тестовым
источником**, это **не** нативный Tauri диалог; все действия проходят
под **одним** Windows OS профилем. Source PASS не равен installed PASS.

**Аппаратный D5 Source**: [Apple Metal
#44340207574, attempt 2](https://github.com/Faust-S/knowledge/actions/runs/44340207574)
подтвердил настоящий WebGPU/WebLLM, первый запуск, холодную
офлайн-вторую генерацию с отсутствием внешних запросов. Это не
независимая установленная приватная продуктовая квалификация D5.

**Установленный Center:** Windows
[#44411947163](https://github.com/Faust-S/knowledge/actions/runs/44411947163)
квалифицировал настоящий Setup Core, исходный приватный подписант,
сверенные SHA, T2 Kernel/One Dist, но первый UIA проверял окно рано.
[#44413171459](https://github.com/Faust-S/knowledge/actions/runs/44413171459)
уже квалифицировал реальное нативное окно, WebView2 React-кнопки,
закрытие WM_CLOSE и обычную Workspace без Atlas.
[#44502925301](https://github.com/Faust-S/knowledge/actions/runs/44502925301)
подтвердил получение локально сохранённого черновика, появление
настоящего Windows-диалога `IWXA T3: подключить организацию`,
физическую отмену с `NOT_CONNECTED`, затем повторное появление
диалога и подтверждающее физическое нажатие.
**FAIL**: после подтверждения тест не получил
`D3_OWNER_READY` / статус `Подписанный T3 D3 получатель доступен`
в ранее установленной границе наблюдения. Это **не значит**, что
криптографический Owner обязательно неисправен или что он успешно
зарегистрирован. Установленный cold-owner readback ещё HOLD.

[#44504959942](https://github.com/Faust-S/knowledge/actions/runs/44504959942)
остановился на публичном parser/preflight Windows UIA, **до**
приватной сборки. Исправление диагностического parser на `790c47a2`.
[#44505177227](https://github.com/Faust-S/knowledge/actions/runs/44505177227)
на этом SHA завершился **FAIL** на установленном native D3:
публичный One Dist, приватная сборка/установка, WebView2, черновик
и реальные Windows диалоги CANCEL и YES с подтверждённым закрытием
**PASS**, но настоящий Center вернул точный исходный код
`T3_PRODUCT_COMPONENT_ARGUMENTS_INVALID`. Анализ
`Center/native/t3_product_component.rs` доказал корень: фильтр
`action.bytes().all(is_ascii_lowercase || '-')` отклонял собственную
команду `d3-enroll` из-за цифры 3 **перед запуском подписанта**.
Исправлено в приватном Center
[`cbad39d9`](https://github.com/Faust-S/Center/commit/cbad39d9d06e6f7c3c18abdc285bc1569c557976):
ASCII digits разрешены только после первой строчной буквы при
сохранении лимита длины, списка разрешённых символов, no-shell argv,
отказа пробелам, Unicode, разделителям пути; добавлены Rust регрессии.
Следующий публичный installed Windows
[#44507093613](https://github.com/Faust-S/knowledge/actions/runs/44507093613)
запущен на точном `knowledge@381e7fd2` и
`Center@cbad39d9`; его **фактический итог обязательно проверить**.

Последний доступный машинный реестр
`G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`
хранит отдельную запись `original_admin_installed_first_use_2026_11_19`.
**Не повышать G4**: `T3_READY=false`,
`production_ready=false`, `G4=NOT_ACCEPTED`.

## 3. Чего нельзя считать исправленным

1. После реального **подтверждения** организации на установленном
   Center необходимо получить исходный `D3_OWNER_READY`,
   холодно восстановить тот же Windows DPAPI Owner через другой
   процесс, а также проверить повторное включение без создания
   нового подписанта.
2. Нужны **два разных Windows-пользователя**/установленные Admin и
   Agent с раздельными vault/подписанными сотрудниками; текущий
   источник использовал один CI OS-профиль.
3. Human ACCEPT и **отдельный** APPLY должны пройти настоящие
   OS-диалоги установленного Center с оригинальными правами,
   `t1.commitObjectGraph` и двумя холодными
   `Object/Event` readback. Не повторять APPLY после lost ACK.
4. Установленный Agent должен выполнить реальную локальную модель,
   Human Review и экспорт подписанного Result `.iwxa`.
5. Универсальные установленные **D6_GENERIC** (любой авторизованный
   предметный получатель без Atlas), **D7_PERSON**
   (Publisher/recipient лицензия, renew/STATUS/revoke) и полный
   продуктовый D5 должны пройти отдельно. G4 — только после
   независимых точных доказательств всех обязательных D1–D7.

## 4. Приоритет немедленной диагностики D3

1. Сначала читать **финальный** run #44507093613 и точные markers
   job `installed-original-admin`, особенно
   `G4_INSTALLED_FIRST_USE_NATIVE_DIALOG_DECISION_CONFIRMED`,
   `G4_INSTALLED_FIRST_USE_NATIVE_WINDOWS_ENROLL_PASS`,
   `G4_INSTALLED_FIRST_USE_NATIVE_OWNER_ERROR_CODE`,
   `G4_INSTALLED_FIRST_USE_ORIGINAL_DPAPI_COLD_RESTART_PASS`,
   `G4_INSTALLED_PRIVATE_SOURCE_AND_BINARIES_NOT_PUBLISHED`.
2. Не запускать целую 5-минутную установку на каждое
   предположение. Проверять Windows UIA helper в **public-one-dist**
   preflight и сохранять независимый smoke при изменениях нативной
   диагностики.
3. При отсутствии `D3_OWNER_READY` установить,
   появилось ли исходное сообщение ошибки Center,
   действительно ли Windows-диалог закрылся после реального клика,
   запускался ли original signed Owner и сохраняется ли
   `registry.json` под правильной организацией. Печатать
   только канонические bounded codes, **не** приватные значения.
4. Исправить именно доказанный дефект в штатном
   `Center/src-tauri/src/cen03_native.rs`,
   `Center/src/CorporatePanel.tsx`,
   original `T3/interop/native-admin-d3.mjs` или
   `knowledge/packages/t3-core/tests/g4-installed-original-center-first-use.ps1`.
   Не обходить native Human consent, не разрешать auto-APPLY,
   не отключать исходные проверки.
5. Повторить точно один публичный Windows CI.
   `SOURCE PASS`, `INSTALLED SETUP/GUI PASS` и
   `INSTALLED ORIGINAL D3 E2E PASS` фиксировать **отдельно**.

## 5. Основные файлы и действия

- `knowledge/.github/workflows/t3-installed-original-admin-center.yml`:
  два этапа (`public-one-dist`, `installed-original-admin`);
  точные sparse checkout T3+Center, без закрытых Actions и публичных
  артефактов. Opt-in коммит `[qualify-installed-d3]`.
- `knowledge/packages/t3-core/tests/g4-installed-original-center-first-use.ps1`:
  настоящий Windows UI Automation/Win32 физический click, bound modal
  и его readback. Использует настоящую установленную Tauri программу.
- `knowledge/packages/t3-core/tests/g4-installed-original-center-smoke.ps1`:
  Setup Core, original Owner SHA-256, One Dist Kernel,
  WebView2-кнопки и graceful WM_CLOSE.
- `knowledge/packages/t3-core/tests/g4-installed-original-one-dist-preflight.mjs`
  и `scripts/materialize-original-admin-t2-product.mjs`:
  квалифицированный T2 + собственный Admin Workspace, не тестовый
  integration.workspace.
- `Center/runtime/iwxa-admin-center-original-t2-profile.json`:
  единственная продуктовая T2-конфигурация Center.
- `T3/scripts/build-admin-center-d3-owner.ps1`:
  исходный приватный Native Owner, `age` по проверенному SHA,
  продуктовый One Dist и Setup Core.
- `knowledge/packages/t3-core/tests/g4-production-original-kernel.browser.mjs`:
  успешный исходный production Task→Agent→Result→Admin
  Human ACCEPT→separate APPLY→два cold readback.
- Реестр `packages/t3-core/handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json`,
  и контракт
  `packages/t3-core/docs/T3_G4_D3_NATIVE_HUMAN_DECISIONS_AND_PRODUCT_GATE_2026_11_19_RU.md`.

## 6. Порядок после завершения установленного D3

Последовательно: installed Agent и второй Windows OS пользователь →
оригинальный native Human ACCEPT и отдельно APPLY → физический
Kernel Object/Event и две cold процедуры → installed generic D6 →
PERSON D7 → отдельный installed/Host D5 → полный G4 release candidate.
Для каждой поставки собственные продуктовые owner/installer и
регрессии, без копирования всего файла из старых веток или нарушений
параллельного Center/Agent. Atlas подключается только по пользовательскому
проектному запросу. Упорядочить release evidence, а не подменять
нативную приёмку подсчётом количества unit-тестов.

**Статус передачи до сверки окончательного CI:**
`D3_SOURCE=20/20 PASS`,
`INSTALLED_T2_ONE_DIST_SETUP_GUI=PASS`,
`INSTALLED_NATIVE_ENROLL_CANCEL=PASS`,
`INSTALLED_NATIVE_ENROLL_CONFIRM_READY=HOLD`,
`INSTALLED_ACCEPT_APPLY=NOT_RUN`,
`D6_GENERIC/D7_PERSON=HOLD`,
`G4=NOT_ACCEPTED`, `T3_READY=false`.


## 7. Инженерный вывод на момент передачи (после #445051)

Ранее отсутствие подписанного статуса ошибочно можно было принять
за отказ криптографии, DPAPI или Human Review. Теперь есть реальный
native machine code и адресная причина **раньше запуска original
owner**: допустимая команда `d3-enroll` отклонялась общим
Windows transport validator. Исправлен только владелец этого Rust
контракта, `Faust-S/Center`, а не T3 Kernel/Access/Store.
Не выполнять ни повторное enrollment, ни новый APPLY автоматически
после неизвестной квитанции. Следующий установленный CI обязан
доказать original `D3_OWNER_READY` и cold DPAPI readback,
затем проверить действительный Human ACCEPT и отдельный APPLY.

В журнале нового CI искать маркеры
`G4_INSTALLED_FIRST_USE_NATIVE_WINDOWS_ENROLL_PASS` и
`G4_INSTALLED_FIRST_USE_ORIGINAL_DPAPI_COLD_RESTART_PASS`;
само нажатие YES или отсутствие прежней ошибки **не PASS**.
Если возникнет иной код — зафиксировать его машинно,
не менять оригинальные полномочия.
