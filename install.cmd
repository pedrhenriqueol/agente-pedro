@echo off
setlocal
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao foi encontrado. Instale Node.js 22.13 ou superior e reabra o terminal.
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo npm nao foi encontrado. Confira a instalacao do Node.js.
  exit /b 1
)
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || major === 22 && minor >= 13 ? 0 : 1);"
if errorlevel 1 (
  echo Esta versao do Node.js e antiga. Use Node.js 22.13 ou superior; Node.js 24 LTS e recomendado.
  exit /b 1
)
pushd "%~dp0"
if errorlevel 1 exit /b 1
if not exist package-lock.json (
  echo package-lock.json nao foi encontrado nesta pasta. Confira o checkout do projeto.
  popd
  exit /b 1
)
call npm ci
set "PEDRO_INSTALL_EXIT=%errorlevel%"
popd
exit /b %PEDRO_INSTALL_EXIT%
