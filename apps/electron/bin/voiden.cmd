@echo off
setlocal enabledelayedexpansion

REM ============================================
REM Voiden CLI launcher for Windows
REM Copyright (c) ApyHub
REM ============================================

REM ============================================
REM VERSION - Replaced at build time by forge.config.ts
REM ============================================
set "VOIDEN_VERSION=1.4.0"

REM ============================================
REM Functions (using CALL with labels)
REM ============================================

goto :main

:show_version
echo Voiden v%VOIDEN_VERSION%
exit /b 0

:show_help
echo Voiden - File and Directory Management
echo.
echo Usage: voiden [options] or voiden path
echo.
echo Options:
echo   -v, --version     Show version information
echo   -h, --help        Show this help message
echo   path            Open file or directory
echo.
echo Examples:
echo   voiden                     # Open Voiden
echo   voiden %%USERPROFILE%%\Documents  # Open Documents directory
echo   voiden myproject           # Open myproject from current directory
echo   voiden file.txt            # Open files as tabs
echo   voiden -v                  # Show version
echo   voiden --version           # Show version
echo   voiden -h                  # Show this help
echo   voiden --help              # Show this help
echo.
echo Note: Relative paths are resolved from your current terminal location
exit /b 0

:show_flag_error
echo Error: Unrecognized flag '%~1'
echo For information, type: voiden --help
exit /b 1

:validate_short_flags
set "flag_string=%~1"
set "original_arg=%~2"
set "flag_len=0"

REM Get length of flag string
call :strlen "!flag_string!" flag_len

REM Check each character in the flag string
for /L %%i in (0,1,!flag_len!) do (
    set "char=!flag_string:~%%i,1!"
    if not "!char!"=="" (
        if not "!char!"=="v" if not "!char!"=="h" (
            set "HAS_INVALID_FLAG=1"
            set "INVALID_FLAG=!original_arg!"
            exit /b 1
        )
    )
)
exit /b 0

:strlen
set "str=%~1"
set "len=0"
:strlen_loop
if defined str (
    set "str=!str:~1!"
    set /a len+=1
    goto :strlen_loop
)
set "%~2=%len%"
exit /b 0

:resolve_path
set "input_path=%~1"
set "RESOLVED_PATH="

REM Check if path is absolute (contains : for drive letter or starts with \)
echo !input_path! | findstr /R /C:"^[A-Za-z]:" >nul
if !ERRORLEVEL!==0 (
    REM Absolute path with drive letter
    set "RESOLVED_PATH=!input_path!"
    exit /b 0
)

echo !input_path! | findstr /R /C:"^[\\/]" >nul
if !ERRORLEVEL!==0 (
    REM Absolute path starting with \ or /
    set "RESOLVED_PATH=!input_path!"
    exit /b 0
)

REM Check if path is just "."
if "!input_path!"=="." (
    set "RESOLVED_PATH=%CD%"
    exit /b 0
)

REM Relative path - combine with current directory
set "RESOLVED_PATH=%CD%\!input_path!"
exit /b 0

REM ============================================
REM MAIN SCRIPT EXECUTION
REM ============================================
:main

REM ============================================
REM Check for help/version flags first
REM ============================================
for %%a in (%*) do (
    set "arg=%%~a"
    if "!arg!"=="-v" (
        call :show_version
        exit /b 0
    )
    if "!arg!"=="--version" (
        call :show_version
        exit /b 0
    )
    if "!arg!"=="-h" (
        call :show_help
        exit /b 0
    )
    if "!arg!"=="--help" (
        call :show_help
        exit /b 0
    )
)

REM ============================================
REM Validate Arguments
REM ============================================
set "HAS_INVALID_FLAG=0"
set "INVALID_FLAG="

for %%a in (%*) do (
    set "arg=%%~a"
    
    REM Check if argument starts with - (it's a flag)
    if "!arg:~0,1!"=="-" (
        REM Check for valid flags
        if "!arg!"=="--version" (
            REM Valid
        ) else if "!arg!"=="-v" (
            REM Valid
        ) else if "!arg!"=="--help" (
            REM Valid
        ) else if "!arg!"=="-h" (
            REM Valid
        ) else (
            REM Invalid flag - show error and exit
            call :show_flag_error "!arg!"
            exit /b 1
        )
    )
)

REM ============================================
REM Find Voiden Installation
REM ============================================
set "VOIDEN_PATH="

REM Check common installation paths
if exist "%LOCALAPPDATA%\voiden\Voiden.exe" (
    set "VOIDEN_PATH=%LOCALAPPDATA%\voiden\Voiden.exe"
) else if exist "%LOCALAPPDATA%\Programs\Voiden\Voiden.exe" (
    set "VOIDEN_PATH=%LOCALAPPDATA%\Programs\Voiden\Voiden.exe"
) else if exist "%ProgramFiles%\Voiden\Voiden.exe" (
    set "VOIDEN_PATH=%ProgramFiles%\Voiden\Voiden.exe"
) else if exist "%ProgramFiles(x86)%\Voiden\Voiden.exe" (
    set "VOIDEN_PATH=%ProgramFiles(x86)%\Voiden\Voiden.exe"
) else (
    echo Unable to find Voiden installation
    echo Searched common installation locations
    exit /b 1
)

REM ============================================
REM Process arguments and resolve paths
REM ============================================
set "RESOLVED_ARGS="
set "HAS_ARGS=0"

for %%a in (%*) do (
    set "arg=%%~a"
    
    REM Skip flags (they were already handled)
    if not "!arg:~0,1!"=="-" (
        set "HAS_ARGS=1"
        REM Resolve the path
        call :resolve_path "!arg!"
        set "RESOLVED_ARGS=!RESOLVED_ARGS! "!RESOLVED_PATH!""
    )
)

REM ============================================
REM Launch Application (Detached)
REM ============================================

REM Launch detached from terminal with proper argument passing
if !HAS_ARGS!==0 (
    REM No arguments, just open the app
    start "" /B "%VOIDEN_PATH%" >nul 2>&1
) else (
    REM Pass resolved arguments directly, detached
    start "" /B "%VOIDEN_PATH%" !RESOLVED_ARGS! >nul 2>&1
)

exit /b 0