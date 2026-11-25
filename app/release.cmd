@echo off
title K Downloader release
setlocal
set "SRC=%~dp0"
set "ROOT=%SRC%.."
rem Publishes the reviewed installer from dist\review: older installers leave dist, the new one moves in,
rem INSTALL.txt is refreshed and latest.json is written, so installed copies on every PC see the update.
if not exist "%ROOT%\dist\review\K Downloader Setup*.exe" (
  echo Nothing in dist\review to release. Run app\build.cmd first.
  exit /b 1
)
if exist "%ROOT%\dist\K Downloader Setup*.exe" del /q "%ROOT%\dist\K Downloader Setup*.exe"
move /Y "%ROOT%\dist\review\K Downloader Setup*.exe" "%ROOT%\dist\" >nul
copy /Y "%SRC%INSTALL.txt" "%ROOT%\dist\INSTALL.txt" >nul
"%ROOT%\bin\node.exe" "%SRC%latest.js" "%ROOT%\dist" || (echo Release failed. & exit /b 1)
echo.
echo Released: "%ROOT%\dist"
dir /b "%ROOT%\dist"
endlocal
exit /b 0
