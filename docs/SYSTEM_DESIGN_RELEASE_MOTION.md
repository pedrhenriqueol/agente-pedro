# Preparação e primeiro paint dos widgets — 15/10/2026

## Problema e evidência

No vídeo enviado pelo usuário (1920×1080, 30 fps), a cápsula direita muda de
x≈1836 para x≈1622 em 21,733 s, mantendo a largura. No quadro seguinte volta
ao canto e inicia o popup. O deslocamento de 214 px coincide com 304−90 px,
a diferença entre o frame expandido e o compacto dessa janela. Em 7,300 s,
a ilha central fica ausente por um quadro antes de expandir.

Tamanho e posição já são aplicados juntos com `SetWindowPos`. A esquerda não
muda de x; centro e direita mudam. O retorno do IPC confirma o HWND, sem
confirmar o viewport e a composição seguinte da WebView. Os testes anteriores
que aguardavam a expansão não detectavam esses primeiros quadros.

## Alteração proposta

1. Os comandos existentes de resize da ilha retornam largura e altura lógicas
   efetivamente aplicadas, após clamp e arredondamento por DPI. Nenhum comando
   novo, janela extra ou mudança de persistência.
2. Antes de iniciar a apresentação, o frontend confirma o viewport real e
   dois ciclos consecutivos de `requestAnimationFrame` com dimensões corretas.
   A espera é cancelável por geração, limitada por timeout e não revela uma
   solicitação obsoleta. Não é um reconhecimento do compositor físico.
   Documento oculto ainda válido aguarda retorno; se exceder o prazo, rejeita
   para recuperar o frame. Somente uma geração/intenção obsoleta cancela
   silenciosamente. Isso evita abandonar uma janela expandida e vazia.
3. Popups permanecem invisíveis e inertes durante essa preparação. A superfície
   central conserva sua pose atual até a preparação terminar. Reversões,
   recuperação de erro e shrink após conclusão visual permanecem válidos.
4. Em resize Windows, usar `SWP_NOCOPYBITS` para descartar a cópia automática
   de pixels do client antigo. Preservar `SWP_NOACTIVATE`, `SWP_NOZORDER`,
   `SWP_NOOWNERZORDER`, operação atômica e retorno rápido quando nada mudou.
   Não invalidar uma mudança somente de posição nem bloquear redraw.

## Fundamentação e limites

A [documentação Microsoft de SetWindowPos](https://github.com/MicrosoftDocs/sdk-api/blob/docs/sdk-api-src/content/winuser/nf-winuser-setwindowpos.md)
descreve a preservação/cópia do client sem `SWP_NOCOPYBITS`. A documentação de
[WM_NCCALCSIZE](https://github.com/MicrosoftDocs/win32/blob/docs/desktop-src/winmsg/wm-nccalcsize.md)
descreve preservação alinhada ao canto superior esquerdo quando o handler
retorna zero. Esse é o caminho sem decoração do Tao usado pelo aplicativo.
Wry atualiza os bounds do controller WebView2 em `WM_SIZE`; a renderização do
Chromium continua assíncrona.

A flag é uma defesa contra pixels antigos do HWND, não uma garantia sobre
todos os buffers GPU/filhos do WebView2. A correção visual física precisa ser
revalidada no Windows com abertura repetida, monitores/DPI e modo reduzido.
Não usar `DwmFlush`, sleeps na thread nativa, hide/show extra ou alteração do
Shell para tentar encobrir a falha.

## Verificação e recuperação

Testar retorno IPC antes do resize do renderer, atraso de 1/2/3 frames,
viewport limitado pelo monitor, cancelamento, timeout, falha de resize,
reabertura, teclado e movimento reduzido. Registrar desde pointerdown, sem
esperar 280 ms para iniciar a amostragem. Manter SQLite, atalhos globais,
foco de outra aplicação e desligamento sem área fantasma.

Executar `npm test`, build, cargo check Windows e Chromium com janelas de
tamanho real; separar limites DOM/IPC da apresentação de pixels no Windows.

## Resultado

Implementado nos comandos existentes, sem nova permissão nem dependência.
Verificação da entrega e limites físicos em
[DESIGN_REPORT_RELEASE_POLISH.md](DESIGN_REPORT_RELEASE_POLISH.md).

## Continuação após retorno do usuário

O usuário confirmou que a piscada persiste no Windows. Uma reprodução que
separa movimento do HWND e atualização do renderer mostra que a barreira
acima ocorre depois do intervalo problemático. A evolução em
[SYSTEM_DESIGN_STABLE_WIDGET_VIEWPORT.md](SYSTEM_DESIGN_STABLE_WIDGET_VIEWPORT.md)
remove o resize/movimento durante a abertura comum, usando viewport reservado
e recorte nativo. A barreira continua útil para inicialização e mudança de
monitor; não deve ser descrita isoladamente como solução física confirmada.
