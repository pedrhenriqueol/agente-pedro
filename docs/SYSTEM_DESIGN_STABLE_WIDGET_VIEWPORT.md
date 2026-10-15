# Viewport estável e região nativa dos widgets — 15/10/2026

## Problema confirmado pelo usuário

A piscada anterior à animação persiste no Windows depois da barreira de dois
RAFs e de `SWP_NOCOPYBITS`. O retorno do IPC e o viewport do renderer não são
um reconhecimento da apresentação pelo compositor.

Uma nova reprodução separou o movimento do HWND da atualização do viewport:
a ilha central se deslocou temporariamente 232 px e a cápsula direita 214 px,
antes de normalizarem. O fixture anterior movia e redimensionava o iframe no
mesmo frame CSS e, portanto, não cobria esse intervalo. A reprodução comprova
o mecanismo em simulação, sem provar a apresentação física da máquina Windows.

## Decisão antes da implementação

Eliminar resize e deslocamento do HWND durante abertura/recolhimento comum.
Reservar um viewport máximo por widget, limitado à área útil e ao DPI:

- Ilha central: até 664 × 424 px lógicos, ancorada no centro.
- Esquerda: até 384 × 424, ancorada à esquerda.
- Direita: até 304 × 424, ancorada à direita.

Uma região Win32 (`SetWindowRgn`) delimita o footprint atual dentro dessa
reserva. Ela recorta desenho **e hit testing nativo**: a área externa não pode
se transformar num alvo transparente que bloqueie o desktop. A margem de
sombra atual continua incluída. Expansão amplia a região antes da animação;
recolhimento a reduz depois de terminar. Monitor/DPI/área útil podem atualizar
a reserva; uma abertura normal não o faz. Não criar janela extra, manipular
o Shell, roubar foco ou usar hide/show para disfarçar o clique.

## Contrato e compatibilidade

Os campos `width` e `height` dos comandos existentes continuam descrevendo
o footprint aplicado. Um campo opcional `viewport` confirma as dimensões da
reserva. A barreira do frontend confirma `viewport ?? resposta`, preservando
compatibilidade com backends anteriores e fixtures. Limites e recuperação
visual usam o footprint; não podem preencher toda a reserva numa falha.

O worker híbrido e a interação nos cantos precisam consultar os bounds
efetivos da região, em vez do retângulo reservado do HWND. Isso preserva
proximidade, retorno no topo e fullscreen. Desativação continua usando hide e
click-through nativos. Operações ocorrem sem locks de política atravessando
chamadas Win32 capazes de reentrar no event loop.

A revisão identificou um caso adicional de DPI: o Tao escala a janela sem
reescalar automaticamente o HRGN. Guardar o último footprint lógico dos três
widgets em estado efêmero gerenciado no Builder, antes de criar as WebViews,
permite reaplicar a reserva/região no evento de escala. Usar `try_state`, locks
breves somente sobre os metadados; marcar a reaplicação no evento de escala
e drená-la em `RunEvent::MainEventsCleared`, após o ajuste final do Tao.
`run_on_main_thread` pode executar inline e não basta para adiamento ali.
Gerações invalidam trabalho antigo e impedem rollback/cursor/show obsoletos.
Não inferir o DPI anterior pela largura máxima: o monitor pode ter limitado
essa largura. Nenhum registro é salvo no banco.

## Recursos, falhas e reversão

O Windows assume o HRGN após `SetWindowRgn` bem-sucedido; em falha o chamador
libera o objeto. O mesmo frame/mesma região não precisa ser reaplicado.
Preparação inicial deve limitar a região antes da primeira exibição. Uma
falha não pode revelar a reserva inteira nem deixar uma região expandida
vazia: conservar footprint anterior ou esconder/liberar interação nativa.
Nenhuma mudança de dados, stores, SQL, atalhos globais ou reprodução.

## Verificação planejada

Testar políticas de região no host e compilar o crate Windows. Verificar
centro/direita/esquerda, DPI 100/125/150%, área útil reduzida, coordenadas
negativas, substituição/ownership da região, região compacta após fechar,
ocultação/fullscreen e recuperação de falhas. No browser, simular viewport
reservado, footprints independentes e atraso entre movimento e renderer;
amostrar desde pointerdown, reversões, hover, foco e redução de movimento.
Confirmar que abertura comum não move nem redimensiona o host.

Executar testes, build, checagem Windows, revisão de diff e registrar os
limites: clipping e cliques entre aplicativos, DWM/WebView2 e FPS físicos
continuam exigindo revalidação Windows.
