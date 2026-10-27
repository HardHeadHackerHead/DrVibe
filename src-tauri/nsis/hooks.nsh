; Dr. Vibe - NSIS installer hooks (bundle.windows.nsis.installerHooks).
;
; Before the files are removed, the uninstaller takes out what Dr. Vibe put
; outside its own folders: its hooks in ~/.claude/settings.json (the app
; does that itself with --privacy-uninstall-cleanup, see main.rs, so the
; JSON is edited by the same code that wrote it) and ~/.dr-vibe (the hook
; script, its log and lists). Skipped when the uninstaller runs as part of
; an update (/UPDATE): an update must not switch Claude Code off.

!macro NSIS_HOOK_PREUNINSTALL
  ClearErrors
  ${GetOptions} $CMDLINE "/UPDATE" $R9
  ${If} ${Errors}
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --privacy-uninstall-cleanup'
    RMDir /r "$PROFILE\.dr-vibe"
  ${EndIf}
  ClearErrors
!macroend
