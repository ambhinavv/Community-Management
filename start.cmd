@echo off
cd /d "%~dp0"
set "PATH=%ProgramFiles%\nodejs;%PATH%"
"%ProgramFiles%\nodejs\node.exe" start.mjs
