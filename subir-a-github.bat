@echo off
chcp 65001 > nul
title Subir Economitin a GitHub
color 0A

echo ============================================================
echo         SUBIR ECONOMITIN A GITHUB AUTOMÁTICAMENTE
echo ============================================================
echo.
echo 1. Si no creaste el repositorio en GitHub:
echo    Entrá a: https://github.com/new
echo    Poné el nombre "economitin" y dale a "Create repository".
echo.
echo 2. Copiá el enlace HTTPS que te da GitHub.
echo    (Ejemplo: https://github.com/tu-usuario/economitin.git)
echo.
echo ============================================================
echo.

set /p REPO_URL="Pegá acá la URL de tu repositorio de GitHub y tocá ENTER: "

if "%REPO_URL%"=="" (
    echo.
    echo ❌ No pegaste ninguna URL. Operación cancelada.
    echo.
    pause
    exit /b
)

echo.
echo 🚀 Conectando con tu repositorio...
git remote remove origin 2>nul
git remote add origin %REPO_URL%
git branch -M main

echo.
echo 📤 Subiendo archivos a GitHub...
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================================
    echo 🎉 ¡PROYECTO SUBIDO CON ÉXITO A GITHUB!
    echo Ya podés ir a tu cuenta de Render y conectar este repositorio.
    echo ============================================================
) else (
    echo.
    echo ⚠️ Si se abrió una ventana en tu navegador pidiendo autorizar GitHub,
    echo dale a "Sign in with your browser" para completar la subida.
)

echo.
pause
