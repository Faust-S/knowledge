# Bypass Manager 0.3 Alpha: инженерное моделирование, 17.11.2026

**Статус:** 53/53 PASS в локальных тестах, 0 FAIL. Отдельные полевые ограничения указаны для 51 сценария.

> PASS подтверждает работу тестируемых функций на описанном входе, не подтверждает реальный VPN, подписку, системный DPI, обход блокировок или видео на ПК пользователя.

## Что изменилось в реализованном продукте

1. VLESS/Amnezia Premium без TUN теперь имеет отдельную диагностику Local Proxy. Windows ищет локальные слушающие сокеты процесса, установленного в каталоге AmneziaVPN; Bypass Manager проверяет HTTP CONNECT или SOCKS5, делает собственный HTTPS IP-консенсус и хранит порт/IP только в памяти. Успех означает HTTPS через настроенный прокси **самого Bypass Manager**, а не VPN-handshake или выход всех приложений.
2. Для сторонних приложений Windows инвентаризует подключения к такому локальному прокси (число сокетов, по категориям). Имя процесса видно только на собственном экране; в экспорт попадают только счётчики и коды. Это наблюдение соединения до прокси, **не** внешний IP приложения.
3. После испытания профиля DPI он выключается и выполняется третья серия A/B/A: A без DPI, B с DPI, A' снова без DPI. Сопоставляются HTTPS-источник, размер файла, не менее двух завершённых загрузок B и A', внешний IP, VPN-маршрут и двусторонний поток адаптера. Постоянное улучшение после выключения DPI помечается как `ABA_NOT_REPRODUCED`, возврат прежнего результата как `ABA_POSSIBLE_*_REVERSAL`. Причинность не доказана.
4. Быстрый замер больше не записывает подтверждённый прямой IPv4 только по отсутствию TUN, если Amnezia работает. В этом случае статус `LOCAL_PROXY_POSSIBLE_NOT_TESTED`.
5. Оригинальные Amnezia Premium, T2/T3/IWXA и формат .iwxa не меняются; никаких VPN-ключей, подписок, конфигураций, аппаратных фильтров или сетевых настроек модель не касается.

## Происхождение результатов и границы

- Исполняемый тест: `simulation_field_test.go`, использует штатные `assessDPIEffect`, `classifyBaseline`, `guidePlanFor`, `parseProxyPorts`, `probeProxyPortsWithClient`, `collectPostOffTransfers`, `summarizeAppSockets`, `checkGuideVideo`, `downloadFrom`, `guideRangeDownload` и другие функции продукта.
- Реальные локальные TCP/HTTP/HTTPS соединения: `httptest.NewServer`, `httptest.NewTLSServer`, локальный HTTP CONNECT и SOCKS5. TLS в тесте проходит с **тестовым** сертификатом из изолированного `httptest`, в продукте проверка TLS не отключается.
- Windows PowerShell сценарии: `Tests/Test-LocalProxy-Mock.ps1` и `Tests/Test-AppProxy-Sockets-Mock.ps1` с инертными Get-CimInstance / Get-NetTCPConnection / Get-NetAdapter фикстурами. Они не обращаются к реальной Amnezia на runner.
- Официальная документация подтверждает, что локальный прокси Amnezia Premium работает на `127.0.0.1`, его порт может меняться, а одновременная работа системного VPN и Local Proxy не поддерживается: https://docs.amnezia.org/ru/documentation/instructions/local-proxy/
- Публичная и полная Windows-приёмка является отдельной проверкой после публикации коммита. Список сценариев ниже содержит **локально подтверждённый** исход; CI отчёты прикладываются отдельно.

## Матрица всех 53 случаев

| ID | Область | Проверяемый результат | Локальный исход |
|---|---|---|---|
| S01 | Последовательность AWG/VLESS | `VLESS_FIRST` | PASS |
| S02 | Последовательность AWG/VLESS | `AWG_CONTROL` | PASS |
| S03 | VPN, маршрут и исходный IP | `VIDEO_CANDIDATE_VPN_PATH_OBSERVED` | PASS |
| S04 | VPN, маршрут и исходный IP | `VIDEO_USABLE_EGRESS_UNCHANGED` | PASS |
| S05 | VPN, маршрут и исходный IP | `WEB_USABLE_VPN_UNVERIFIED` | PASS |
| S06 | VPN, маршрут и исходный IP | `VIDEO_CANDIDATE_EGRESS_UNVERIFIED` | PASS |
| S07 | VPN, маршрут и исходный IP | `CONNECT_AMNEZIA` | PASS |
| S08 | Резервный CDN | `HD_1080P_CANDIDATE` | PASS |
| S09 | Резервный CDN | `INCOMPLETE` | PASS |
| S10 | Реальный локальный HTTP/TLS | `HTTP_403` | PASS |
| S11 | Реальный локальный HTTP/TLS | `PARTIAL_TRANSFER` | PASS |
| S12 | Реальный локальный HTTP/TLS | `TLS_CERTIFICATE_ERROR` | PASS |
| S13 | Реальный локальный HTTP/TLS | `TIMEOUT` | PASS |
| S14 | Реальный локальный HTTP/TLS | `RANGE_NOT_SUPPORTED` | PASS |
| S15 | Реальный локальный HTTP/TLS | `RANGE_OK` | PASS |
| S16 | Скорость и оценка видео | `SLOW_FOR_VIDEO` | PASS |
| S17 | Скорость и оценка видео | `SPEED_NOT_VERIFIED` | PASS |
| S18 | Применение DPI | `NOT_TESTED` | PASS |
| S19 | Применение DPI | `POSSIBLE_AVAILABILITY_IMPROVEMENT` | PASS |
| S20 | Применение DPI | `NOT_COMPARABLE` | PASS |
| S21 | Применение DPI | `POSSIBLE_IMPROVEMENT` | PASS |
| S22 | Применение DPI | `NOT_COMPARABLE` | PASS |
| S23 | Применение DPI | `NOT_COMPARABLE` | PASS |
| S24 | Внешний VPN-сервер | `CHANGED` | PASS |
| S25 | Внешний VPN-сервер | `AMBIGUOUS` | PASS |
| S26 | Маршрут к серверу | `BLOCKED` | PASS |
| S27 | Остановка/отмена | `CANCELLED` | PASS |
| S28 | Сохранение отчёта | `GUIDE_INCOMPLETE` | PASS |
| S29 | Устаревание измерений | `STALE` | PASS |
| S30 | Отдельные приложения | `NOT_PER_APP_EGRESS_PROOF` | PASS |
| S31 | Мониторинг видео | `PLAYBACK_NOT_CONFIRMED_SMOOTH` | PASS |
| S32 | Мониторинг видео | `VPN_PATH_NOT_CONFIRMED` | PASS |
| S33 | Внешний IP | `IP_UNCHANGED_POSSIBLE_DIRECT_EGRESS` | PASS |
| S34 | Внешний IP | `STALE_DIRECT_BASELINE` | PASS |
| S35 | Маршрут к серверу | `DIAGNOSTICS_UNAVAILABLE` | PASS |
| S36 | Контроль без VPN | `BASELINE_UNAVAILABLE` | PASS |
| S37 | Локальный прокси Amnezia | `CANDIDATES` | PASS |
| S38 | Локальный прокси Amnezia | `REJECTED` | PASS |
| S39 | Локальный прокси Amnezia | `UNAVAILABLE` | PASS |
| S40 | Локальный прокси Amnezia | `HTTP_CONNECT_PASS` | PASS |
| S41 | Локальный прокси Amnezia | `SOCKS5_PASS` | PASS |
| S42 | Отдельные приложения | `SOCKET_NOT_EGRESS_PROOF` | PASS |
| S43 | Отдельные приложения | `REJECTED` | PASS |
| S44 | Трёхфазное A/B/A | `ABA_POSSIBLE_SPEED_REVERSAL` | PASS |
| S45 | Трёхфазное A/B/A | `ABA_NOT_REPRODUCED` | PASS |
| S46 | Трёхфазное A/B/A | `ABA_INCONCLUSIVE` | PASS |
| S47 | Трёхфазное A/B/A | `ABA_POSSIBLE_AVAILABILITY_REVERSAL` | PASS |
| S48 | Трёхфазное A/B/A | `ABA_NOT_REPRODUCED` | PASS |
| S49 | Трёхфазное A/B/A | `ABA_INCONCLUSIVE` | PASS |
| S50 | Трёхфазное A/B/A | `TWO_MATCHED_REQUESTS` | PASS |
| S51 | Трёхфазное A/B/A | `CANCELLED` | PASS |
| S52 | Контроль без VPN | `NO_DIRECT_BASELINE` | PASS |
| S53 | Контроль без VPN | `LOCAL_PROXY_POSSIBLE_NOT_TESTED` | PASS |

## Распределение

- Трёхфазное A/B/A: 8 сценариев
- Отдельные приложения: 3 сценариев
- Контроль без VPN: 3 сценариев
- Остановка/отмена: 1 сценариев
- Применение DPI: 6 сценариев
- Внешний IP: 2 сценариев
- Внешний VPN-сервер: 2 сценариев
- Резервный CDN: 2 сценариев
- Устаревание измерений: 1 сценариев
- Реальный локальный HTTP/TLS: 6 сценариев
- Последовательность AWG/VLESS: 2 сценариев
- Локальный прокси Amnezia: 5 сценариев
- Сохранение отчёта: 1 сценариев
- Маршрут к серверу: 2 сценариев
- Скорость и оценка видео: 2 сценариев
- Мониторинг видео: 2 сценариев
- VPN, маршрут и исходный IP: 5 сценариев

## Полевые критерии до реального выпуска

1. На пользовательском Windows ПК подтвердить наличие Amnezia Premium и определить, какой режим активен: полноценный VPN (TUN) или Local Proxy. Клиент может изменять локальный порт автоматически; в Bypass Manager вручную порт не вводится.
2. Для Local Proxy проверить два независимых HTTPS IP-источника через локальный процесс Amnezia и затем проверить конкретные приложения. Сокет к прокси **не равен** доказательству egress; тест egress должен выполняться самим целевым приложением.
3. Для каждого включённого DPI профиля (в пределах текущего внешнего подтверждённого endpoint) выполнить A/B/A, проверить настоящие выключение собственного `winws2`, неизменность VPN-маршрута и IP, одинаковые CDN и размеры. После прерывания и сбоя фильтра не присваивать результату статус улучшения.
4. Проверить системные программы, браузер, WebRTC/QUIC, split tunneling и 15 минут настоящего воспроизведения. Короткие HTTPS-загрузки не заменяют это испытание.
5. Обязательно сохранить обезличенный `latest-support.json` без VPN-конфигураций и адресов. **`REAL_NETWORK_NOT_ACCEPTED`** остаётся до выполнения полевой приёмки.

## Воспроизведение

```bash
cd tools/bypass-manager
BYPASS_SIM_REPORT=field-model.json go test -count=1 -run ^TestBypassFieldSimulation$ -v .
go test -race -count=1 ./...
go vet ./...
```

Машинный эталон в репозитории: `model/field-model-local-2026-11-17.json`. В Actions каждый OS-run публикует отдельный JSON artifact.

## Квалификация на GitHub Actions: межтестовая изоляция PowerShell

Первый запуск 53-сценарной ревизии выявил **не производственный сбой VPN**, а дефект инструмента тестирования: `Test-AppProxy-Sockets-Mock.ps1` создаёт глобальную функцию `Get-Process`, симулирующую процессы. Несколько mock-скриптов исполнялись в *одной* PowerShell 5.1 сессии, вследствие чего последующий `Test-OwnRecovery.ps1` наблюдал фиктивный процесс с PID 2147483647 и правильно отказался удалять запись своего winws2. Отказ чужому PID в реальном `Start-Profile.ps1` — корректный.

Квалификационные Windows Actions теперь запускают **каждый PowerShell тест в отдельном процессе** `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File`, проверяют `LASTEXITCODE` и убеждаются, что в родительском процессе `Get-Process` по-прежнему реальный Cmdlet. Исходный механизм принадлежности процессу и отзыв разрешений на DPI **не ослаблялись**. Это устраняет перекрёстное влияние фикстур сетевых сокетов, WFP и процессов. Следующий CI обязан подтвердить Windows native GUI, тесты реального CLI и оба Windows Server runner.
