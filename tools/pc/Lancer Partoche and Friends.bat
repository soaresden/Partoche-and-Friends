@echo off
chcp 65001 >nul
title Partoche and Friends
rem Double-clic : lance Partoche and Friends sur http://localhost:53682 (rien à installer)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serveur.ps1"
if errorlevel 1 pause
