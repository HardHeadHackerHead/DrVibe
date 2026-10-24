@echo off
rem Dr. Vibe - Windows launcher for the Claude Code integration hook.
rem Wraps the bash script so Claude Code on Windows can invoke it as a
rem single executable path without nested-quote tokenization issues.
"C:\Program Files\Git\bin\bash.exe" "%~dp0claude-code-hook.sh"
if errorlevel 1 (
  rem Fall back to bash on PATH if the standard Git install isn't present
  bash "%~dp0claude-code-hook.sh"
)
exit /b 0
