@echo off
setlocal
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0serve-acceptance.mjs"
exit /b %errorlevel%
