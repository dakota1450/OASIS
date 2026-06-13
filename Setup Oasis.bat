@echo off
rem Oasis - run once after unzipping. Checks Node, makes a desktop shortcut, opens Oasis.
title Oasis Setup
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
