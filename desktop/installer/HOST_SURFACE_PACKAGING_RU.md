# IWXA Activity: комплект доверенной поверхности в Setup Core

**Состояние:** подготовка упаковки, не приёмка корпоративного подписанного чтения.

## Что входит в установку

Единственный штатный Setup Core устанавливает исполняемый `iwxa-activity-base-desktop.exe` и три **пассивных** файла под `host-surface/`:

- `iwxa-activity-host-surface.js` (ES-модуль из существующего `src/host-surface.tsx`; React предоставляется доверенным приложением)
- `iwxa-activity-host-surface.css`
- `brand.svg`

Они собираются штатной командой `npm run build:host-surface` **перед** Tauri build. Пакет Setup Core включает пути, длины и SHA-256 каждого файла в своём оригинальном manifest. При нативной установленной квалификации выполняется независимое сравнение исходных и установленных SHA-256.

## Чего это НЕ делает

Само наличие ES-модуля в каталоге `host-surface/` **не предоставляет** `activity.read`, не подключает приватный original D2 Owner и не открывает отдельный HTTP, IPC, Kernel, Store или собственную Workspace.

Standalone `src/main.tsx` по-прежнему монтирует `<App />` без `t3Host` и честно показывает `HOLD: T3_TRUSTED_HOST_NOT_CONNECTED`.

Оригинальный подписанный T3 Owner (когда он станет частью установленного Activity) должен передать **только** `{readSelected,subscribeInvalidation}` или тот же контракт с `stageSelected` и `recoverSelected`, внутри своего доверенного Host. Никогда не размещать в этих трёх статических файлах корпоративный bearer, гранты, ключи, D2-строки или самостоятельное создание Workspace.

## Критерий P1

Поставка ассетов = `INSTALLABLE_HOST_SURFACE=PASS`, **не** `ORIGINAL_SIGNED_D2_INSTALLED=PASS`. Для последнего необходима отдельная фактическая приёмка: исходный корпоративный Workspace в настоящем Kernel, подписанное `activity.read`, UI, отзыв права, повторный холодный запуск и отсутствие исходных идентификаторов в UI.

Единственный нормативный runtime: оригинальный T2 0.3.6 внутри T3 0.3.0; корпоративная Workspace, права и отзыв принадлежат оригинальному T3/Center владельцу, не Activity.
