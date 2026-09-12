@echo off
chcp 65001 > nul

cd /d "%~dp0.."

echo ==============================
echo GitHub 최신 파일 가져오는 중...
echo ==============================

git pull

echo.
echo VS Code 실행
code -n . index.html

pause