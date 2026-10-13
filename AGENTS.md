# AGENTS.md — Contrato Permanente de Engenharia do Agente Pedro

Este documento estabelece as diretrizes arquiteturais, restricoes operacionais e padroes de engenharia para qualquer agente ou desenvolvedor que atue no repositorio **Agente Pedro**.

---

## 1. Identidade e Arquitetura do Projeto

- **Nome:** Agente Pedro
- **Tipo:** Desktop Life OS, 100% local-first para Windows.
- **Ecossistema:** Tauri v2 (Rust backend) + React 19 + TypeScript + Vite + Tailwind CSS + Zustand + SQLite nativo (tauri-plugin-sql).
- **Independencia Operacional:** Nao depende de servicos em nuvem, servidores externos ou provedores de IA para suas funcionalidades principais (foco, tarefas, habitos, financas, player e interface).
- **Desktop Layer Multi-Janela:** O sistema opera com janelas Tauri coordenadas com responsabilidades isoladas:
  - island: Dynamic Island contextual, topo da tela, compacta/expandida, transparente, alwaysOnTop: true, skipTaskbar: true.
  - dock: Barra de atalhos e status na base da tela, transparente, alwaysOnTop: true, skipTaskbar: true.
  - main: Console e painel operacional com moldura customizada e navegacao completa (home, routine, finance, music, appearance).
  - Planejado: frame (ambientacao/moldura da area de trabalho com click-through nativo permanente).
- **Comunicacao Inter-Janelas:** Coordenada via Tauri Events nativos (listen/emit) com fallback resiliente para storage/canal local no preview (src/services/stateBridge.ts).

---

## 2. Preservacao de Funcionalidades Criticas

Nunca comprometer, quebrar ou regredir em tarefas futuras:
1. **Rotina & Pomodoro:** Sincronizacao de comandos remotos, deadlines e IDs de sessao sem concorrencia destrutiva de ticks (src/stores/useFocusStore.ts).
2. **Tarefas & Habitos:** Agendamento, streaks baseados em calendario local e persistencia transacional (src/components/RoutineModule.tsx).
3. **Financas:** Valores monetarios armazenados exclusivamente em centavos inteiros (INTEGER). Triggers de balanco atomico no SQLite (src/database/schema.sql).
4. **Midia Nativa:** Leitura da sessao do Windows via GlobalSystemMediaTransportControlsSessionManager e Core Audio sem scraping ou processos externos (src-tauri/src/media.rs, src/services/mediaClient.ts).
5. **Atalhos Globais:** Alt+Space para alternar o console principal.
6. **Inicializacao e Posicionamento:** Posicionamento dinamico baseado em DPI e area util (work_area) dos monitores (src-tauri/src/lib.rs).

---

## 3. Regras Especificas Windows / Tauri

- **Transparencia e Click-through:** Nao bloquear o desktop com janelas transparentes invisiveis. pointer-events: none no CSS nao garante click-through nativo na janela do sistema operacional.
- **Foco do Sistema:** Atualizacoes de estado e redimensionamentos da island e do dock **nunca devem roubar o foco** da janela ativa do usuario no Windows (focus: false).
- **Integridade do Shell do Windows:** Nao alterar explorer, registro do Windows, area de notificacao ou taskbar nativa sem planejamento, aprovacao expressa e estrategia de reversao.
- **DPI Scaling e Monitores Multiplos:** Todas as coordenadas nativas devem converter LogicalPosition/LogicalSize considerando o scale_factor do monitor atual.

---

## 4. Regras de Frontend e Motion Design

- **Identidade Visual:** Preservar a paleta industrial aprovada (#05070a, #0c0e14, #10b981).
- **Superficie Unica:** A Dynamic Island deve se comportar como uma superficie viva continua; evitar trocas abruptas de containers e recortes de layout.
- **Acessibilidade e Microinteracoes:** Respeitar prefers-reduced-motion. Animacoes devem ser interrompiveis e com duracao perceptual otimizada (< 300ms).
- **Isolamento de Estado:** Nao misturar logica transacional com componentes de apresentacao pura.

---

## 5. Regras de Dados e Persistencia Local-First

- **Centavos Inteiros:** Calculos de moeda jamais devem utilizar floats para persistencia. Use inteiros (cents).
- **SQLite como Fonte de Verdade:** No runtime desktop nativo, o SQLite fisico (agente_pedro.db) sob WAL mode e foreign keys e a fonte da verdade. O storage de browser e estritamente um fallback de desenvolvimento/testes.
- **Migrations Compativeis:** Novas tabelas e colunas devem preservar dados pre-existentes sem limpar ou recriar bancos silenciosamente.

---

## 6. Procedimento Padrao de Engenharia (Workflow)

Toda tarefa deve seguir as etapas obrigatorias:
1. **Inspecionar:** Ler arquivos reais, comandos Rust, schemas e testes relevantes.
2. **Entender:** Confirmar escopo e restricoes antes de escrever codigo.
3. **Definir Escopo:** Realizar a menor alteracao suficiente.
4. **Implementar:** Escrever codigo limpo, tipado e com tratamento de erro resiliente.
5. **Verificar & Testar:** Executar npm test, npm run build e verificar src-tauri.
6. **Validar Comportamento:** Confirmar que janelas nativas, foco e atalhos continuam operando.
7. **Revisar Diff:** Auditar git status e git diff antes de concluir.
8. **Relatar:** Reportar objetivamente alteracoes, evidencias e orientacoes de teste.

---

## 7. Mapeamento de Skills Especializadas

Consulte e aplique as skills modulares em .agents/skills/ conforme a natureza da tarefa:

| Categoria da Tarefa | Skill Recomendada | Caminho |
|---|---|---|
| Janelas nativas, atalhos, Tauri 2, Rust, Windows APIs | tauri-windows-desktop | .agents/skills/tauri-windows-desktop/SKILL.md |
| Transicoes da Island, animacoes, morphing, microinteracoes | react-motion-design | .agents/skills/react-motion-design/SKILL.md |
| Design tokens, layout, tipografia, superficies, densidade | desktop-design-system | .agents/skills/desktop-design-system/SKILL.md |
| QA visual, inspecao de regressao, testes de interrupcao | visual-regression-qa | .agents/skills/visual-regression-qa/SKILL.md |
| SQLite, migrations, triggers, dados monetarios, stores | local-first-persistence | .agents/skills/local-first-persistence/SKILL.md |

Consulte tambem a documentacao de fluxo e templates em docs/CODEX_WORKFLOW.md.
