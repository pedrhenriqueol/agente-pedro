# Agente Pedro

Aplicativo pessoal para Windows 10/11, com tarefas, hábitos, foco e finanças guardados no dispositivo. Feito com React, TypeScript e Tauri 2.

## O que está disponível

- **Hoje:** prioridades, hábitos do dia, sessões concluídas e resumo financeiro.
- **Rotinas e foco:** tarefas com prioridade, hábitos e Pomodoro de 25 minutos com pausa de 5 minutos. Painel e ilha compartilham seleção, tempo, pausa e conclusão da sessão.
- **Finanças:** contas, entradas, saídas, histórico e limites mensais por categoria. Valores são armazenados em centavos; registrar uma movimentação também atualiza o saldo.
- **Aparência:** temas claro, escuro ou do sistema, cor de destaque, movimento reduzido, conteúdo e opacidade da ilha, e visibilidade e opacidade do dock.
- **Desktop:** ilha expansível, dock de atalhos e painel. `Alt + Espaço` mostra ou oculta o painel; `Ctrl + K` abre a busca de áreas.

## Requisitos

Para interface, testes e preview: **Node.js 22.13 ou superior**, com npm. Recomendado: **Node.js 24 LTS**.

Para executar o desktop no Windows, também são necessários:

- **Rust 1.90 ou superior**, com Cargo e toolchain Windows MSVC.
- **Visual Studio Build Tools**, com a carga de trabalho de desenvolvimento desktop com C++ e Windows SDK.
- **Microsoft Edge WebView2 Runtime**.

Os requisitos nativos seguem a [documentação do Tauri para Windows](https://v2.tauri.app/start/prerequisites/#windows). Os scripts deste projeto não instalam esses programas.

## Começar

Na pasta do projeto:

```sh
npm ci
npm test
npm run build
```

No Windows, `install.cmd` faz as verificações de Node/npm e executa `npm ci` na pasta do próprio script. `setup.cmd` também verifica Rust/Cargo e a toolchain MSVC; `setup.cmd --preview` prepara apenas a interface.

### Preview no navegador

```sh
npm run dev
```

Abra `http://localhost:1420`. Para visualizar os widgets, use `http://localhost:1420/?window=island` ou `http://localhost:1420/?window=dock`.

O preview usa armazenamento local do navegador. Não cria janelas transparentes sobre o desktop nem executa os controles nativos do Windows. Seus dados de preview são separados dos dados SQLite do aplicativo instalado.

### Aplicativo desktop

```sh
npm run tauri dev
```

O Tauri inicia o servidor da interface e abre a ilha e o dock. Abra o painel por um atalho dos widgets ou por `Alt + Espaço`. Ocultar o painel mantém os widgets e a sessão de foco ativos.

## Dados e validação

O desktop mantém o banco `agente_pedro.db` no diretório local do aplicativo. A refatoração mantém o nome do banco e preserva os registros existentes; a inicialização do esquema é idempotente. O navegador mantém seu próprio armazenamento local, com o mesmo identificador de dados usado anteriormente. Não apague esses arquivos ou o armazenamento do navegador para atualizar a interface.

`npm test` cobre banco, persistência e sincronização entre janelas. `npm run build` verifica TypeScript e gera a interface. A compilação cruzada para Windows foi verificada; a execução nativa, o empacotamento e a instalação ainda precisam ser validados em Windows.

Veja o escopo e os limites desta entrega em [docs/REFATORACAO.md](docs/REFATORACAO.md).
