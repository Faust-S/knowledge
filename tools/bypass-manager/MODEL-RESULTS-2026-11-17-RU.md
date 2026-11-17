# Bypass Manager 0.3 Alpha: результаты инженерного моделирования

**Дата:** 17.11.2026. **Источник:** `simulation_field_test.go`, реальные loopback HTTP/TLS-передачи и детерминированные состояния.

**Результат локального прогона:** 36/36 PASS; 0 FAIL. **Отдельные ограничения полевой применимости:** 34 сценариев.

**Важно:** PASS относится только к проверенным инвариантам симуляции. Это не проверка Amnezia Premium, провайдера, фактического bypass DPI, реального браузера или 15-минутного видео. Внешние VPN-ключи и трафик пользователя не используются.

## Обнаруженные и исправленные дефекты

1. **Ложный эффект DPI при отказе одного CDN.** Контрольный HTTPS мог успешно загрузить все четыре файла с резервного CDN, однако восстановление первого CDN позже могло классифицироваться как `POSSIBLE_AVAILABILITY_IMPROVEMENT`. Добавлен запрет: контроль `Video.Grade` должен быть `INCOMPLETE` или `NOT_VERIFIED`, иначе никакое улучшение доступности не заявляется. Сценарий **S20**.
2. **Ложная прямая точка отсчёта для VLESS без TUN.** Запущенная Amnezia с нулём VPN-адаптеров могла ошибочно считаться отключённой. Теперь `guideCanMeasureDirectBaseline` дополнительно требует `!AppRunning`. Этот защитный признак консервативен: если Amnezia запущена, но фактически отключена, базовая точка остаётся неподтверждённой до независимой проверки. Сценарий **S36**.

## Реальная механика стенда

- `httptest.NewServer` выполняет TCP/HTTP-запросы через настоящий локальный сокет и штатную `downloadFrom`, включая HTTP 403, неполное тело, ожидание, 206 Range и отклонение Range.
- `httptest.NewTLSServer` воспроизводит отказ проверки сертификата на реальном локальном TLS-handshake.
- `checkGuideVideo`, `assessVideoDownloads`, `testSpeed`, `guideOutcome`, `classifyBaseline`, `assessDPIEffect`, `guidePlanFor`, `parseOuterEndpointEvidence`, `sameOuterEndpoint`, `routePreflightBlocked`, `waitGuideResponse`, `finalizeGuideReport`, `summarizeAppSockets` и `assessStability` вызываются напрямую, без параллельной реализации оценщика.
- Транспорт VPN, Windows-адаптеры, поведение внешних CDN, отчёты пользователя и временная шкала в остальных сценариях смоделированы детерминированно. Ни один тест не включает WinDivert и не меняет маршруты, DNS, MTU или профиль Amnezia.

## Матрица 36 сценариев

| ID | Категория | Проверяемый вывод | Итог |
|---|---|---|---|
| S01 | protocol | `VLESS_FIRST` | PASS |
| S02 | protocol | `AWG_CONTROL` | PASS |
| S03 | vpn | `VIDEO_CANDIDATE_VPN_PATH_OBSERVED` | PASS |
| S04 | vpn | `VIDEO_USABLE_EGRESS_UNCHANGED` | PASS |
| S05 | vpn | `WEB_USABLE_VPN_UNVERIFIED` | PASS |
| S06 | vpn | `VIDEO_CANDIDATE_EGRESS_UNVERIFIED` | PASS |
| S07 | vpn | `CONNECT_AMNEZIA` | PASS |
| S08 | fallback | `HD_1080P_CANDIDATE` | PASS |
| S09 | fallback | `INCOMPLETE` | PASS |
| S10 | http | `HTTP_403` | PASS |
| S11 | http | `PARTIAL_TRANSFER` | PASS |
| S12 | http | `TLS_CERTIFICATE_ERROR` | PASS |
| S13 | http | `TIMEOUT` | PASS |
| S14 | http | `RANGE_NOT_SUPPORTED` | PASS |
| S15 | http | `RANGE_OK` | PASS |
| S16 | speed | `SLOW_FOR_VIDEO` | PASS |
| S17 | speed | `SPEED_NOT_VERIFIED` | PASS |
| S18 | dpi | `NOT_TESTED` | PASS |
| S19 | dpi | `POSSIBLE_AVAILABILITY_IMPROVEMENT` | PASS |
| S20 | dpi | `NOT_COMPARABLE` | PASS |
| S21 | dpi | `POSSIBLE_IMPROVEMENT` | PASS |
| S22 | dpi | `NOT_COMPARABLE` | PASS |
| S23 | dpi | `NOT_COMPARABLE` | PASS |
| S24 | endpoint | `CHANGED` | PASS |
| S25 | endpoint | `AMBIGUOUS` | PASS |
| S26 | route | `BLOCKED` | PASS |
| S27 | cancel | `CANCELLED` | PASS |
| S28 | report | `GUIDE_INCOMPLETE` | PASS |
| S29 | freshness | `STALE` | PASS |
| S30 | apps | `NOT_PER_APP_EGRESS_PROOF` | PASS |
| S31 | streaming | `PLAYBACK_NOT_CONFIRMED_SMOOTH` | PASS |
| S32 | streaming | `VPN_PATH_NOT_CONFIRMED` | PASS |
| S33 | egress | `IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS` | PASS |
| S34 | egress | `STALE_DIRECT_BASELINE` | PASS |
| S35 | route | `DIAGNOSTICS_UNAVAILABLE` | PASS |
| S36 | baseline | `BASELINE_UNAVAILABLE` | PASS |

## Не закрытые полевые пробелы

- **VLESS в режиме локального прокси без TUN:** штатный `connectionGuideAction` по-прежнему ориентирован на VPN-адаптер и возвращает `CONNECT_AMNEZIA` при его отсутствии (S07). Это не доказательство отсутствия соединения. Требуется отдельная идентификация прокси-выхода XRay и сверка трафика конкретного приложения.
- **Криптографический handshake AWG/VLESS** не доказан сетевым маршрутом, счётчиками адаптера или HTTP 200. Нужен официальный клиентский статус/событие.
- **Автоматическое определение AWG endpoint** зависит от доступной нативной CLI либо WFP-событий. В отсутствие надёжных наблюдений не подставлять IP.
- **Причинность DPI:** даже две успешные загрузки после запуска фильтра не исключают независимое восстановление CDN, провайдера или смену маршрута. Сообщать лишь о возможной корреляции.
- **Браузер и системные приложения:** per-app публичный IPv4, WebRTC/QUIC/локальные прокси и split tunneling требуют отдельного полевого теста; счётчики сокетов не равны egress proof.
- **Видео 15 минут:** штатные короткие HTTPS-пробы не проверяют DRM/стриминг. Факт реального воспроизведения требует отдельной пользовательской или браузерной квитанции.

## Запуск и артефакты

```bash
cd tools/bypass-manager
BYPASS_SIM_REPORT=./field-model.json go test -count=1 -run TestBypassFieldSimulation -v .
go test -race -count=1 ./...
go vet ./...
```

В GitHub Actions тест запускается на Linux, Windows Server 2022 и Windows Server 2025 и прикладывает машинный `field-model.json` к соответствующему CI. Исторический эталон результата: `model/field-model-local-2026-11-17.json`. Все отчёты с кодами и агрегатами, без IP и персональных конфигураций.