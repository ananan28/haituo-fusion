!include "FileFunc.nsh"
!macro customInstall
  ; Remove old downloaded installers and updater caches, keeping all account data on upgrades.
  SetOutPath "$PLUGINSDIR"
  File /oname=haituo-cleanup.ps1 "${BUILD_RESOURCES_DIR}\cleanup.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\haituo-cleanup.ps1" -Mode cache -InstallDirectory "$INSTDIR"'
  Pop $0
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    SetShellVarContext current
    SetOutPath "$PLUGINSDIR"
    File /oname=haituo-cleanup.ps1 "${BUILD_RESOURCES_DIR}\cleanup.ps1"
    StrCpy $R8 "cache"
    ${GetParameters} $R9
    ClearErrors
    ${GetOptions} $R9 "/PURGE_DATA" $R7
    ${ifNot} ${Errors}
      StrCpy $R8 "purge"
    ${else}
      IfSilent haituo_cleanup_ready
      MessageBox MB_YESNOCANCEL|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "是否彻底卸载海拓？$\r$\n$\r$\n是：删除全部账号、聊天记录、登录状态、API 密钥、设置、缓存和历史海拓数据，无法恢复。$\r$\n否：只卸载程序并清理缓存，保留账号数据。$\r$\n取消：停止卸载。" IDYES haituo_purge IDNO haituo_cleanup_ready
      Abort
      haituo_purge:
        StrCpy $R8 "purge"
    ${endif}
    haituo_cleanup_ready:
    nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\haituo-cleanup.ps1" -Mode $R8 -InstallDirectory "$INSTDIR"'
    Pop $0
    ${if} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "海拓有文件未能清除，可能仍被占用。请关闭全部海拓进程后重新卸载；本次不报告为清理成功。"
      Abort
    ${endif}
  ${endif}
!macroend
