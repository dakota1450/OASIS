@echo off
rem Build clean Oasis-Windows.zip + Oasis-macOS.zip into dist\ and copy both into docs\download\ for GitHub Pages.
title Package Oasis
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package.ps1"
echo.
pause
