@echo off
cd /d "C:\Users\USER\Desktop\codingroom\bunsutrainer"
start http://localhost:8000
python -m http.server 8000 --bind 127.0.0.1