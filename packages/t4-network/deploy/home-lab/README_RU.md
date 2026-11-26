# IWXA T4 Home Lab 0.1 (TEST)

Целевая машина: Intel N150 (amd64), 16 ГБ RAM, SSD 512 ГБ. Выбрана Ubuntu Server 26.04.1 LTS x86-64 без обязательного графического рабочего стола. Это отдельный стенд, не production. Оригинальная композиция T3/T4 0.1.0-rc.1 сохраняется; этот каталог не содержит новый Kernel, IAM, Store, wire format или доменные API.

Проект: [архитектура](../../docs/T4_IDENTITY_AND_DOMAIN_INFRASTRUCTURE_RU.md), [пилот](../../docs/T4_SELF_HOSTED_IDENTITY_PILOT_RU.md), [приёмка](../../docs/T4_IDENTITY_ACCEPTANCE_AND_ROADMAP_RU.md).

## Что реализовано

- `stand.py` создаёт новую локальную инфраструктуру в `/var/lib/iwxa-t4-test`, отказывается перезаписывать её, генерирует независимые секреты, локальный TLS CA и сертификат, три Apache профиля, два конфиденциальных клиента OIDC и три WebDAV credentials.
- `p0`: самостоятельный HTTPS/WebDAV для исходного T4; две изолированные области. `workspace-a` имеет двух участников одной сети (source/recipient), `workspace-b` отдельного участника. Оригинальный Access и ключи проверяют фактические полномочия независимо от HTTP Basic.
- `idp`: тот же WebDAV и Apache reverse proxy к отдельному Keycloak + PostgreSQL. Публичные в пределах LAN маршруты только `/realms/iwxa-test/` и `/resources/`; административный listener на 127.0.0.1:443.
- `identity`: дополнительно две диагностические HTTPS страницы MarketOps/ArtBazi с `mod_auth_openidc`, раздельными client ID, secrets, cookie и серверными сеансами. Это только проверка SSO, **не подключённые домены**, не API и не права на данные. Сеансы диагностических клиентов максимум 5 минут; общий logout может не мгновенно закрыть другой клиент.
- `compose.yaml`: закрепляемые по digest образы Keycloak 26.8.2 и PostgreSQL 17.12, отдельная PostgreSQL роль `iwxa_identity` без superuser, отдельная БД `identity_test`, PostgreSQL без published ports, Keycloak HTTP только 127.0.0.1:18080. Внешний TLS обеспечивает Apache. Образы не скачаны в доступной среде; `lock-images` проверяет их фактические digest на целевой машине. Установить обновления выбранных версий при следующей зафиксированной квалификации, не использовать latest.

## 1. Подготовка мини-ПК

Владелец устанавливает [Ubuntu Server LTS](https://ubuntu.com/download/server) (amd64) с USB. Чистая установка может стереть диск: предварительно сохранить данные, выбрать диск и подтвердить операции самостоятельно. При установке включить OpenSSH Server. Ethernet предпочтительнее Wi-Fi; зафиксировать выдаваемый DHCP адрес на домашнем роутере. Не пробрасывать порты на WAN. Использовать обычного администратора с sudo, SSH-ключом; не включать удалённый root login.

После входа в ОС:

```sh
sudo apt update
sudo apt upgrade
sudo apt install git python3 apache2 apache2-utils openssl curl iproute2
ip -br -4 address
free -h
df -h /
```

Для N150 планируем до 3 ГБ для Keycloak и 2 ГБ для PostgreSQL (лимиты контейнеров), остальное для ОС, Apache, будущих оригинальных Host. Никаких серверных LLM в первом стенде. Это бюджет, не измеренная нагрузка. Оставлять запас свободного SSD и использовать отдельный носитель для резервных копий.

Уточнить фактический адрес и подсеть. Пример `192.168.1.50` и `192.168.1.0/24` **не фактические адреса владельца**. При настройке firewall разрешить SSH от административной машины и HTTPS от разрешённой LAN, проверить доступ прежде чем включать firewall. Docker опубликованные порты не следует считать защищёнными только UFW; использовать Docker Engine >= 28 и проверять привязки и отсутствие доступа с другого устройства. Не использовать общий публичный DNS и открытый VPN без отдельного допуска.

## 2. Получение комплекта и P0

Из рабочей копии `Faust-S/knowledge`, ветка `work/2026-11-26-t4-identity-infrastructure`, перейти в `packages/t4-network/deploy/home-lab`. Использовать точный проверенный commit комплекта. Не выполнять скрипты из неизвестных веток с sudo.

```sh
# Вставить реальные значения LAN вместо примера.
sudo python3 stand.py init --address 192.168.1.50 --cidr 192.168.1.0/24
sudo apache2 -t -f /var/lib/iwxa-t4-test/config/active.conf
# Только на выделенной чистой машине: пакетный Apache не нужен параллельно.
sudo systemctl disable --now apache2
sudo install -m 0644 iwxa-t4-edge.service /etc/systemd/system/iwxa-t4-edge.service
sudo systemctl daemon-reload
sudo systemctl enable --now iwxa-t4-edge
sudo systemctl status iwxa-t4-edge --no-pager
```

Если init остановился на ошибке, не удалять созданный каталог вслепую: проверить причину. Наличие каталога блокирует новую инициализацию, чтобы не перезаписать ключи или данные. Если на машине уже есть Apache, не отключать его, пока не согласовано раздельное размещение.

Для первого устройства и второго устройства настроить DNS/hosts на фактический адрес мини-ПК: `dav.iwxa.test`, `id.iwxa.test`, `marketops.iwxa.test`, `artbazi.iwxa.test`. Это зарезервированные имена для теста. На самом сервере для backchannel добавить в `/etc/hosts` строку `127.0.0.1 id.iwxa.test` (не добавлять второй противоречивый адрес для того же имени). Обычные клиентские устройства должны разрешать id в LAN IP; только административный туннель использует loopback.

Скопировать **только публичный** `/var/lib/iwxa-t4-test/config/ca.crt`, сравнить его SHA-256 fingerprint по доверенному каналу (`sudo openssl x509 -in /var/lib/iwxa-t4-test/config/ca.crt -noout -fingerprint -sha256`), установить доверие CA на участвующих тестовых устройствах/браузерах. Node native Host может использовать `NODE_EXTRA_CA_CERTS` с этим сертификатом при запуске. Не использовать `curl -k`, `NODE_TLS_REJECT_UNAUTHORIZED=0` или постоянное отключение TLS-проверки. CA key остаётся под контролем владельца, хранится отдельно от leaf; сделать зашифрованную автономную копию, затем при необходимости убрать CA key с online-узла. При переустановке стенда удалить старое доверие со всех тестовых устройств. Leaf действует 365 дней, CA 3650; заранее планировать штатное обновление сертификата без смены issuer URL.

Настроить доверенные Host через оригинальный `createT4OriginalNativeHostNetworkProfile`, SELF_HOSTED topology, original Access/Vault/peer channel и адрес `https://dav.iwxa.test/workspace-a/` (завершающий slash). Source и recipient используют разные HTTP credentials, а не общий пароль. Данные для них находятся в root-only `private/dav-credentials.json`. Передавать отдельно каждому участнику только его credential; не вставлять в URL, profile, логи, GitHub или чат. Независимый `t4-other` получает только `workspace-b`.

Первая физическая проверка: `curl --cacert <ca.crt> --user t4-source -X PROPFIND -H 'Depth: 1' https://dav.iwxa.test/workspace-a/` (curl запросит пароль). Ожидается 207. Попытка того же пользователя на workspace-b должна быть отвергнута. Проверить с обоих устройств. Затем выполнить оригинальную T4 qualification двух независимых Host. Сервер не проверяет криптографическое содержание кадров; T4 проверяет подпись, digest, ключи, original Access и действующий маршрут. Для P0 реализованы только плоские ключи SHA256 с расширением `.t4n`, `.t4i`, `.t4d`, `.iwxa`, GET/HEAD, PUT с `If-None-Match: *`, PROPFIND Depth 1 коллекции. Другие методы, включая DELETE, MOVE и COPY, не допускаются. Удаление предметного Object передаётся существующим T4-протоколом, не HTTP DELETE. Очистка carrier после приёмки требует отдельной политики retention. Квота, конкурентное атомарное создание на реальном SSD и восстановление после отказа ещё подлежат испытанию.

## 3. IWXA ID (после либо параллельно P0, без изменения оригинального Host)

Установить [Docker Engine и Compose plugin](https://docs.docker.com/engine/install/ubuntu/) из официального репозитория для Ubuntu 26.04, не через неизвестный install script. Требование >=28 из-за поведения localhost published ports в старых версиях. Затем:

```sh
sudo docker version
sudo docker compose version
sudo python3 stand.py lock-images
sudo python3 stand.py identity-start --bootstrap
sudo python3 stand.py select idp
sudo systemctl restart iwxa-t4-edge
```

`lock-images` единожды получает только указанные версионные образы, записывает digest в локальный root-only env и отказывается изменять его повторно. При недоступном registry или отсутствии тега остановиться, сверить официальный релиз; не заменять на latest. Не выводить `docker compose config` или `docker inspect` с секретами в общий журнал. Для диагностики состояния `sudo docker ps --filter label=com.docker.compose.project=iwxa-t4-test`.

Проверить discovery с обычной рабочей машины: `https://id.iwxa.test/realms/iwxa-test/.well-known/openid-configuration`. `issuer` обязан точно совпадать с этим базовым адресом без `/.well-known/openid-configuration`; ожидаемое значение `https://id.iwxa.test/realms/iwxa-test`. `/admin/`, `/realms/master/`, `/health`, `/metrics` с LAN не должны открываться. Не открывать TCP 18080 или 5432 из LAN. Сервисы identity могут стартовать несколько минут; смотреть локальный журнал с ограничением доступа, не публиковать raw logs.

### Первичная настройка администратора

С административного ПК (локальный порт 443 должен быть свободен) создать SSH port forward:

```sh
ssh -N -L 127.0.0.1:443:127.0.0.1:443 <admin-user>@<LAN-IP-mini-PC>
```

На время администрирования в **административном ПК** установить `127.0.0.1 id.iwxa.test` в hosts, использовать отдельный профиль браузера и ранее установленный тестовый CA. Открыть `https://id.iwxa.test/admin/` через туннель. Один и тот же hostname/issuer сохранён для master realm и обычных клиентов; доступность административных маршрутов разделена по listener. Не менять issuer на IP/другой порт. Если порт 443 занят, сначала освободить его либо настроить отдельный управляемый админский VPN/SSH SOCKS с удалённым DNS; не ослаблять доступ через LAN. Обычный клиентский браузер не должен оставаться с локальной hosts-записью.

Войти `temp-admin`; пароль сгенерирован в `/var/lib/iwxa-t4-test/private/compose.env` (показать его только локально, например `sudo grep '^BOOTSTRAP_PASSWORD=' /var/lib/iwxa-t4-test/private/compose.env`). Создать постоянного администратора master realm, задать длинный пароль, MFA/OTP и проверить новый вход в отдельной сессии. Удалить temporary admin. Создать двух тестовых пользователей в realm `iwxa-test` с самостоятельными паролями, не назначая им realm-admin. Саморегистрация, SMTP и reset-password пока отключены, включать их позже отдельно при готовой политике подтверждения контактов. Не использовать реальную личную почту. Проверить, что оба диагностических клиента существуют, confidential, standard flow, S256, точные callback URLs. Клиентские secrets генерируются локально и импортируются через поддерживаемые placeholders; при ошибке импорта не ослаблять client authentication.

После подтверждения удаления temporary admin:

```sh
sudo python3 stand.py identity-finish --admin-removed
```

Команда пересоздаёт Keycloak без bootstrap env и удаляет локальный bootstrap password. Проверьте постоянный admin login ещё раз. Закрыть SSH tunnel и вернуть на административном ПК mapping id → LAN IP, либо оставить отдельный управляемый admin-профиль. Тестовый IdP работает без временного администратора.

## 4. Два пробных сайта SSO

```sh
sudo apt install libapache2-mod-auth-openidc
sudo python3 stand.py select identity
sudo systemctl restart iwxa-t4-edge
```

Apache проверит синтаксис до смены active.conf. Если модуль отсутствует или не поддерживает директиву, останется старый профиль; вернуть `sudo python3 stand.py select idp` и перезапустить. Пакет должен быть актуальным в Ubuntu. Диагностические страницы защищены `mod_auth_openidc` с issuer и CA, Authorization Code + PKCE S256, отдельным конфиденциальным client, cookie и crypto passphrase. Не реализуем собственный OAuth/OIDC алгоритм.

В обычном браузере открыть `https://marketops.iwxa.test/`, войти тестовым пользователем, перейти по ссылке на `https://artbazi.iwxa.test/`. Проверить, что второй клиент после редиректа не потребовал пароль, а cookies раздельные. Закрыть первый сеанс, проверить второй и общий IdP logout отдельно. Срок диагностических сеансов ограничен 300 сек; не считать остаточный сеанс мгновенно отозванным. Для проверки второго пользователя использовать отдельный browser profile. Эти страницы не предоставляют предметные данные и не являются доказательством original Access. API audience/authorization, binding actor, роли Workspace, native Agent, Mobile и доменные БД остаются следующим этапом I3/I4. Не добавлять прямой SQL доступ к Kernel.

## 5. Остановка и сохранение

`sudo python3 stand.py select p0` + `sudo systemctl restart iwxa-t4-edge` оставляет WebDAV работающим без IdP. `sudo python3 stand.py identity-stop` останавливает identity контейнеры, не удаляет volume. После bootstrap возобновление: `sudo python3 stand.py identity-start`, выбрать необходимый Apache профиль. `sudo systemctl stop iwxa-t4-edge` отключает edge целиком. Не выполнять `docker compose down -v`, не очищать state/volume как часть обновления.

Перед физическим испытанием отказа создать отдельную зашифрованную резервную копию (PostgreSQL pg_dump и globals, realm/config, локальные TLS/credential материалы, WebDAV, оригинальные Kernel/Vault отдельными штатными средствами). Остановить запись и identity service на время согласованного снимка, сохранить на внешнем носителе. Проверка восстановления в отдельной среде обязательна; этот комплект не содержит автоматически квалифицированный backup/restore. Не размещать реальные медицинские, финансовые или личные данные на стенде.

## 6. Проверки и статус

`sudo python3 test_stand.py` выполняет локальный настоящий Apache в временной директории на loopback (нужны apache2/htpasswd/openssl/curl, тест не трогает реальный state). Временно занимает 18080 только для проверки proxy через контролируемый HTTP fixture: запускать на отдельной тестовой машине или при остановленном Keycloak. Это не проверка Keycloak и не проверка двух оригинальных T4 Host. `python3 -m py_compile stand.py test_stand.py`, `sh -n init-db.sh` проверяют исходники. `docker compose config -q` на целевой машине можно применять без публикации секретов после lock. `identity.conf` ещё должен пройти реальный `apache2 -t` с установленным mod_auth_openidc.

Источник выбранных версий/настроек: [Ubuntu](https://ubuntu.com/download/server), [Docker](https://docs.docker.com/engine/install/ubuntu/), [Keycloak 26.8.2](https://www.keycloak.org/2026/11/keycloak-2682-released), [supported DB](https://www.keycloak.org/server/supported-configurations), [proxy](https://www.keycloak.org/server/reverseproxy), [realm import](https://www.keycloak.org/server/importExport), [PostgreSQL](https://www.postgresql.org/support/versioning/), [OpenIDC module](https://github.com/OpenIDC/mod_auth_openidc). Все секреты создаются только при локальной инициализации. Публичный GitHub содержит исходники, не личную топологию или секреты.
