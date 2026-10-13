# Codex Workflow & Engenharia — Agente Pedro

Este guia define como agentes autonomos (como Codex e Antigravity) descobrem regras, invocam skills e aplicam templates para entregas consistentes no repositorio.

## 1. Contrato Permanente (AGENTS.md)
Na raiz do repositorio, o arquivo AGENTS.md e o ponto de entrada primordial. Ele define:
- As diretrizes inegociaveis do projeto (100% offline, local-first, Windows-native).
- A integridade das janelas (island, dock, main e futuro frame).
- As restricoes de dados (centavos inteiros no SQLite, sem recriar tabelas).

## 2. Descoberta e Invocacao de Skills
As skills estao estruturadas no padrao .agents/skills/<nome>/SKILL.md com YAML frontmatter valido.

| Skill | Gatilho de Uso | Exemplos de Tarefas |
|---|---|---|
| 	auri-windows-desktop | Modificacao em Rust, janelas, Tauri 2, IPC, DPI, atalhos globais | Adicionar suporte a hotkey, reposicionar dock no multi-monitor |
| eact-motion-design | Transicoes, expansao, colapso, timing de animacao e microinteracoes | Suavizar morph da Dynamic Island, animar hover do Dock |
| desktop-design-system | Tokens de cor, tipografia, bordas, componentes e layout | Refatorar cards da HomePage, ajustar contraste visual |
| isual-regression-qa | Validacao visual, z-index, prevencao de regressao e foco | Auditar mudancas de layout, validar click-through nativo |
| local-first-persistence | Schemas SQLite, transacoes, queries, triggers e Zustand stores | Adicionar parcelamentos, persistir novas configuracoes |

### Invocacao Multi-Skill
Para tarefas multidisciplinares, combine instrucoes complementares:
- **Exemplo 1 (Refinamento da Dynamic Island):** Use desktop-design-system + eact-motion-design + isual-regression-qa.
- **Exemplo 2 (Nova integracao de sistema):** Use 	auri-windows-desktop + isual-regression-qa.

## 3. Uso dos Templates de Engenharia
Localizados em docs/templates/:
1. DESIGN_REPORT.md: Preencher antes e depois de alteracoes significativas na interface.
2. SYSTEM_DESIGN.md: Obrigatorio antes de mudancas em comandos Rust, janelas nativas ou schemas de banco.
3. PROJECT_TRACKER.md: Registro de status e dependencias de sprints funcionais.
4. EXPERIMENT_ANALYSIS.md: Para testes A/B tecnicos (ex: comparar duas abordagens de animacao).

## 4. Checklist Obrigatorio antes de Concluir Tarefas
1. Executar 
pm test e garantir 100% de aprovacao.
2. Executar 
pm run build para garantir tipagem TypeScript valida e build do Vite.
3. Verificar integridade do backend com cargo check em src-tauri.
4. Verificar git status e git diff para garantir que arquivos de aplicacao nao foram corrompidos acidentalmente.
