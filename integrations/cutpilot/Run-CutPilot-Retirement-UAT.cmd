@echo off
setlocal
if "%~1"=="" (
  echo CutPilot Windows Retirement UAT
  echo Usage: %~nx0 -Source "D:\Videos\sample.mp4" -CutPilotRepo "C:\path\to\CutPilot" -Mode visual -ApplyAndRender
  echo Requires AI Edit Studio running on http://127.0.0.1:32146 and CutPilot rank-only branch.
  exit /b 2
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-CutPilot-Retirement-UAT.ps1" %*
exit /b %ERRORLEVEL%
