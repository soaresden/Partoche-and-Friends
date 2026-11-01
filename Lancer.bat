@echo off
chcp 65001 >nul
title Partoche and Friends
rem Pour tester depuis le dépôt : l'appli (web/) + un dossier « Partitions » à la racine du dépôt (ignoré par git).
rem La version zip pour tout le monde (sans Python) : tools/pc, publiée dans les Releases.
cd /d "%~dp0"

rem Python : "python" ou le lanceur "py"
set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py
if not defined PY (
  echo Python est introuvable. Installe-le depuis https://www.python.org/downloads/ ^(cocher "Add to PATH"^).
  pause
  exit /b 1
)

%PY% tools\pc\serveur.py web Partitions
pause
