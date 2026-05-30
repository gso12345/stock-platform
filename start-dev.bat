@echo off
REM 백엔드 (FastAPI)
start "Stock Backend" /min cmd /c "cd /d "C:\Users\azbyc\OneDrive\바탕 화면\stock-platform\backend" && .\venv\Scripts\uvicorn.exe app.main:app --port 8000 >> server_new.log 2>&1"

REM 1초 대기 후 프론트엔드 (Vite)
timeout /t 2 /nobreak > nul
start "Stock Frontend" /min cmd /c "cd /d "C:\Users\azbyc\OneDrive\바탕 화면\stock-platform\frontend" && npm run dev"
