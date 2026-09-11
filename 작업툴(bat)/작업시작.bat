@echo off
chcp 65001 > nul

cd /d "C:\Users\USER\Desktop\codingroom\bunsutrainer"

echo ==============================
echo GitHub 최신 파일 가져오는 중...
echo ==============================

git pull

echo.
echo VS Code 실행
code .

pause
