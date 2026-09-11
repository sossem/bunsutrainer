@echo off
chcp 65001 > nul

cd /d "C:\Users\USER\Desktop\codingroom\bunsutrainer"

if errorlevel 1 (
    echo 프로젝트 폴더로 이동하지 못했습니다.
    pause
    exit /b
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
    pause
    exit /b
)

echo.
echo 변경사항 저장 중...
git add .

git commit -m "%msg%"

if errorlevel 1 (
    echo.
    echo Commit 과정에서 문제가 발생했습니다.
    pause
    exit /b
)

echo.
echo GitHub로 업로드 중...
git push

if errorlevel 1 (
    echo.
    echo Push 과정에서 문제가 발생했습니다.
    pause
    exit /b
)

echo.
echo ==============================
echo GitHub 저장 완료!
echo ==============================
pause