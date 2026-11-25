@echo off
title Kareem Downloader Uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0helper\uninstall.ps1"
echo.
pause
