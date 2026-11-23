@echo off
chcp 65001 >nul
title Dr Quiz Hub
cd /d "%~dp0"
echo Starting Dr Quiz Hub...
echo Open: http://localhost:3000
npm start
pause
