@echo off
chcp 65001 >nul
title Hotel SUNAT - demo
cd /d "%~dp0"

echo.
echo === Hotel SUNAT: preparando la demo ===
echo.

where node >nul 2>nul || (echo [FALTA] Node.js 22: instalalo desde https://nodejs.org y vuelve a ejecutar. & pause & exit /b 1)
where docker >nul 2>nul || (echo [FALTA] Docker Desktop: instalalo y abrelo, luego vuelve a ejecutar. & pause & exit /b 1)
docker info >nul 2>nul || (echo [FALTA] Docker Desktop esta instalado pero no esta abierto. Abrelo, espera a que diga "running" y vuelve a ejecutar. & pause & exit /b 1)
where pnpm >nul 2>nul || (echo Instalando pnpm... & call npm install -g pnpm@10)

if not exist "api\.env" copy "api\.env.example" "api\.env" >nul

if not exist ".demo-lista" (
  echo [1/2] Primera vez: instalando dependencias y creando la base de datos. Tarda unos minutos...
  call docker compose down -v >nul 2>nul
  call pnpm preparar || (echo Algo fallo en la preparacion. Revisa el mensaje de arriba y vuelve a ejecutar. & pause & exit /b 1)
  echo ok> .demo-lista
) else (
  echo [1/2] Levantando MySQL y Redis...
  call pnpm infra:up
)

echo [2/2] Iniciando API y web. Deja esta ventana abierta durante la demo.
echo        Usuario: admin   Clave: Hotel2026!
start "" cmd /c "timeout /t 12 >nul & start http://localhost:5173"
call pnpm dev
