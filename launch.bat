@echo off
chcp 65001
echo 如果出现文件未更新、文件缺失（没有404但是也没有反应），请临时去除--incremental
start cmd /c "bundle exec jekyll serve --disable-disk-cache --incremental --port 8860"

setlocal enabledelayedexpansion

echo 正在等待 localhost:8860 服务启动...
:check
timeout /t 1 /nobreak >nul 2>&1

powershell -Command "(Invoke-WebRequest -Uri 'http://localhost:8860/KirinDance/' -UseBasicParsing -DisableKeepAlive -Method Head -ErrorAction SilentlyContinue).StatusCode" | find "200" >nul

if %errorlevel% equ 0 (
    echo 服务已启动！正在打开浏览器...
    start "" "http://localhost:8860/KirinDance/"
    exit /b
) else (
    rem 显示进度动画
    set /a "count = (count + 1) %% 4"
    set "dots=...."
    call echo 等待中...%%dots:~0,!count!%%
    goto check
)