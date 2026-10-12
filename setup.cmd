@echo off
setlocal
if /i "%~1"=="--preview" (
  call "%~dp0install.cmd"
  exit /b
)
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale Node.js 22.13 ou superior e reabra o terminal.
  exit /b 1
)
where rustc >nul 2>&1
if errorlevel 1 (
  echo Rust nao foi encontrado. O desktop requer Rust 1.90 ou superior com a toolchain Windows MSVC.
  echo Para apenas visualizar no navegador, execute setup.cmd --preview.
  exit /b 1
)
where cargo >nul 2>&1
if errorlevel 1 (
  echo Cargo nao foi encontrado. Confira a instalacao do Rust.
  exit /b 1
)
for /f "tokens=2" %%V in ('rustc --version') do set "PEDRO_RUST_VERSION=%%V"
node -e "const parts = (process.env.PEDRO_RUST_VERSION || '').split('.').map(Number); process.exit(parts[0] > 1 || parts[0] === 1 && parts[1] >= 90 ? 0 : 1);"
if errorlevel 1 (
  echo O desktop requer Rust 1.90 ou superior. Atualize a toolchain antes de continuar.
  exit /b 1
)
rustc -vV | findstr /c:"pc-windows-msvc" >nul
if errorlevel 1 (
  echo Use uma toolchain Rust Windows MSVC para desenvolver o aplicativo desktop.
  exit /b 1
)
echo O desktop tambem requer Visual Studio Build Tools com C++ e Windows SDK, e Microsoft Edge WebView2.
echo Estes programas nao serao instalados por este script. Confira os requisitos no README.md.
call "%~dp0install.cmd"
exit /b %errorlevel%
