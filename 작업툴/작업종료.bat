@echo off
chcp 65001 > nul

cd /d "%~dp0.."

if errorlevel 1 (
    echo 프로젝트 폴더로 이동하지 못했습니다.
    pause
    exit /b
)

echo ==============================
echo 현재 Git 브랜치 확인
echo ==============================

for /f "delims=" %%b in ('git branch --show-current') do set branch=%%b

if "%branch%"=="" (
    echo.
    echo Git 저장소가 아니거나 현재 브랜치를 확인할 수 없습니다.
    pause
    exit /b
)

echo.
echo 현재 브랜치: %branch%
echo.

if "%branch%"=="main" (
    echo ==========================================
    echo [주의] 현재 main 브랜치입니다.
    echo 이 브랜치의 Push는 실제 배포 버전에 영향을 줄 수 있습니다.
    echo ==========================================
    echo.

    choice /C YN /M "main 브랜치 작업을 GitHub에 저장하시겠습니까?"

    if errorlevel 2 (
        echo.
        echo 작업종료를 취소했습니다.
        pause
        exit /b
    )
)

echo ==============================
echo 변경사항 확인 중...
echo ==============================

git status --porcelain | findstr . >nul

if errorlevel 1 (
    echo.
    echo 변경사항이 없습니다.
    echo GitHub에 저장할 내용이 없습니다.
    echo.
    pause
    exit /b
)

echo.
git status
echo.

set /p msg=수정 내용을 입력하세요: 

if "%msg%"=="" (
    echo.
    echo 커밋 메시지를 입력하지 않았습니다.
    echo 작업종료를 취소합니다.
    pause
    exit /b
)

echo.
echo ==============================
echo 변경사항을 Commit 중...
echo ==============================

git add .

if errorlevel 1 (
    echo.
    echo git add 과정에서 문제가 발생했습니다.
    pause
    exit /b
)

git commit -m "%msg%"

if errorlevel 1 (
    echo.
    echo Commit 과정에서 문제가 발생했습니다.
    pause
    exit /b
)

echo.
echo ==============================
echo GitHub 최신 상태 확인 중...
echo ==============================

git pull --rebase

if errorlevel 1 (
    echo.
    echo Git pull --rebase 과정에서 문제가 발생했습니다.
    echo 자동 Push를 중단합니다.
    echo.
    echo 현재 작업 내용은 로컬 Commit으로 저장되어 있습니다.
    echo 충돌 여부를 확인한 뒤 다시 Push하세요.
    pause
    exit /b
)

echo.
echo ==============================
echo GitHub로 업로드 중...
echo ==============================

git push

if errorlevel 1 (
    echo.
    echo Push 과정에서 문제가 발생했습니다.
    echo 현재 작업 내용은 로컬 Commit으로 저장되어 있습니다.
    pause
    exit /b
)

echo.
echo ==========================================
echo GitHub 저장 완료!
echo 브랜치: %branch%
echo ==========================================
echo.

pause