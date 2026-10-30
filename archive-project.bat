@echo off
setlocal

cd /d "%~dp0"

REM Generate locale-independent timestamp
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"') do set "TIMESTAMP=%%i"

set "ARCHIVE_DIR=%~dp0archives"
set "ARCHIVE=%ARCHIVE_DIR%\molten-forge_%TIMESTAMP%.zip"

if not exist "%ARCHIVE_DIR%" mkdir "%ARCHIVE_DIR%"

echo.
echo Creating source archive...
echo %ARCHIVE%
echo.

tar -a -c -f "%ARCHIVE%" ^
  --exclude="./node_modules" ^
  --exclude="./src-tauri/target" ^
  --exclude="./src-tauri/gen" ^
  --exclude="./target" ^
  --exclude="./dist" ^
  --exclude="./dist-electron" ^
  --exclude="./build" ^
  --exclude="./release" ^
  --exclude="./out" ^
  --exclude="./coverage" ^
  --exclude="./archives" ^
  --exclude="./.git" ^
  --exclude="./.idea" ^
  --exclude="./.vscode" ^
  --exclude="./.vite" ^
  --exclude="./.cache" ^
  --exclude="./.turbo" ^
  --exclude="./.next" ^
  --exclude="./tmp" ^
  --exclude="./temp" ^
  --exclude="*.log" ^
  --exclude="*.zip" ^
  --exclude="*.7z" ^
  --exclude="*.rar" ^
  .

if errorlevel 1 (
    echo.
    echo ERROR: Failed to create archive.
    pause
    exit /b 1
)

echo.
echo Done:
echo %ARCHIVE%
echo.

for %%A in ("%ARCHIVE%") do echo Size: %%~zA bytes

pause