; K Downloader installer additions: a page that offers the browser extension for Chrome and Edge.
; When the extension has a Web Store id (store-id.txt), ticking a box registers it with the browser,
; which fetches it from the Web Store on its next start and asks once to enable it. Without an id, the
; page explains the one manual step instead. Silent installs can pass /EXT=chrome,edge to do the same.
; build.cmd prepends !define KD_EXT_ID to this file in the build folder (empty until the extension is published).

!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef KD_EXT_ID
  !define KD_EXT_ID ""
!endif

; The uninstaller is compiled from the same script and never uses these.
!ifndef BUILD_UNINSTALLER
Var KdDialog
Var KdChrome
Var KdEdge
Var KdChromeState
Var KdEdgeState
Var KdHaveChrome
Var KdHaveEdge
!endif

!macro customInit
  StrCpy $KdChromeState ${BST_UNCHECKED}
  StrCpy $KdEdgeState ${BST_UNCHECKED}
  StrCpy $KdHaveChrome 0
  StrCpy $KdHaveEdge 0
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
  ${If} $0 != ""
    StrCpy $KdHaveChrome 1
  ${Else}
    ReadRegStr $0 HKCU "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" ""
    ${If} $0 != ""
      StrCpy $KdHaveChrome 1
    ${EndIf}
  ${EndIf}
  ReadRegStr $0 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" ""
  ${If} $0 != ""
    StrCpy $KdHaveEdge 1
  ${EndIf}
  ${If} $KdHaveChrome == 1
    StrCpy $KdChromeState ${BST_CHECKED}
  ${EndIf}
  ; Silent: /EXT=chrome,edge
  ${GetParameters} $0
  ${GetOptions} $0 "/EXT=" $1
  ${If} $1 != ""
    StrCpy $KdChromeState ${BST_UNCHECKED}
    StrCpy $KdEdgeState ${BST_UNCHECKED}
    ${If} $1 == "chrome"
    ${OrIf} $1 == "chrome,edge"
    ${OrIf} $1 == "edge,chrome"
      StrCpy $KdChromeState ${BST_CHECKED}
    ${EndIf}
    ${If} $1 == "edge"
    ${OrIf} $1 == "chrome,edge"
    ${OrIf} $1 == "edge,chrome"
      StrCpy $KdEdgeState ${BST_CHECKED}
    ${EndIf}
  ${EndIf}
!macroend

; Welcome and finish pages carry the developer credit. The finish page keeps the "run now" box: the first run
; opens the setup guide, registers Claude and starts the helper.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "K Downloader"
  !define MUI_WELCOMEPAGE_TEXT "Kareem Downloader Tool$\r$\n$\r$\nVideos up to 4K, audio, frames and subtitles from any site; free photos and stock footage; a download manager for Chrome; and a helper that Claude Code uses on your behalf.$\r$\n$\r$\nDeveloped by Kareem Waheed$\r$\nhttps://www.linkedin.com/in/kareemtokka/$\r$\n$\r$\nSetup takes a minute. Press Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  !define MUI_FINISHPAGE_TITLE "K Downloader is installed"
  !define MUI_FINISHPAGE_TEXT "The app starts with Windows and stays in the tray. On its first run it shows a short setup guide: the browser extension, Claude Code, and where files go.$\r$\n$\r$\nDeveloped by Kareem Waheed (https://www.linkedin.com/in/kareemtokka/)."
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "Open K Downloader and the setup guide"
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

; nsDialogs page shown after the install-folder page. MUI2 is only available once the page list is
; being built, so the page functions live inside this hook.
!macro customPageAfterChangeDir
  Page custom KdExtPage KdExtPageLeave
  Function KdExtPage
    ${If} ${Silent}
      Abort
    ${EndIf}
    nsDialogs::Create 1018
    Pop $KdDialog
    ${If} $KdDialog == error
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Browser extension" "Download button on video sites, and a download manager for every file"
    ${If} "${KD_EXT_ID}" != ""
      ${NSD_CreateLabel} 0 0 100% 24u "Tick a browser. The next time it starts it fetches the extension and asks you once to enable it; after that it connects to K Downloader by itself."
      Pop $0
      ${NSD_CreateCheckbox} 0 30u 100% 12u "Add to Google Chrome"
      Pop $KdChrome
      ${NSD_SetState} $KdChrome $KdChromeState
      ${If} $KdHaveChrome == 0
        EnableWindow $KdChrome 0
      ${EndIf}
      ${NSD_CreateCheckbox} 0 46u 100% 12u "Add to Microsoft Edge"
      Pop $KdEdge
      ${NSD_SetState} $KdEdge $KdEdgeState
      ${If} $KdHaveEdge == 0
        EnableWindow $KdEdge 0
      ${EndIf}
      ${NSD_CreateLabel} 0 68u 100% 24u "You can remove it later from the browser's extensions page like any other extension."
      Pop $0
    ${Else}
      ${NSD_CreateLabel} 0 0 100% 60u "The extension is included. After setup, open K Downloader, go to Settings, press Open folder next to Chrome extension, then in Chrome open chrome://extensions, turn on Developer mode, press Load unpacked and pick that folder. It connects by itself."
      Pop $0
    ${EndIf}
    nsDialogs::Show
  FunctionEnd

  Function KdExtPageLeave
    ${If} "${KD_EXT_ID}" != ""
      ${NSD_GetState} $KdChrome $KdChromeState
      ${NSD_GetState} $KdEdge $KdEdgeState
    ${EndIf}
  FunctionEnd
!macroend

; Chrome's external-extension key: the browser fetches the extension from the Web Store on its next start and
; asks once with an Enable button. HKCU\Software\Policies would avoid that click but is admin-only, and this
; installer runs without admin rights. Edge reads the same kind of key when it allows extensions from other stores.
!macro KdExternalExtension ROOT
  WriteRegStr HKCU "${ROOT}\Extensions\${KD_EXT_ID}" "update_url" "https://clients2.google.com/service/update2/crx"
!macroend

!macro customInstall
  ; What the user chose, so the app and support can see it.
  WriteRegStr HKCU "Software\K Downloader" "BrowserChoice" "chrome=$KdChromeState edge=$KdEdgeState id=${KD_EXT_ID}"
  StrCmp "${KD_EXT_ID}" "" kd_ext_done
  StrCmp $KdChromeState ${BST_CHECKED} 0 +2
    !insertmacro KdExternalExtension "Software\Google\Chrome"
  StrCmp $KdEdgeState ${BST_CHECKED} 0 +2
    !insertmacro KdExternalExtension "Software\Microsoft\Edge"
  kd_ext_done:
!macroend

!macro customUnInstall
  ; The app registers a Task Scheduler task for startup; it goes with the app.
  nsExec::ExecToLog 'schtasks.exe /Delete /TN "K Downloader" /F'
  StrCmp "${KD_EXT_ID}" "" +3
    DeleteRegKey HKCU "Software\Google\Chrome\Extensions\${KD_EXT_ID}"
    DeleteRegKey HKCU "Software\Microsoft\Edge\Extensions\${KD_EXT_ID}"
  DeleteRegValue HKCU "Software\K Downloader" "BrowserChoice"
!macroend
