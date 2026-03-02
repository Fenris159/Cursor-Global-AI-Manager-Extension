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
"%NODE%" "%SCRIPTDIR%package-vsix.js"
exit /b %ERRORLEVEL%
