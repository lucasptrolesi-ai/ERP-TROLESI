@echo off
cd /d "%~dp0"
python agent.py >> agente.log 2>&1
