# Project Tracker — evolução desktop

## 1. Visão da fase

- **Objetivo:** executar o plano de continuidade, navegação discreta e integração segura do próprio Pedro ao Windows.
- **Status:** código concluído e verificado na nuvem; validação física do Windows pendente.

## 2. Funcionalidades

| ID | Funcionalidade | Prioridade | Dependências | Status | Aceite |
| --- | --- | --- | --- | --- | --- |
| F01 | Continuidade entre músicas | Alta | Store/player | Concluído | Prazo limitado, sessão real e testes de falha/fila |
| F02 | Ilha contínua e menu contextual | Alta | Apresentação/resize | Concluído | Teclado, reversões e recuperação de resize aprovados em IPC simulado |
| F03 | Páginas e sidebar preservadas | Alta | Navegação/Dialog | Concluído | Campos/scroll mantidos; modais inativos suspensos |
| F04 | Personalização progressiva | Média | Preferências | Concluído | Defaults compatíveis, categorias e prévia verificadas |
| F05 | Bandeja, Jump Lists e progresso | Média | Tauri/Windows | Implementado; QA Windows pendente | Checagem Windows aprovada; apenas próprio aplicativo, instância única |
| F06 | Material nativo com fallback | Média | DWM/WebView | Implementado; QA Windows pendente | Mica apenas no painel, API pública e caminho sólido |
| F07 | Cliques, menus, submenus e diálogos coreografados | Alta | Presença/WAAPI/resize existente | Concluído; QA Windows pendente | Interrupções sem flash, categorias preservadas, saída de modais e ilha sem corpo vazio |

## 3. Riscos e bloqueios

Validação gráfica nativa depende de máquina Windows. A nuvem permite compilar para Windows e testar interface/IPC simulados, sem comprovar WinRT, Shell ou FPS físicos.

## 4. Validações

- `npm test`: **68 aprovados**, sem falhas ou testes pulados.
- `npm run build`: TypeScript e bundle Vite aprovados.
- `cargo check --locked --target x86_64-pc-windows-gnu --tests`: aprovado, sem warnings. Três testes portáveis de política desktop também executados no host; os testes do crate Windows não foram executados neste Linux.
- Chromium: continuidade de mídia, categorias/persistência, navegação/formulários/modais, teclado, movimento reduzido local/sistema, mensagens extensas e recuperações de resize. Geometria capturada por quadro cabe nos frames nativos simulados, inclusive com resposta antiga após reabrir.
- Evidências finais em [DESIGN_REPORT_DESKTOP.md](DESIGN_REPORT_DESKTOP.md); roteiro Windows em [DESKTOP.md](DESKTOP.md).
- Refinamento baseado no vídeo atualizado: [DESIGN_REPORT_MOTION.md](DESIGN_REPORT_MOTION.md). Cliques com alvo estável, disclosures reversíveis, indicador persistente e trocas sem reset da opacidade; 59 amostras da ilha sem corpo vazio/recorte, seis reversões aprovadas.
- Commit de música: `cf65c73`; painel/integração: `46db1b2`; ilha: `f0802ef`.
- Base preservada: commit do usuário `79f071f`, incluindo AGENTS.md, skills e templates sem alterações nesta entrega. SQLite, esquema, cálculos monetários e armazenamento dos registros não foram modificados.
