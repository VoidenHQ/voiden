@echo off
REM Voiden Cleanup Script for Windows
REM Clones/pulls plugin repos, removes node_modules + caches, reinstalls, and builds all local plugin repos.

setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

REM ─── Argument parsing ────────────────────────────────────────────────────────
set "SKIP_INSTALL=false"

if /i "%~1"=="--help" goto :show_help
if /i "%~1"=="-h" goto :show_help
if /i "%~1"=="--skip-install" set "SKIP_INSTALL=true"
if not "%~1"=="" if /i not "%~1"=="--skip-install" (
    echo Unknown argument: %~1
    exit /b 1
)
goto :done_args

:show_help
echo Usage: cleanup.bat [--skip-install]
echo.
echo   --skip-install   Skip removing node_modules and running yarn install
exit /b 0

:done_args

echo Starting Voiden cleanup...
if "!SKIP_INSTALL!"=="true" echo (--skip-install: skipping node_modules removal and yarn install)
echo.

set "PLUGINS_DIR=%ROOT_DIR%plugins"
if not exist "%PLUGINS_DIR%" mkdir "%PLUGINS_DIR%"

REM ─── Step 1: Clone or pull plugin-registry ───────────────────────────────────
echo Step 1: plugin-registry
set "REGISTRY_DIR=%PLUGINS_DIR%\plugin-registry"
if exist "%REGISTRY_DIR%\" (
    echo   Pulling plugin-registry...
    git -C "%REGISTRY_DIR%" pull
    if errorlevel 1 ( echo FAILED: Failed to pull plugin-registry & exit /b 1 )
) else (
    echo   Cloning plugin-registry...
    git clone https://github.com/VoidenHQ/plugin-registry.git "%REGISTRY_DIR%"
    if errorlevel 1 ( echo FAILED: Failed to clone plugin-registry & exit /b 1 )
)
echo [OK] plugin-registry ready
echo.

REM ─── Step 2: Clone or pull each plugin listed in extensions.json ─────────────
echo Step 2: Plugin repos
set "REGISTRY_JSON=%REGISTRY_DIR%\extensions.json"
if not exist "%REGISTRY_JSON%" (
    echo FAILED: %REGISTRY_JSON% not found after clone
    exit /b 1
)

REM Pass REGISTRY_JSON as a separate argument so Node.exe receives a proper
REM Windows path instead of a POSIX /c/... path from Git Bash expansion.
set "PLUGIN_LIST_TMP=%TEMP%\voiden_plugins_%RANDOM%.txt"
node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const p=Array.isArray(r)?r.filter(x=>x.type==='core'):[];p.forEach(x=>{if(x.id&&x.repo)console.log(x.id+' '+x.repo);});" "%REGISTRY_JSON%" > "%PLUGIN_LIST_TMP%" 2>nul
if errorlevel 1 (
    echo FAILED: Failed to parse %REGISTRY_JSON%
    del "%PLUGIN_LIST_TMP%" 2>nul
    exit /b 1
)

set PLUGIN_LIST_EMPTY=true
for /f "usebackq tokens=*" %%L in ("%PLUGIN_LIST_TMP%") do set PLUGIN_LIST_EMPTY=false

if "%PLUGIN_LIST_EMPTY%"=="true" (
    echo   No plugins with repo entries found in registry -- skipping clone step.
) else (
    for /f "usebackq tokens=1,2" %%A in ("%PLUGIN_LIST_TMP%") do (
        set "PLUGIN_DIR=%PLUGINS_DIR%\%%A"
        <nul set /p="  %%A... "
        if exist "!PLUGIN_DIR!\" (
            git -C "!PLUGIN_DIR!" pull --quiet >nul 2>&1
            if errorlevel 1 (
                echo already up to date
            ) else (
                echo pulled
            )
        ) else (
            git clone "https://github.com/%%B.git" "!PLUGIN_DIR!" --quiet >nul 2>&1
            if errorlevel 1 (
                echo failed
            ) else (
                echo cloned
            )
        )
    )
)
del "%PLUGIN_LIST_TMP%" 2>nul
echo [OK] Plugin repos ready
echo.

REM ─── Count plugin directories ─────────────────────────────────────────────────
set PLUGIN_COUNT=0
for /d %%d in ("%PLUGINS_DIR%\*") do set /a PLUGIN_COUNT+=1

REM ─── Step 3: Remove node_modules (skip plugins/) ─────────────────────────────
if "!SKIP_INSTALL!"=="true" (
    echo Skipping node_modules removal (--skip-install^)
) else (
    echo Removing node_modules...
    for /d /r . %%d in (node_modules) do (
        set "DPATH=%%~fd"
        set "DCHECK=!DPATH:%PLUGINS_DIR%=!"
        if "!DCHECK!"=="!DPATH!" (
            if exist "%%d" rd /s /q "%%d" 2>nul
        )
    )
    echo [OK] Removed node_modules
)
echo.

REM ─── Step 4: Remove dist folders (skip plugins/ and node_modules/) ──────────
echo Removing dist folders...
for /d /r . %%d in (dist) do (
    set "DPATH=%%~fd"
    set "DCHECK=!DPATH:%PLUGINS_DIR%=!"
    if "!DCHECK!"=="!DPATH!" (
        echo !DPATH! | find /i "node_modules" >nul 2>&1
        if errorlevel 1 (
            if exist "%%d" rd /s /q "%%d" 2>nul
        )
    )
)
echo [OK] Removed dist folders
echo.

REM ─── Step 5: Remove TypeScript build cache ────────────────────────────────────
echo Removing TypeScript build cache...
for /r . %%f in (*.tsbuildinfo) do (
    set "FPATH=%%~ff"
    set "FCHECK=!FPATH:%PLUGINS_DIR%=!"
    if "!FCHECK!"=="!FPATH!" (
        echo !FPATH! | find /i "node_modules" >nul 2>&1
        if errorlevel 1 del /q "%%f" 2>nul
    )
)
echo [OK] Removed TypeScript build cache
echo.

REM ─── Step 6: Remove Vite / build caches ──────────────────────────────────────
if "!SKIP_INSTALL!"=="true" (
    echo Skipping Vite/build cache removal (--skip-install^)
) else (
    echo Removing build caches...
    if exist "apps\ui\node_modules\.vite" rd /s /q "apps\ui\node_modules\.vite" 2>nul
    if exist "apps\ui\.vite" rd /s /q "apps\ui\.vite" 2>nul
    if exist "apps\electron\out" rd /s /q "apps\electron\out" 2>nul
    echo [OK] Removed build caches
)
echo.

REM ─── Step 7: Fresh install ────────────────────────────────────────────────────
if "!SKIP_INSTALL!"=="true" (
    echo Skipping yarn install (--skip-install^)
) else (
    echo Running yarn install...
    call yarn install
    if errorlevel 1 ( echo FAILED: Failed to install dependencies & exit /b 1 )
    echo [OK] Dependencies installed
)
echo.

REM ─── Step 8: Build each plugin from local source ─────────────────────────────
if %PLUGIN_COUNT% gtr 0 (
    echo Building plugins from plugins\...
    echo.

    set BUILT=0
    set FAILED=0

    for /d %%P in ("%PLUGINS_DIR%\*") do (
        if exist "%%P\build.mjs" (
            if exist "%%P\manifest.json" (
                set "PLUGIN_ID="
                REM Pass manifest path as a separate argument so Node gets a proper Windows path
                for /f "delims=" %%I in ('node -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(d.id||'')}catch(e){}" "%%P\manifest.json" 2^>nul') do set "PLUGIN_ID=%%I"

                if not "!PLUGIN_ID!"=="" (
                    <nul set /p="  !PLUGIN_ID!... "

                    if not exist "%%P\node_modules" (
                        pushd "%%P"
                        npm install --no-package-lock --silent >nul 2>&1
                        popd
                    )

                    set BUILD_OK=true
                    pushd "%%P"
                    node build.mjs >nul 2>&1
                    if errorlevel 1 (
                        set BUILD_OK=false
                        set /a FAILED+=1
                    )
                    popd

                    if exist "%%P\build-main.mjs" (
                        pushd "%%P"
                        node build-main.mjs >nul 2>&1
                        if errorlevel 1 set BUILD_OK=false
                        popd
                    )

                    if "!BUILD_OK!"=="true" (
                        if exist "%%P\dist\!PLUGIN_ID!.js" (
                            echo [OK]
                            set /a BUILT+=1
                        ) else (
                            echo built (no bundle)
                            set /a BUILT+=1
                        )
                    ) else (
                        echo [FAILED]
                    )
                )
            )
        )
    )

    echo.
    echo [OK] Plugins: !BUILT! built -^> plugins/^<id^>/dist/
    if !FAILED! gtr 0 echo   [FAILED] !FAILED! failed
    echo.
)

echo Cleanup complete!
echo.
echo Next steps:
echo   Start app:              cd apps\electron ^&^& yarn start
echo   Build plugins once:     yarn dev:plugins
echo   Watch + hot-reload:     yarn plugins:dev
echo.

endlocal
