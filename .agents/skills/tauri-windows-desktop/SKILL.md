---
name: tauri-windows-desktop
description: Especializacao em Tauri 2, Rust e integracao desktop Windows para o Agente Pedro. Utilize ao modificar criacao e gestao de janelas, transparencia, always-on-top, click-through, foco, atalhos globais, escala DPI, multiplos monitores, eventos nativos ou IPC.
---

# Tauri & Windows Desktop Integration

## Visao Geral
Esta skill orienta alteracoes no backend Rust (src-tauri) e na camada de integracao nativa do Windows no Agente Pedro.

## Arquivos Relevantes
- src-tauri/src/lib.rs: Setup do Tauri, comandos IPC, calculo de posicoes/DPI e registro de atalhos globais.
- src-tauri/src/media.rs: Integracao WinRT com GlobalSystemMediaTransportControlsSessionManager e Core Audio.
- src-tauri/tauri.conf.json: Definicao estatica de janelas (island, dock, main), permissoes e dimensoes.
- src/lib/desktop.ts: Wrappers no frontend para invocacao de comandos nativos.
- src/services/stateBridge.ts: Transporte de eventos inter-janelas.

## Regras Obrigatorias
1. **Nunca Roubar Foco:** As janelas island e dock devem ser instanciadas e manipuladas com focus: false e skipTaskbar: true. Nunca chame set_focus() na ilha durante redimensionamentos ou atualizacoes de estado.
2. **Click-through Nativo:** Nao confunda CSS pointer-events: none com transparencia de eventos no Windows. Janelas que precisam ser click-through exigem configuracao nativa.
3. **DPI e Area Util:** Monitores utilizam fatores de escala variaveis (100%, 125%, 150%). Ao posicionar widgets, consulte monitor.scale_factor() e monitor.work_area() para evitar cobrir a barra de tarefas do Windows.
4. **Preservar o Shell do Windows:** Nao modifique o registro do Windows, explorer.exe ou taskbar sem aprovacao explicita e plano de reversao.
5. **Atalhos Globais:** Alt+Space alterna exclusivamente o console principal (main). Novas combinacoes devem ser testadas contra atalhos de sistema do Windows.

## Procedimento de Implementacao
1. Identifique as APIs do Tauri 2 disponiveis antes de adicionar novas dependencias Rust.
2. Realize a menor alteracao possivel em src-tauri/src/lib.rs ou novos modulos nativos.
3. Execute cargo check no diretorio src-tauri para garantir compilacao limpa sem quebrar crates.
4. Valide que o fechamento ou minimizacao de uma janela nao derruba o ciclo de vida da aplicacao.

## Criterios de Sucesso & Validacao
- Janelas abrem nas coordenadas corretas e proporcionais ao monitor.
- A area de trabalho externa continua 100% interativa.
- Nenhum processo fantasma permanece em execucao apos o encerramento do app.
- Testes automatizados (npm test) e build frontend (npm run build) continuam passando.
