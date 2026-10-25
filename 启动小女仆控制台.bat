@echo off
cd /d "%~dp0"
set "DSHPY=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\pythonw.exe"
if exist "%DSHPY%" (
    start "" "%DSHPY%" "%~dp0panel.py"
    exit /b
)
where pythonw >nul 2>nul
if %errorlevel%==0 (
    start "" pythonw "%~dp0panel.py"
    exit /b
)
echo 需要 Python（带 tkinter）才能打开小女仆控制台。
pause
