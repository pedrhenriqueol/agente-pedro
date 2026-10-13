# System Design — diagnóstico e resiliência de inicialização

## 1. Contexto e problema

- Em Windows, o usuário recompilou com `npm run tauri build` e abriu `src-tauri/target/release/agente-pedro.exe`: aparece “Preparando seu espaço”, a janela desaparece e Alt+Space não abre o painel.
- O release usa `windows_subsystem = "windows"`, sem console. Erros de construção e panics do setup/event loop não deixam diagnóstico visível.
- Diagnóstico físico fornecido pelo usuário/Antigravity: encerramento em aproximadamente 1.140 ms, código `3221226505 / 0xC0000409`, panic do thread principal: `state() called before manage() for agente_pedro_lib::desktop_integration::DesktopMenuState`.
- Causa confirmada: Tauri cria as três WebViews antes de executar `.setup`; Wry/WebView2 aguarda COM com um pump de mensagens Windows. O frontend de uma janela já criada pode invocar `configure_desktop_menu` durante a criação das seguintes. O estado do menu era registrado somente dentro de `desktop_integration::init`, depois dessa janela de corrida.
- Restrições: APIs públicas, offline, banco/arquivos existentes preservados, sem alteração do Shell, sem dependências novas.

## 2. Arquitetura atual vs proposta

- Atual: `.run().expect(...)`; integrações opcionais de menus propagam `Err` para o setup. SQL preload abre banco antes das janelas, fora do tratamento de erro/retry do frontend.
- Implementação: `DesktopMenuState::default()` e `TaskbarState::default()` registrados no Builder, antes das WebViews. Itens do menu são opcionais no início; preferências recebidas são guardadas e reaplicadas quando os itens ficam prontos. `.setup` não substitui nem reinicializa esses estados.
- `sync_menu` guarda preferências e despacha aplicação ao thread principal, que lê o valor mais recente. Handles/preferências são copiados sob mutex e o lock é liberado antes das APIs nativas, evitando deadlock e reset por comando antigo.
- Logger local antes de construir Tauri, panic hook persistente, alerta nativo em erro fatal, registro dos estágios de criação/carregamento/saída. Integração desktop degrada sem abortar e comandos usam `try_state` de forma resiliente. SQLite abre pelo `Database.load` já existente, permitindo erro recuperável na interface; isso complementa a resiliência da inicialização.
- Componentes: `diagnostics.rs`, `lib.rs`, `desktop_integration.rs`, `tauri.conf.json`, serviço de diagnóstico frontend e `App.tsx`.

## 3. Dados e IPC

- Novo comando `startup_status`: enum de estágio, mensagem opcional limitada, label obtido da janela chamadora. Marcadores carregando/pronto/falhou; mensagens não incluem snapshots ou registros de tarefas/finanças.
- Logs: `%LOCALAPPDATA%/com.pedro.agente-pedro/logs/startup.log`, fallback `%TEMP%/agente-pedro/logs/startup.log`, arquivo anterior limitado. PID, modo de build, versão, executável, eventos e erro; sem telemetria externa.
- Nome, localização e schema SQLite inalterados. Remover preload não apaga dados; `Database.load('sqlite:agente_pedro.db')` continua usando o mesmo plugin/pool.

## 4. Riscos e mitigação

- Janelas island/dock continuam sem foco nativo. Alerta de falha aparece somente por erro; não ativar widgets em atualizações.
- Integrações opcionais parcialmente instaladas exigem `try_state` nos comandos para evitar novo panic.
- Hook Rust não captura access violation/abort nativo fora de Rust; nesse caso usar ExitCode e Application Error do Windows.
- Escrita do diagnóstico é best effort, com limite e fallback; indisponibilidade de log não impede funcionamento.
- Rollback: reverter esta mudança não exige migration ou limpeza de arquivos de dados.

## 5. Validação

- [x] `npm test`: 72 aprovados, zero falhas/pulados. Diagnóstico indisponível não bloqueia boot; preview não invoca logger; causas e tamanho/ciclos são tratados.
- [x] `npm run build`: TypeScript/Vite aprovados; aviso de import estático/dinâmico de eventos já existente.
- [x] Logger: seis testes std executados no host (fallback, Unicode/sanitização, rotação, concorrência). Compilação isolada do módulo apresenta avisos de funções de integração não usadas; build completo não apresenta esses avisos.
- [x] `cargo check --locked --target x86_64-pc-windows-gnu --tests`: aprovado sem warnings, incluindo comando IPC, estado pré-gerenciado e MessageBoxW. Não equivale à execução gráfica do release.
- [x] Chromium com fronteira nativa simulada: falha de SQLite mantém erro/retry visível no painel e na ilha; registra causa de permissão; retry chega a ready; zero erros JavaScript não tratados.
- [x] Revisão independente: Builder registra estados antes de qualquer janela; preferências iniciais não são sobrescritas; locks liberados antes de operações nativas; serviços de mídia/visibilidade seguem independentes.
- [x] Executável corrigido físico: usuário confirmou “App rodando agora” após a entrega `4e9b13a`. Abertura validada pelo relato; ajustes de retorno híbrido e área do dock foram registrados em [SYSTEM_DESIGN_WIDGET_RECOVERY.md](SYSTEM_DESIGN_WIDGET_RECOVERY.md). Este ambiente Linux não executa WebView2.

## 6. Revalidação Windows

Na raiz do repositório:

```powershell
git pull origin main
npm run tauri build
& .\src-tauri\target\release\agente-pedro.exe
```

`tauri build` já executa `npm run build` via `beforeBuildCommand`. Abrir o exe recompilado; o painel é acessível por Alt+Space ou pelo ícone da bandeja. Para mostrar explicitamente o painel na primeira execução, usar `& .\src-tauri\target\release\agente-pedro.exe --page home`.

Se uma falha persistir, coletar `startup.log` em `%LOCALAPPDATA%\com.pedro.agente-pedro\logs` (fallback `%TEMP%\agente-pedro\logs`). `process-start` distingue perfil/versão/caminho; `setup_ready`, `frontend_ready` e `panic` identificam a etapa. Access violations fora do Rust exigem também ExitCode e evento Application Error do Windows. Não apagar banco/preferências para investigar.
