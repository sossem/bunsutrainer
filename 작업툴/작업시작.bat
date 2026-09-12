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
    echo 현재 배포 중인 안정 버전입니다.
    echo 대규모 개선 작업은 redesign 브랜치에서 하세요.
    echo ==========================================
    echo.
)

echo ==============================
echo GitHub 최신 파일 가져오는 중...
echo ==============================

git pull

if errorlevel 1 (
    echo.
    echo Git pull 과정에서 문제가 발생했습니다.
    echo 충돌 또는 네트워크 상태를 확인하세요.
    pause
    exit /b
)

echo.
echo ==========================================
echo 작업 준비 완료
echo 현재 브랜치: %branch%
echo ==========================================
echo.

echo VS Code 실행
code -n . index.html

pause