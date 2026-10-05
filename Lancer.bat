@echo off
chcp 65001 >nul
title Partoche and Friends
cd /d "%~dp0web"

rem Python : "python" ou le lanceur "py"
set PY=
where python >nul 2>nul && set PY=python
if not defined PY where py >nul 2>nul && set PY=py
if not defined PY (
  echo Python est introuvable. Installe-le depuis https://www.python.org/downloads/ ^(cocher "Add to PATH"^).
  pause
  exit /b 1
)

echo Partoche and Friends tourne sur http://localhost:53682
echo Ferme cette fenetre pour arreter.
start "" http://localhost:53682/
%PY% -m http.server 53682
pause
