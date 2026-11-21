# D04 BazMed Life OS: принятые исходники и передача финальной сборки Codex

Дата: 21.11.2026. Статус: **SOURCE_READY_FOR_CODEX=true**. Производственный архив и загрузка на хостинг **не выполнены**.

## Единственный квалифицированный исходный набор

- Сайт и T2-интеграция: `Faust-S/bazmed.ru@release/2026-11-21-life-os-hosting`, HEAD `15021a0343032aaeaef6b1cee98387a00c052389`, TREE `e0f42087527796c41a0c9e23829547874cd7c8ef`.
- Предметная модель: `Faust-S/bazmed@d0f6ec9d50c01891ed1001fb872ac2d5770e8f0d`.
- Оригинальный T2: `Faust-S/T2@9c64951cd78411283e8a416641c36d71e169fc1d`; Kernel 0.3.6, Runtime Contract 1.3.0.
- Оригинальный runbook в сайте: `qualification/D04_HOSTING_RELEASE_CODEX_RUNBOOK_2026_11_19_RU.md`. Его ссылка на релизную ветку 19 ноября **устарела**. Нормативен новый SHA и новая ветка, указанные выше. Не собирать старую ветку или плавающий `main`.
- Публичный CI: `Faust-S/knowledge@work/2026-11-18-d04-life-os-qualification`. В нём проверялся код приватных репозиториев без публикации исходников, `dist/`, профилей или `.iwxa`.

## Шесть независимых испытаний на одном SHA сайта

| Проверка | Результат |
| --- | --- |
| Полный Host/Kernel, маршруты, мобильный интерфейс, единый тестовый dist и хостинговые гейты | [SUCCESS №44943626345](https://github.com/Faust-S/knowledge/actions/runs/44943626345) |
| Непрерывная Life OS, Result CAS/история, холодное восстановление и динамика двух расчётов | [SUCCESS №44943648471](https://github.com/Faust-S/knowledge/actions/runs/44943648471) |
| 10 протоколов, 10 Object, 20 событий Kernel, две редакции, холодный readback, независимый .iwxa | [SUCCESS №44943617286](https://github.com/Faust-S/knowledge/actions/runs/44943617286) |
| Recover 1–3, история, холодный T2 и независимый Exchange .iwxa | [SUCCESS №44943620022](https://github.com/Faust-S/knowledge/actions/runs/44943620022) |
| Все 13 числовых инструментов, 16 граничных проверок, Waterlow 2005, ширины 320/375/768/1440 px | [SUCCESS №44943622103](https://github.com/Faust-S/knowledge/actions/runs/44943622103) |
| Запись/исправление личных наблюдений, исходные источники, CAS, история, динамика, холодный T2 и .iwxa | [SUCCESS №44943630061](https://github.com/Faust-S/knowledge/actions/runs/44943630061) |

Интегрированный CI: `D04_HOSTING_DIST_GATE=PASS`, `D04_HOSTING_DIST_CHECKS=PASS`, TypeScript PASS, T2 Entry PASS, семантический ESLint PASS. Последний тестовый дистрибутив: 799 статических маршрутов, 1444 файла, 83 885 259 байт. Пустой Host: первый полезный экран 1611 мс, возврат из инструмента 679 мс, открытие обзора 324 мс в изолированной среде CI; это не пользовательские сетевые SLA.

Полный исторический Prettier lint продолжает фиксировать накопленный долг форматирования. Это не семантический ESLint и не причина массово переформатировать код перед выпуском. Сохранять результаты отдельно.

## Нормативный маршрут Codex

1. В отдельных чистых checkout получить три репозитория **по указанным SHA** и проверить HEAD/TREE, чистоту рабочих деревьев, байтовый паритет персональной модели наблюдений между `bazmed` и `bazmed.ru`. Не изменять T2 и предметную модель.
2. Использовать Node.js 22 и `npm ci --no-audit --no-fund --include=dev` в каталоге сайта. Не менять lockfile и не устанавливать новые версии.
3. Задать в рабочем процессе `IWXA_T2_SOURCE_DIR`, `BAZMED_SUBJECT_SOURCE_DIR`, `D04_RELEASE_SITE_SHA=15021a0343032aaeaef6b1cee98387a00c052389`. Не задавать `IWXA_T2_PRODUCT_CHALLENGE` или `IWXA_T2_CAPABILITY_CONTROL_PLANE` при финальной производственной сборке.
4. Запустить **`npm run release:check-source`**, затем **`npm run build:t2:site`**. Не вызывать отдельно `npm run build:static` после интеграции: эта команда затрёт Host в едином `dist/`.
5. Выполнить `npm run release:verify-dist` и `npm run release:check-dist -- --manifest ../bazmed-dist-inventory.json`. Inventory оставлять вне `dist/`; не публиковать его на сайте. Проверить `D04_HOSTING_DIST_GATE=PASS`, все обязательные файлы и точный Kernel runtime SHA.
6. Подтвердить состав **единственного** статического `dist/`: публичный сайт, `workspace/index.html`, `workspace/exchange/index.html`, `workspace/lifecycle/index.html`, `_iwxa/current.json`, runtime Kernel 0.3.6, `.htaccess`, все локальные ресурсы. Проверить отсутствие исходников, debug-служб, `node_modules`, пользовательских данных, токенов и входных `.iwxa`.
7. Codex независимо провести визуальную/функциональную приёмку **своим встроенным браузером**, без Playwright/Puppeteer/Chromium как инструментов приёмки: 375 и 1440 px, меню/поиск, главная → задача → калькулятор/протокол → подтверждённый Result → «Сегодня»/«Мои изменения»/«История» → исправление → холодное чтение → независимый Export/Import `.iwxa`. Проверять только на чистом профиле, без реальных данных владельца.
8. Упаковать **содержимое** `dist/` (включая скрытый `.htaccess`) в архив для document root. Сверить архив с внешней инвентаризацией, SHA-256 и числом файлов. Не добавлять промежуточную папку `dist/` в URL. Отдельно передать владельцу путь к архиву, его хеш, отчёт приёмки и процедуру отката.
9. **Не загружать** архив на работающий `bazmed.ru` без отдельного решения владельца. Перед будущим размещением сделать резервную копию текущей серверной статики и `.htaccess`; не очищать личные Workspace в браузерах пользователей.

Изготовление `dist/` через CI не считается финальной сборкой и не заменяет собственную приёмку Codex. Будущие персональный Life Index, T3 и междоменные Health Context/Decisions/Studies не объявлять готовыми; не показывать фиктивный персональный индекс.

## Разделение статусов

- `SOURCE_READY_FOR_CODEX=true`
- `QUALIFIED_SOURCE_SHA=15021a0343032aaeaef6b1cee98387a00c052389`
- `SIX_NATIVE_CI_GATES=PASS`
- `FINAL_DIST_BUILD=PENDING_CODEX`
- `FINAL_ARCHIVE=PENDING_CODEX`
- `HOST_DEPLOYMENT=NOT_STARTED`
- `PRODUCTION_ACCEPTANCE=PENDING`

Репозиторий `main` и оригинальный T2 не изменялись в этой подготовке; релизная ветка создана отдельной ссылкой на принятый коммит.
