@echo off
chcp 65001
echo if the files stay outdated, or unresponsive without 404, temporarily remove the --incremental
start cmd /c "bundle exec jekyll serve --disable-disk-cache --port 8860"

setlocal enabledelayedexpansion

echo waiting for localhost:8860 service...
:check
timeout /t 1 /nobreak >nul 2>&1

powershell -Command "(Invoke-WebRequest -Uri 'http://localhost:8860/KirinDance/' -UseBasicParsing -DisableKeepAlive -Method Head -ErrorAction SilentlyContinue).StatusCode" | find "200" >nul

if %errorlevel% equ 0 (
    echo service is ready, opening browser...
    start "" "http://localhost:8860/KirinDance/"
    exit /b
) else (
    rem showProgress
    set /a "count = (count + 1) %% 4"
    set "dots=...."
    call echo waiting...%%dots:~0,!count!%%
    goto check
)