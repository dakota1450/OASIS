@echo off
rem Build a clean Oasis.zip into dist\ and copy it into docs\download\ for GitHub Pages.
title Package Oasis
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package.ps1"
echo.
pause
