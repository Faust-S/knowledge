# IWXA T3 0.3.1-rc.5: опубликованный переносимый выпуск

Дата: 27.11.2026. Статус: PUBLISHED_ENGINEERING_QUALIFIED_PRERELEASE.
Стабильная версия 0.3.0 не заменена. Это поставка общей технологии, не приёмка
конкретного домена или установленной программы.

## Идентичность и доставка

- [Постоянный предварительный выпуск](https://github.com/Faust-S/knowledge/releases/tag/t3-platform-v0.3.1-rc.5), release ID 460684587.
- [platform-inputs.zip](https://github.com/Faust-S/knowledge/releases/download/t3-platform-v0.3.1-rc.5/platform-inputs.zip): 15 143 194 bytes, 174 файла манифеста.
- [candidate-receipt.json](https://github.com/Faust-S/knowledge/releases/download/t3-platform-v0.3.1-rc.5/candidate-receipt.json).
- Source commit: a50d40dafc2e029fcc7668dece925f7fc38cc510; tag t3-platform-v0.3.1-rc.5 указывает непосредственно на этот commit.
- Repository tree: d375181e1fd79953cdb9ef4e414936e76b584100; package tree: 372c6cb67f1167ba43c08322c86bfce861db1831; src tree: 3a391777a51012e51356b61b9d61bc94c511de67.
- SHA-256 ZIP: 381e9845fea164569d9363dd4e0983b5d9971347450e93246c1ebd5023fb98c4.
- SHA-256 manifest: ef5824279883296d836eacb7ba00f352be357d0dd5c49e26b32ec1a02a336e48.
- SHA-256 receipt: b143465218cf338ed6a07f16c6a59a93c0d546f0a748064a9fd5f2f844263596.
- SHA-256 inventory: 2851e1d85a05742ee3cc60ee4727f78e966c899dd9062fff6ecfd8b239204245.
- Actions artifact 15203239524 является внешней ZIP-оболочкой, не внутренним platform-inputs.zip. Постоянный выпуск не зависит от срока хранения Actions artifact.
- Оригинальный Kernel 0.3.6 / Contract 1.3.0, artifact iwxa-kernel-k036-same-store-history-20261019-qualified.1, SHA-256 7075b8b9590ef1283e34ecb3c21dd9d1b7342697287e1aa150cd4f4a60860b68; кандидат Event не повышен.
- WebLLM 0.2.87, lock SHA-256 371e320623c14623cbf3e47081355c4181b23d9541b76323600ed49dcb9fb24b.

## Изменения и подтверждения

- Унаследованы оригинальные Host/Kernel/Store/Exchange/Lifecycle и ранее принятые T3 D1-D7. Один Store, один T3 на продукт, один конечный dist.
- Включены общий Exchange с корректным повторным импортом, исправление преждевременного прекращения BLI по времени, original assistant 3b8c2fb25bf5205e53331f5db3e035210b7aac9f, Workflow W05.49. W05.50-W05.56 не переносились из-за отказа их отдельной квалификации на момент заморозки.
- [46012582910](https://github.com/Faust-S/knowledge/actions/runs/46012582910): 6/6 jobs SUCCESS; Node 1220/1220, Vitest 1243/1243, дополнительные 96/96, Workflow 260/260 и 26/26. Не складывать перекрывающиеся регрессии как уникальные тесты.
- Реальный Host: два окна, одна Service Worker, холодный автономный запуск и полный оригинальный .iwxa с двумя независимыми Store, историей, связью, вложением, схемами и неизвестными расширениями PASS.
- Доменный помощник: реальные формы Club, четыре viewport, 26 форм и 13 подсказок по результатам на каждом из двух viewport, точное чтение и ручное применение. Модель в этом сценарии не запускалась. Оригинальный доменный код и закрытый помощник не включены в публичный ZIP.
- [46013611017](https://github.com/Faust-S/knowledge/actions/runs/46013611017): проверены внешний и внутренний ZIP, 174 SHA-256, готовый Host запущен на отдельном runner без повторной компиляции. Повторён штатный cold/offline и независимый .iwxa readback, BLI panel/consent. Digest каждого из четырёх опубликованных release assets совпадает. Первый запуск публикации 46013486051 остановился из-за глубины checkout, исправление касалось только доставки.

## Применение

Доменный разработчик получает точный архив и receipt по release tag, проверяет SHA-256,
использует прежние команды t3:platform:verify / t3:platform:import / t3:host:prepare
(или существующие эквиваленты), сохраняет предметную логику и идентичность сервиса.
Никакого нового интегратора или онлайн-зависимости сайта от репозитория T3.
Прежние platform inputs и стабильный сайт сохраняются до собственной приёмки.
Для доменного помощника согласовать его отдельный original assistant pin и domain skills;
не использовать публичный generic ZIP как готовый домен. Обычный T2/персональный
Exchange не требует корпоративного Agent/Admin маршрута.

## Оставшаяся приёмка

В опубликованном rc.5 на Linux доступен Google SwiftShader; реальная модель в этих
двух CI не скачивалась и не исполнялась. Старый стабильный hardware PASS относится
к своему commit, не к rc.5. Для аппаратной проверки нового BLI используется прежний
штатный сценарий t3-d5-full-bli.browser.mjs на macos-latest (ранее PASS 44913691238),
не новая проверочная система. Входом служит готовый release ZIP без сборки; выбран
существующий лёгкий профиль Qwen2.5-0.5B-Instruct-q4f32_1-MLC. Требуются настоящий WebGPU,
генерация, редактирование, сохранение и холодное восстановление модели с новой
офлайн-генерацией и оригинальным Kernel readback. Недоступный GPU не равен PASS.

Независимая пользовательская приёмка встроенным браузером Codex или на доступном
реальном устройстве пока не выполнена. PWA OS install и физические телефоны не
квалифицированы этим выпуском. Подписанный Agent/Admin A-B-A и исправление Event
остаются отдельным направлением. T4, main, установленные продукты и стабильные
пины не изменены. Приёмка rc.5 не присваивает PRODUCT_ACCEPTED другим продуктам.

Источник истины о публикации: current_release.portable_prerelease в
handoff/G4_PRODUCT_RELEASE_EVIDENCE_CURRENT.json. Замороженный source manifest
внутри ZIP отражает состояние до qualification, не является новым статусом.
Существующий current_release.core_release сохраняет стабильную 0.3.0.
