# Сборка Bypass Manager 0.3 Alpha

Исходники: `Faust-S/knowledge/tools/bypass-manager` в собственной рабочей ветке.

```bash
cd tools/bypass-manager
go test -count=1 ./...
go vet ./...
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags='-H windowsgui -s -w' -o Bypass-Manager.exe .
sha256sum Bypass-Manager.exe
```

Кросс-компиляция под Linux выдаёт только PE-файл. Она не заменяет запуск на Windows.

Проверка в GitHub Actions (публичный репозиторий): `.github/workflows/bypass-manager-windows.yml`. Windows runner выполняет Go tests, PowerShell parse и upstream dry-run без перехвата пакетов. Для полноценного испытания понадобятся настоящие Windows, отдельно установленная Amnezia и разрешённое внешнее подключение. Публичные Actions не получают приватные VPN-ключи.

Программа не содержит GUI веб-браузера и не требует WebView2. Окно реализовано штатным Win32 API через Go, без GUI-фреймворка. Один EXE включает только исходники менеджера, PowerShell-обвязку и метаданные профилей. Оригинальный winws2 устанавливается при согласии пользователя либо заранее.

### Квалификация путей с пробелами и офлайн-каталога

Один exe + VPN-клиент не означает отказа от оригинального движка: 
`winws2`, WinDivert и Lua должны находиться в локальной папке `engine/` или скачиваться по подтверждению пользователя.

`Tests/Verify-Windows.ps1 -WithUpstream -BundleRoot <путь>` проверяет не только WinDivert-фильтры и Lua, но и процессный запуск оригинального `winws2` из пути с пробелами через PowerShell 5.1, без перехвата трафика. Отдельный тест проверяет, что предпочтение отдаётся полному верифицированному `engine/` рядом с EXE.
