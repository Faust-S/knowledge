# HOP D09: заключительная сборка единого сайта с оригинальным T2

21.11.2026. Инструкция для Codex. **Разработка исходников завершена на указанном SHA.**

## Квалифицированные входы, никаких плавающих веток

| Компонент | Точный источник |
| --- | --- |
| HOP UI, редактор, авторские произведения, Pixel Avatar, Workspace, экспорт и Player | `Faust-S/hop.iwxa.ru@85242763d452546e9ee07338ee983613194bace1` |
| Дерево HOP | `7789cf752cc0fa295e65ce13847e83dede77578a` |
| Нормативный T2, исходники `t2/current/final-successor/canonical-source` | `Faust-S/T2@9c64951cd78411283e8a416641c36d71e169fc1d` |
| Дерево T2 | `56e55a9458aeb3ce540ef87dbc2dd9549ae2fcb2` |
| Kernel | `iwxa-kernel-k036-same-store-history-20261019-qualified.1` |
| Kernel ZIP SHA-256 | `7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68` |
| Kernel `runtime.js` SHA-256 | `e1737245aba309e900203b458087ca07cb08d9ccc89901754e1122cbc9a01e78` |
| Origin | `https://hop.iwxa.ru` |

Нормативный T2 не менять. Использовать только исходные, уже проверенные механизмы T2, Kernel, Workspace, Exchange и Lifecycle. Не создавать альтернативные Store, Host, Kernel, Router или формат проекта.

**Итоговая квалификация точной ревизии:** [GitHub Actions №44917376504](https://github.com/Faust-S/knowledge/actions/runs/44917376504) — **SUCCESS**. Подтверждены npm/TypeScript и контрактные тесты, отсутствие остаточных ссылок и файлов стороннего конструктора, 24 экспорта `.iwxa`, два варианта единого `dist/` с оригинальным T2 и нормативным Kernel, фирменный favicon HOP на публичных и Host-маршрутах, реальный HTTPS-браузер, первая Workspace, холодное восстановление проекта и авторский маршрут передачи PNG, ленты сцен, редактируемого `.iwxa` и автономного HTML. Независимая предыдущая проверка [№44916841377](https://github.com/Faust-S/knowledge/actions/runs/44916841377) также прошла. **Разрешена исключительно финальная упаковка этой точной ревизии по инструкции ниже, без повторных тестов и правок кода.**

## Единственная задача Codex

Проверить SHA двух чистых checkout, независимо сверить два хеша квалифицированного Kernel, запустить штатную сборку, упаковать содержимое полученного `dist/` и вернуть ZIP с манифестом. **Не разрабатывать, не форматировать код, не добавлять проверки, не запускать новый браузерный цикл, не изменять исходники, не активировать production.** При блокирующей ошибке вернуть её точный текст; нельзя заменять общие T2 или Kernel экспериментальными сборками.

### 1. Подготовка Windows

- Чистый checkout HOP на SHA из таблицы, отдельно чистый checkout T2 на указанном SHA. Разместить их и распакованный Kernel вне каталогов друг друга. Не использовать ранее созданные `dist/`, `node_modules` или npm-cache с неуспешных попыток.
- Node.js 24; npm из `package-lock.json` HOP. Сверить HEAD и TREE до любых операций. Только `npm ci`, без перегенерации lockfile.
- Чтобы избежать исторической ошибки Windows `EPERM`, использовать собственные npm-cache, npm-logs, TEMP/TMP. Не чистить системный кэш и не менять исходники.

Пример PowerShell из чистой рабочей копии сайта:

```powershell
$root = "C:\IWXA-Codex\HOP-2026-11-21"
New-Item -ItemType Directory -Force "$root\npm-cache", "$root\npm-logs", "$root\temp" | Out-Null
$env:npm_config_cache = "$root\npm-cache"
$env:npm_config_logs_dir = "$root\npm-logs"
$env:TEMP = "$root\temp"
$env:TMP = "$root\temp"
npm ci --no-audit --no-fund
```

### 2. Сборка только одной версии сайта

Указать действительные абсолютные пути на Windows. `D09_QUALIFIED_KERNEL_DIST` должен указывать на **распакованный и проверенный** release-dist, не ZIP:

```powershell
$env:D09_T2_CANONICAL_SOURCE = "C:\ABSOLUTE\PATH\T2\t2\current\final-successor\canonical-source"
$env:D09_QUALIFIED_KERNEL_DIST = "C:\ABSOLUTE\PATH\kernel-qualified-release-dist"
$env:D09_ORIGIN = "https://hop.iwxa.ru"
$env:D09_ASSEMBLY_ONLY = "1"
$env:D09_ASSEMBLY_ONLY_CONSENT = "NO_NEW_TESTS_EXACT_QUALIFIED_INPUTS"
npm run build
```

Режим assembly-only пропускает повторные продуктовые тесты; встроенные генераторы, проверки исходных хешей и целостности выполняются штатно, без редактирования кода. Итоговая папка `dist/` должна объединять публичный HOP, настоящую Workspace, Exchange, Lifecycle, оригинальный Host/Kernel, медиа, редактор, собственные `favicon.svg`/`favicon.ico` и `recipient/hop-portable-player.iife.js` с CSS для автономного HTML. Нельзя вместо неё выдать отдельный публичный Vite-сайт.

### 3. ZIP и манифест

После успешной сборки упаковать **содержимое** `dist/` без внешней папки `dist`. В корне ZIP должны находиться `index.html`, `avatars/index.html`, `workspace/index.html`, `workspace/exchange/index.html`, `workspace/lifecycle/index.html`, `recipient/hop-portable-player.iife.js`, `favicon.svg`, `favicon.ico`, `_iwxa/` и скрытый `.htaccess`.

Имя архива: `HOP_IWXA_HOSTING_20261121_85242763.zip`. Для включения скрытых файлов допустим `[System.IO.Compression.ZipFile]::CreateFromDirectory` с `includeBaseDirectory = false`.

Создать `HOP_IWXA_HOSTING_20261121_85242763.manifest.json`: исходные SHA/TREE сайта и T2, Kernel ZIP/runtime SHA-256, origin, количество файлов, размер ZIP, SHA-256 ZIP и статус `DEPLOYED=false`.

Контроль наличия файлов и вычисление хеша ZIP являются проверкой **упаковки**, а не повторной независимой приёмкой кода. Скриншоты на GitHub не сохранять. Возвращаются только ZIP и manifest для ручной загрузки на статичный хостинг. `main`, русский исходник других доменов и действующий production не изменять.

**Выпуск не считается развёрнутым**, пока владелец не загрузит архив на хостинг и не подтвердит результат.
