# System Design — Agente Pedro

## 1. Contexto e Problema
- **Funcionalidade / Modulo:** [ex: Nova integracao nativa, IPC ou mudanca estrutural]
- **Problema a Resolver:** [Descricao clara]
- **Restricoes Arquiteturais:** [100% offline, local-first, Windows-native, preservacao de APIs Tauri]

## 2. Arquitetura Atual vs Proposta
- **Estado Atual:** [Como funciona hoje]
- **Arquitetura Proposta:** [Diagrama ou fluxo de componentes]
- **Componentes Afetados:** [Arquivos frontend e modulos Rust]

## 3. Fluxo de Dados e Eventos IPC
- **Comandos Rust (tauri::command):** [Novos comandos, parametros e tipos de retorno]
- **Eventos (listen / emit):** [Canais de sincronizacao entre janelas]
- **Impacto na Persistencia:** [Alteracoes em schema.sql, tabelas e triggers]

## 4. Analise de Riscos e Mitigacao
- **Risco de Foco / Shell:** [Avaliacao se afeta janelas externas ou explorer]
- **Risco de Concorrencia:** [Como lida com mensagens fora de ordem ou race conditions]
- **Estrategia de Rollback:** [Como reverter se houver instabilidade]

## 5. Estrategia de Testes
- [ ] Testes de unidade em Node (npm test)
- [ ] Checagem do compilador Rust (cargo check)
- [ ] Validacao fisica do executavel release no Windows
