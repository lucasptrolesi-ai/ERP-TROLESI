@echo off
cd /d "%~dp0"
node agent.js >> agente.log 2>&1
