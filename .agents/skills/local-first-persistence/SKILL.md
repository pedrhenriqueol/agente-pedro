---
name: local-first-persistence
description: Garantia de integridade de dados e persistencia local-first no Agente Pedro. Utilize ao modificar schemas SQLite, queries, migrations, stores do Zustand, transacoes ou entidades financeiras.
---

# Local-First Persistence & Integridade SQLite

## Visao Geral
O Agente Pedro e um aplicativo 100% offline e local-first. O SQLite fisico (agente_pedro.db) executado sob o plugin nativo do Tauri e a fonte primordiais da verdade.

## Arquivos Relevantes
- src/database/schema.sql: DDL das tabelas (accounts, transactions, habits, habit_logs, tasks, focus_sessions).
- src/database/schema.ts: Scripts de criacao, indices e triggers de integridade.
- src/database/database.ts: Camada de abstracao e execucao de queries.
- src/database/browser.ts: Storage local em IndexedDB/localStorage para testes e fallback.
- src/stores/useFinanceStore.ts e useFocusStore.ts: Estado reativo sincronizado com o banco.

## Regras Obrigatorias
1. **Centavos Inteiros (No Floats):** Valores monetarios (amount, balance, budget) DEVEM ser armazenados como inteiros representando centavos. Exemplo: R$ 50,00 -> 5000.
2. **Triggers de Saldo Atomico:** O saldo das contas e atualizado atomicamente atraves de triggers no SQLite (trg_tx_insert_account, trg_tx_delete_account). Nunca recalcule saldos manualmente no frontend.
3. **Preservacao de Dados Existentes:** Nunca execute DROP TABLE ou recrie bancos silenciosamente para corrigir erros. Sempre escreva migrations compativeis.
4. **Chaves Estrangeiras e WAL:** O banco opera com PRAGMA foreign_keys = ON e PRAGMA journal_mode = WAL. Respeite constraints de integridade referencial.
5. **Nao Misturar Browser com Nativo:** Testes que validam o fallback web nao provam o funcionamento de triggers ou conexoes concorrentes do SQLite real.

## Checklist de Validacao
- [ ] Operacoes de insercao/remocao refletem no saldo imediatamente.
- [ ] Reiniciar o aplicativo preserva todas as sessoes de foco e transacoes.
- [ ] A suite de testes de banco (tests/db.test.mjs e tests/persistence.test.mjs) passa com 100% de sucesso.
