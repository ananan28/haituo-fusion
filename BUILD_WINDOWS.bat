@echo off
setlocal
cd /d "%~dp0"
echo [1/3] Installing locked dependencies...
call npm ci
if errorlevel 1 goto :fail
echo [2/3] Preparing bundled Signal and Java runtimes...
call npm run prepare:signal
if errorlevel 1 goto :fail
echo [3/3] Building installer and portable EXE...
call npm run dist:win
if errorlevel 1 goto :fail
echo Build complete. Open release for the installer and portable EXE.
pause
exit /b 0
:fail
echo Build failed. Copy the error above for diagnosis.
pause
exit /b 1
