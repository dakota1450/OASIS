@echo off
rem Fully restart Oasis so a freshly updated version actually loads.
rem
rem Why this exists: "Launch Oasis" reuses an already-running server (it just opens
rem the window). Node reads server.js once at startup, so after an update the OLD
rem process keeps serving the OLD version until it is truly stopped. This stops
rem whatever is listening on Oasis's port (7777), waits, then launches fresh.
echo Restarting Oasis...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { (Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction Stop).OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } } catch {}"
rem give the OS a moment to release the port
powershell -NoProfile -Command "Start-Sleep -Milliseconds 800" >nul 2>&1
start "" wscript.exe "%~dp0Oasis.vbs"
