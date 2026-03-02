@echo off
setlocal
set "SCRIPTDIR=%~dp0"
set "ROOT=%SCRIPTDIR%.."
set "NODE="

if not "%ProgramFiles%"=="" if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if not "%ProgramFiles(x86)%"=="" if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if not "%LOCALAPPDATA%"=="" if exist "%LOCALAPPDATA%\Programs\node\node.exe" set "NODE=%LOCALAPPDATA%\Programs\node\node.exe"
if not defined NODE where node.exe >nul 2>&1 && for /f "tokens=*" %%i in ('where node.exe 2^>nul') do set "NODE=%%i" & goto :run
if not defined NODE (
  echo Node.js was not found. Install from https://nodejs.org or add Node to your PATH.
  exit /b 1
)

:run
cd /d "%ROOT%"
echo Compiling...
"%NODE%" "%SCRIPTDIR%compile.js"
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%
if not exist ".vsce" mkdir .vsce
echo Packaging .vsix into .vsce\...
set "NPX=%NODE:node.exe=npx.cmd%"
if exist "%NPX%" (call "%NPX%" --yes @vscode/vsce package --out ".vsce\cursor-global-ai-cursor-global-ai-manager-1.0.0.vsix") else (call npx --yes @vscode/vsce package --out ".vsce\cursor-global-ai-cursor-global-ai-manager-1.0.0.vsix")
if %ERRORLEVEL% equ 0 (
  echo Done. .vsix is in .vsce\
) else (
  echo Package failed. Try: npm install -g @vscode/vsce
  echo Then run: vsce package --out .vsce\cursor-global-ai-cursor-global-ai-manager-1.0.0.vsix
)
exit /b %ERRORLEVEL%
