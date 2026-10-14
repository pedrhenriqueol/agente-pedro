# Motion e estabilidade entre janelas

## Contexto e evidência (14/10/2026)

Vídeos fornecidos: Pedro `explorer_8XVAweboNT.mp4` (92,67 s) e Niko
`explorer_zi6HDsmi7j.mp4` (89,83 s), ambos 1920×1080 / 30 fps.
Pedro: recolhimentos em ~1,9 s, ~5,7 s e ~11,2 s deixam a superfície vazia
antes de reduzir; mudanças de largura deslocam temporariamente o centro.
No trecho ~63–89 s o painel permanece desenhado, mas o cronômetro e os
ajustes deixam de atualizar normalmente. O vídeo sozinho não distingue
deadlock nativo, saturação de eventos ou falha do renderer.
Niko: ~35–46 s mostra abertura, troca de contexto e recolhimento; ~48–58 s
mostra popup lateral. A referência é continuidade espacial e coordenação
entre conteúdo e superfície, preservando a identidade do Pedro.

## Proposta antes da implementação

1. Preferências: impedir que receber `storage` regrave o mesmo armazenamento
   através do middleware persist. Com várias janelas e sliders, revisões
   antigas podem circular indefinidamente. Persistência explícita somente na
   origem, revisões monotônicas com desempate por emissor, recepção sem eco.
   Manter chave e formato `state` antigos; metadados opcionais no envelope.
2. Geometria: posição e tamanho num único `SetWindowPos` sem ativação para
   as janelas transparentes no Windows. Nunca modificar Explorer/taskbar.
3. Visibilidade: extrair intenção sob mutex, liberar antes de chamadas nativas
   potencialmente reentrantes, confirmar por geração depois. Nunca manter
   mutex de política durante ShowWindow, resize ou acesso ao WebView.
4. Motion: conteúdo acompanha a redução desde o início; toolbar entra após
   preparar espaço; preservar centro, conteúdo mensurável e reversões. Evitar
   reiniciar transição ao selecionar contexto já ativo e acumular snapshots.

## IPC, persistência e compatibilidade

Comandos de geometria e visibilidade mantêm seus nomes e contratos. Eventos
de preferências ganham revisão opcional, com leitura dos dados antigos.
Nenhuma migração SQLite, alteração de finanças, hábitos ou sessões de foco.
As filas e gerações continuam a impedir respostas tardias de reabrir widgets.

## Riscos e validação

Testar slider em cinco stores/janelas com entrega atrasada/duplicada/invertida,
interrupções de abertura, troca de contexto, recolhimento e reabertura durante
IPC; foco de teclado e movimento reduzido. Executar npm test, build e cargo
check Windows. Chromium verifica o React e a geometria simulada, mas não
comprova foco, pintura ou hit-testing do HWND: validar o release no Windows.
Rollback por revert do commit; preferências antigas permanecem legíveis.
