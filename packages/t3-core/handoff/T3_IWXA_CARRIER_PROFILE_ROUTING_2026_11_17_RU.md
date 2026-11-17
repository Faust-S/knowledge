# Единый .iwxa: обязательная маршрутизация исходных профилей T2 / T3 / D6 / D7

Дата: 17.11.2026. Норматив: `Faust-S/T2@main`, единый исполняемый T3 `Faust-S/knowledge/packages/t3-core`, оригинальные подписанные владельцы `Faust-S/T3`.

**Одна расширяемая форма .iwxa не делает все содержимые профили взаимозаменяемыми.** Ошибочно считать подписанный технический carrier пользователя обычным Workspace-архивом T2.

| Перенос | Нативный владелец проверки и применения | Запрещенная подмена |
| --- | --- | --- |
| Обычный T2 Workspace Package | Оригинальный T2 Exchange `importPreview` → отдельный Human confirmation → `importCommit` → Kernel receipt/readback | Нельзя принимать неподписанный JSON или подменять привязки Workspace |
| Подписанный T3 Reconciliation .iwxa | Оригинальный private T3 `inspectReconciliationIwxa`, оригинальные Ed25519/trust/issuer и Reconciliation ledger | Нельзя считать technical/reconciliation/envelope.json самостоятельным T2 `importCommit` без проверки требуемого профиля |
| Подписанный Result Agent → Atlas 0.9 | Оригинальный recipient `iwxa.atlas` + `verifySelectedResult`, Kernel Event/Object, native Atlas U05 Store CAS | Нельзя применять `interop.result.v2` адресованный организации или другую Workspace целиком |
| age-контейнер D7 | Текущий авторизованный age/X25519 recipient → расшифровать → передать исходный внутренний .iwxa правильному владельцу | Нельзя передавать ciphertext непосредственно обычному `importCommit` |
| Лицензионный/STATUS пакет Publisher | Оригинальный лицензирующий T3 issuer + независимый установленный verifier текущего signed STATUS | Не использовать файлы Result как лицензии и наоборот |

Оригинальный `Faust-S/T3/reconciliation/contracts.mjs` использует единый ZIP .iwxa с signed profile: один технический файл `technical/reconciliation/envelope.json` и `manifest.json`. В `createOriginalAtlasResultExchangePort` разрешено содержимое только выбранного Result **в виде исходной ссылки и доказательства**, не Agent memory или файлов другой Workspace. Поэтому получатель Atlas должен применять **свой** native Store и `verifySelectedResult`, а не выполнять обычный T2 Import на этом carrier.

Это правило не создаёт нового формата, импортёра, signer, Store или маршрутизатора. Проверка реальной совместимости каждого профиля с исходным владельцем остаётся в его нативной приёмке. **Совпадение расширения .iwxa и наличие manifest.json сами по себе не доказывают импортируемость.**

**Критерий исполнения:** оригинальный T2 roundtrip отдельно, оригинальный Reconciliation/Atlas-квитанции отдельно, расшифрование age до вызова правильного импортёра; запрещать неправильное применение до какой-либо записи. Native signed profile и два холодных Atlas чтения пока HOLD.
