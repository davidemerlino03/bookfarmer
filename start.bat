@echo off
setlocal enabledelayedexpansion

set "APP_DIR=%~dp0"
set "REMOTE_URL=https://github.com/davidemerlino03/bookfarmer.git"
set "VERSION_FILE=.current_release"

cd /d "%APP_DIR%"

where adb >nul 2>nul
if errorlevel 1 (
    echo [bookfarmer] adb non e installato o non e presente nel PATH.
    echo [bookfarmer] Installa Android Platform Tools, poi riavvia questo script.
    pause
    exit /b 1
)

echo [bookfarmer] Controllo nuove release...

git remote get-url origin >nul 2>nul
if errorlevel 1 (
    echo [bookfarmer] Configuro il repository remoto...
    git remote add origin "%REMOTE_URL%"
) else (
    for /f "delims=" %%u in ('git remote get-url origin') do set "CURRENT_REMOTE=%%u"
    if not "!CURRENT_REMOTE!"=="%REMOTE_URL%" (
        echo [bookfarmer] Correggo il repository remoto...
        git remote set-url origin "%REMOTE_URL%"
    )
)

git fetch origin --tags
if errorlevel 1 (
    echo [bookfarmer] Impossibile controllare le release. Avvio la versione locale.
    goto start_app
)

set "LATEST_TAG="
for /f "delims=" %%t in ('git tag --list') do (
    echo %%t | findstr /r /c:"^v*[0-9][0-9]*\(\.[0-9][0-9]*\)*$" >nul
    if not errorlevel 1 set "LATEST_TAG=%%t"
)

if "%LATEST_TAG%"=="" (
    echo [bookfarmer] Nessuna release trovata. Avvio la versione locale.
    goto start_app
)

set "CURRENT_TAG="
if exist "%VERSION_FILE%" (
    set /p CURRENT_TAG=<"%VERSION_FILE%"
) else (
    for /f "delims=" %%t in ('git describe --tags --exact-match 2^>nul') do set "CURRENT_TAG=%%t"
)

if "%CURRENT_TAG%"=="%LATEST_TAG%" (
    echo [bookfarmer] Versione gia aggiornata: %LATEST_TAG%
    goto update_deps
)

for /f "delims=" %%s in ('git status --porcelain --untracked-files^=no') do (
    echo [bookfarmer] Ci sono modifiche locali tracciate. Aggiornamento annullato.
    echo [bookfarmer] Commit/stash delle modifiche prima di aggiornare alla release %LATEST_TAG%.
    goto update_deps
)

echo [bookfarmer] Nuova release trovata: %LATEST_TAG%
git checkout --detach "%LATEST_TAG%"
if errorlevel 1 (
    echo [bookfarmer] Aggiornamento non riuscito. Avvio la versione locale.
    goto start_app
)
echo %LATEST_TAG%>"%VERSION_FILE%"
echo [bookfarmer] Aggiornato alla release %LATEST_TAG%.

:update_deps
if exist "venv\Scripts\python.exe" if exist "requirements.txt" (
    echo [bookfarmer] Aggiorno dipendenze...
    "venv\Scripts\python.exe" -m pip install -r requirements.txt
)

:start_app
echo [bookfarmer] Avvio applicazione...
if exist "venv\Scripts\python.exe" (
    "venv\Scripts\python.exe" app.py
) else (
    python app.py
)

endlocal
