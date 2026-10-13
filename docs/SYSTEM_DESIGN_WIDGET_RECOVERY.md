# System Design — revelação híbrida e dock desativado

## Contexto e evidência

O executável corrigido abriu no Windows do usuário. Ao testar, a ilha híbrida escondeu, mas o mouse perto do lugar anterior não a trouxe de volta. Ao desativar o dock, sua área continuou bloqueando cliques.

## Diagnóstico e proposta

- A revelação atual exige 600 ms em uma faixa de apenas 6 px de altura e 180 px de largura no centro da borda física do monitor. Essa área não acompanha toda a cápsula nem sua posição na área útil com barra superior. Ampliar para a região compacta onde a ilha aparece e proximidade, usando observação global do cursor, sem janela invisível de captura.
- Mostrar dock usa `ShowWindow(SW_SHOWNOACTIVATE)`, mas esconder usa Tauri `hide()`. Tao mantém flags de visibilidade; mudar o HWND diretamente não atualiza esse cache. Usar ON/OFF nativos no mesmo caminho, confirmar `IsWindowVisible`, tornar o HWND oculto click-through e restaurar interação somente ao mostrar.
- Requisições redundantes de island/main serão substituídas por um único proprietário: a WebView do dock. O estado nativo existe no Builder e guarda a intenção recebida antes de a janela estar pronta. Aplicação no thread principal com revisão impede que comandos antigos restaurem o dock.

## Fluxo e dados

- Cursor em região de revelação por aproximadamente 120 ms → pedido de mostrar compacto sem ativar foco. Polling nativo periódico considera DPI/monitor/área útil. Prazo de esconder permanece 3 s.
- Cursor herdado quando um aplicativo ocupa tela cheia precisa sair e retornar; após revelação intencional, interação mantém a ilha temporariamente mesmo sobre tela cheia.
- Dock mantém WebView/dados quando desligado, mas remove visibilidade e hit target nativos. Estado desejado e aplicação confirmada são separados; erros chegam ao caller e diagnóstico local.
- Nenhuma tabela, migration, preferência global do Windows, registro ou Explorer alterado.

## Riscos e validação

- Não usar CSS como garantia de click-through. Não chamar set_focus na ilha/dock.
- Região de revelação limita altura ao compacto, mesmo se a última apresentação estava expandida. Testar DPI 100/125/150/200%, origem negativa e barra superior.
- Testar ON/OFF rápido, pedidos durante setup, falha de hide/show, ocultação pendente e reinicialização com dock explicitamente habilitado/desabilitado.
- [x] 13 testes da política híbrida e cinco do dock executados no host a partir dos blocos reais portáveis; DPI/origem negativa/barra superior/compacto, retorno por proximidade, fullscreen, intenção precoce e pedidos antigos cobertos.
- [x] `npm test`: 76 aprovados, incluindo quatro cenários novos de fila de dock (coalescer, erros e retry); `npm run build` e cargo check Windows GNU com `--tests` aprovados.
- [x] Chromium com IPC simulado: três WebViews confirmaram que somente dock envia show/hide, última intenção false nas três preferências; ocultação híbrida conserva ID/deadline da sessão e expansão antiga não reabre ao revelar. 60 amostras de trocas de menus sem corpo vazio/recorte; seis reversões aprovadas. Sem erros JavaScript.
- [ ] Confirmar no Windows real o retorno por proximidade e clique na área do dock desligado.

O diagnóstico usa fontes Tauri/Tao do lockfile e as observações físicas do usuário. A nuvem compila as APIs Windows; confirmações de `IsWindowVisible`, click-through e foco físico exigem recompilar e testar o release nessa máquina. Dados SQLite e preferências existentes foram preservados.
