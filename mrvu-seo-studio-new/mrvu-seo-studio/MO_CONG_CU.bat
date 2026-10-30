@echo off
chcp 65001 >nul
title Mr.Vu SEO Studio
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Chua cai Python. Tai tai https://www.python.org/downloads/ va tick "Add Python to PATH" khi cai.
  pause
  exit /b
)
python app.py
pause
