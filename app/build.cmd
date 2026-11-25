@echo off
title K Downloader build
setlocal
set "SRC=%~dp0"
set "ROOT=%SRC%.."
set "BUILD=%LOCALAPPDATA%\K Downloader\build"

echo Building in "%BUILD%" (kept out of the cloud-synced folder).
rem Nothing ships unless the preflight passes: syntax, search modules, and a real helper doing real downloads.
if not "%KD_SKIP_TESTS%"=="1" (
  echo Running preflight tests...
  "%ROOT%\bin\node.exe" "%ROOT%\tests\preflight.js" || goto :fail
)
if not exist "%BUILD%" mkdir "%BUILD%"
robocopy "%SRC%." "%BUILD%" /MIR /XD node_modules dist payload /XF build.cmd /NFL /NDL /NJH /NJS >nul
robocopy "%ROOT%\helper" "%BUILD%\payload\helper" /MIR /NFL /NDL /NJH /NJS >nul
robocopy "%ROOT%\bin" "%BUILD%\payload\bin" /MIR /NFL /NDL /NJH /NJS >nul
robocopy "%ROOT%\assets" "%BUILD%\payload\assets" /MIR /NFL /NDL /NJH /NJS >nul
"%ROOT%\bin\node.exe" "%ROOT%\helper\make-content.js" || goto :fail
robocopy "%ROOT%\extension" "%BUILD%\payload\extension" /MIR /NFL /NDL /NJH /NJS >nul
copy /Y "%ROOT%\kareem-downloader.user.js" "%BUILD%\payload\" >nul
copy /Y "%ROOT%\README.md" "%BUILD%\payload\" >nul

cd /d "%BUILD%"
if not exist node_modules\electron (
  echo Installing Electron and electron-builder...
  call npm.cmd install --no-audit --no-fund || goto :fail
)
if exist "%BUILD%\dist\K Downloader Setup*.exe" del /q "%BUILD%\dist\K Downloader Setup*.exe"
echo Packaging...
rem The extension's Web Store id (extension\store-id.txt) turns the installer's browser checkboxes on.
set "KD_EXT_ID="
if exist "%ROOT%\extension\store-id.txt" set /p KD_EXT_ID=<"%ROOT%\extension\store-id.txt"
"%ROOT%\bin\node.exe" "%SRC%extid.js" "%SRC%installer.nsh" "%BUILD%\installer.nsh" "%KD_EXT_ID%" || goto :fail
rem Store package: the extension folder as a zip, ready to upload.
if not exist "%ROOT%\extension-store" mkdir "%ROOT%\extension-store"
powershell -NoProfile -Command "Compress-Archive -Path '%ROOT%\extension\*' -DestinationPath '%ROOT%\extension-store\k-downloader-extension.zip' -Force" >nul
rem Code signing happens only when a certificate is configured (see SIGNING.md).
set "SIGNARGS="
if defined KD_SIGN_SUBJECT set "SIGNARGS=--config.win.signtoolOptions.certificateSubjectName=%KD_SIGN_SUBJECT% --config.win.signtoolOptions.rfc3161TimeStampServer=http://timestamp.digicert.com"
if defined KD_SIGN_AZURE set "SIGNARGS=--config.win.azureSignOptions.endpoint=%KD_SIGN_AZURE_ENDPOINT% --config.win.azureSignOptions.codeSigningAccountName=%KD_SIGN_AZURE_ACCOUNT% --config.win.azureSignOptions.certificateProfileName=%KD_SIGN_AZURE_PROFILE%"
if defined SIGNARGS echo Signing with: %SIGNARGS%
rem --publish never: on a tagged commit electron-builder would otherwise try to publish a GitHub release itself.
call npx.cmd electron-builder --win --publish never %SIGNARGS% || goto :fail
rem A new build waits in dist\review until Karim has reviewed it; app\release.cmd then moves it into dist and
rem writes latest.json, which is the moment every installed copy learns about it.
if not exist "%ROOT%\dist\review" mkdir "%ROOT%\dist\review"
copy /Y "%BUILD%\dist\K Downloader Setup*.exe" "%ROOT%\dist\review\" >nul
echo.
echo Built for review: "%ROOT%\dist\review"
dir /b "%ROOT%\dist\review"
echo After review, run app\release.cmd to publish it to dist and latest.json.
endlocal
exit /b 0

:fail
echo Build failed.
endlocal
exit /b 1
