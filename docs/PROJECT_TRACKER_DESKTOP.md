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
| F08 | Inicialização resiliente e diagnóstico local | Alta | Builder/estados nativos | Abertura confirmada pelo usuário | Corrida `DesktopMenuState` corrigida, estados pré-gerenciados e panic registrado |
| F09 | Revelação por proximidade e dock sem área fantasma | Alta | Cursor/HWND/controle serializado | Corrigido; revalidação Windows pendente | Região compacta completa, OFF nativo + click-through e último pedido confirmado |
| F10 | Hoje contextual e tarefa do foco na ilha | Alta | Rotina/persistência existentes | Implementado; QA Windows pendente | Criar/concluir tarefa, registrar hábito e selecionar tarefa sem abrir painel |
| F11 | Ilha mínima, hover, toolbar e player horizontal | Alta | Geometria variável/presença | Implementado; QA Windows pendente | Repouso96px, atividade280px, abertura480/560/640px e entrada/saída coordenadas |
| F12 | Agenda local e aparência contextual | Alta | Stores/preferências | Implementado; QA Windows pendente | Calendário por data real, cores, tamanho, opacidade e teclado |
| F13 | Controles nos cantos superiores | Alta | WebViews próprias/controller | Implementado; QA Windows pendente | Frames pequenos, popups medidos, desligamento nativo e hide conjunto |
| F14 | Ilha e menus imersivos com mascote contínuo | Alta | Motion/WAAPI, geometria e retenção existentes | Implementado; QA Windows pendente | Mola interrompível, frame reduzido após conclusão, marcador e direção, reações finitas e movimento reduzido |

## 3. Riscos e bloqueios

Validação gráfica nativa depende de máquina Windows. A nuvem permite compilar para Windows e testar interface/IPC simulados, sem comprovar WinRT, Shell ou FPS físicos.

## 4. Validações

- `npm test`: **76 aprovados**, sem falhas ou testes pulados.
- `npm run build`: TypeScript e bundle Vite aprovados.
- `cargo check --locked --target x86_64-pc-windows-gnu --tests`: aprovado, sem warnings. Três testes portáveis de política desktop também executados no host; os testes do crate Windows não foram executados neste Linux.
- Chromium: continuidade de mídia, categorias/persistência, navegação/formulários/modais, teclado, movimento reduzido local/sistema, mensagens extensas e recuperações de resize. Geometria capturada por quadro cabe nos frames nativos simulados, inclusive com resposta antiga após reabrir.
- Evidências finais em [DESIGN_REPORT_DESKTOP.md](DESIGN_REPORT_DESKTOP.md); roteiro Windows em [DESKTOP.md](DESKTOP.md).
- Refinamento baseado no vídeo atualizado: [DESIGN_REPORT_MOTION.md](DESIGN_REPORT_MOTION.md). Cliques com alvo estável, disclosures reversíveis, indicador persistente e trocas sem reset da opacidade; 59 amostras da ilha sem corpo vazio/recorte, seis reversões aprovadas.
- Correção de abertura: [SYSTEM_DESIGN_STARTUP.md](SYSTEM_DESIGN_STARTUP.md). Diagnóstico recebido: panic `state() called before manage()` e saída `0xC0000409`. A entrega teve 72 testes Node, seis testes do logger, build e cargo check Windows aprovados; o usuário confirmou a abertura do release corrigido.
- Retorno híbrido/dock: [SYSTEM_DESIGN_WIDGET_RECOVERY.md](SYSTEM_DESIGN_WIDGET_RECOVERY.md), 18 políticas Rust executadas no host e sincronia de três WebViews confirmada com IPC simulado. Conteúdo novo observado no vídeo atualizado: [DESIGN_REPORT_TODAY.md](DESIGN_REPORT_TODAY.md), tarefas/hábitos/contexto de foco funcionais.
- Commit da correção nativa de hover/dock: `f7044f8`. AGENTS.md, skills e templates do usuário seguem preservados.
- Commit de música: `cf65c73`; painel/integração: `46db1b2`; ilha: `f0802ef`.
- Base preservada: commit do usuário `79f071f`, incluindo AGENTS.md, skills e templates sem alterações nesta entrega. SQLite, esquema, cálculos monetários e armazenamento dos registros não foram modificados.

A reformulação de 2026-10-13 está descrita em [DESIGN_REPORT_ISLAND_REDESIGN.md](DESIGN_REPORT_ISLAND_REDESIGN.md) e [SYSTEM_DESIGN_ISLAND_REDESIGN.md](SYSTEM_DESIGN_ISLAND_REDESIGN.md). As contagens anteriores acima documentam suas entregas; a validação atual está no relatório da reformulação. As duas novas janelas são do Pedro e não alteram o Shell do Windows.

A correção de 2026-10-14 está em [DESIGN_REPORT_MOTION_STABILITY.md](DESIGN_REPORT_MOTION_STABILITY.md)
e [SYSTEM_DESIGN_MOTION_STABILITY.md](SYSTEM_DESIGN_MOTION_STABILITY.md): ciclo de preferências
entre cinco janelas reproduzido e eliminado, hover/reversões corrigidos e geometria nativa
atualizada atomicamente. Validação: 96 testes Node, 24 políticas Rust, build e cargo check
Windows; 568 amostras de hover sem recortes no Chromium. Validação física Windows pendente.

O refinamento de imersão de 2026-10-14 está em
[DESIGN_REPORT_IMMERSION.md](DESIGN_REPORT_IMMERSION.md). A consulta ao código do
Niko está em [NIKO_MOTION_REVIEW.md](NIKO_MOTION_REVIEW.md); nenhum código ou asset
proprietário foi reutilizado. Motion MIT, 96 testes aprovados, build e cargo check
Windows. Hover validado em 569 amostras sem recortes; estados, teclado, falhas,
reversões e menus dos cantos verificados no Chromium. [Prévia para baixar](previews/README.md).
