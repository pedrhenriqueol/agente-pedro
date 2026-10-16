# Legenda nativa atrás dos widgets — 15/10/2026

## Evidência e causa

O usuário confirmou que a piscada foi eliminada, mas enviou uma captura com
uma faixa azul clara, ícone e título `Agente Pedro - Volume` atrás do controle
direito. O mesmo acontece na central e esquerda. Esse título é o da janela
configurada no Tauri, sem equivalente no conteúdo HTML.

No Tao 0.37.1, `WindowFlags::to_window_styles` mantém `WS_CAPTION` nas janelas
top-level mesmo sem decoração (`window_state.rs:239–270`). A aparência sem
moldura depende de `WM_NCCALCSIZE` (`event_loop.rs:2074–2130`). A repintura
solicitada por `SetWindowRgn` expõe a legenda clássica que esses estilos ainda
permitem. Alterar cores ou opacidade no React não retira essa área nativa.

## Correção definida antes da implementação

Somente nos HWND `island`, `top-left` e `top-right`, instalar uma subclass
Win32 estática antes do primeiro recorte. Remover `WS_CAPTION | WS_THICKFRAME`
e somente bordas estendidas decorativas. Preservar todos os bits de foco,
visibilidade, transparência, cursor, composição, z-order e taskbar.

A subclass filtra `STYLESTRUCT.styleNew` em `WM_STYLECHANGING`: o Tao reescreve
os estilos completos em `WindowFlags::apply_diff`, inclusive ao alternar
click-through. Uma remoção pontual seria perdida nesse caminho. Encaminhar
os demais eventos por `DefSubclassProc` e remover a subclass em `WM_NCDESTROY`.
Sem heap ou novo estado Tauri. As APIs de subclass já existem nas dependências.
Declarar explicitamente `Win32_System_Threading` para conferir que a instalação
ocorre na thread criadora do HWND; essa feature já estava unificada pelo Tao,
sem introduzir crate ou versão novos.

Aplicar os estilos iniciais com verificação dos erros Win32; solicitar
`SWP_FRAMECHANGED` apenas quando necessário, preservando posição, tamanho,
foco e z-order. Conferir a geração após cada operação emissora de mensagens,
antes da mutação seguinte, para uma preparação antiga não sobrescrever flags
de uma solicitação mais recente. A preparação inicial acontece com o widget
oculto. Não mudar as dimensões da reserva, o HRGN, as curvas ou a sequência da animação; isso
preserva a correção que o usuário confirmou. A janela principal e o Shell
do Windows ficam fora do escopo.

## Verificação e limites

Testar máscaras idempotentes e preservação dos demais bits, inclusive flags
de click-through e composição. Incluir teste Windows com HWND oculto que
simule a reescrita de estilos, recorte e alternâncias, conferindo ausência
dos estilos decorativos e estabilidade de bounds. Executar no host as partes
portáteis, além de testes Node, build e checagem Windows com testes compilados.

Revisar lifecycle, encadeamento de subclass, thread da UI e mensagens
aninhadas. O Chromium não desenha a área não cliente do Win32; seus screenshots
não podem provar essa correção. A execução gráfica e o teste do HWND no
Windows serão separados dos resultados realmente executados neste Linux.

## Resultado

Implementado em `widget_chrome.rs`, com integração na preparação já protegida
por geração. Três políticas portáteis, 117 testes Node, build e checagem
Windows com testes compilados aprovados. Detalhes e roteiro físico em
[DESIGN_REPORT_WIDGET_CAPTION.md](DESIGN_REPORT_WIDGET_CAPTION.md).

## Complemento — contorno branco residual

Após o build no Windows 11 (26200, tema escuro), a faixa sumiu, mas um contorno
claro de 1 px permaneceu na borda do HRGN (fora da cápsula, na margem de
sombra) ao interagir. Remover estilos não basta, por dois caminhos nativos:

- O DWM do Windows 11 desenha borda clara em janelas top-level não layered.
  Ao interagir, `set_ignore_cursor_events(false)` retira `WS_EX_LAYERED` e a
  borda aparece. Os widgets não recebem modo escuro, logo ela é clara.
- Com HRGN, a renderização não cliente do DWM fica desligada; `WM_NCPAINT`,
  `WM_NCACTIVATE` e as mensagens uxtheme `WM_NCUAHDRAWCAPTION/FRAME` pintam a
  moldura clássica sobre as bordas do WebView.

Correção na mesma subclass: `DWMWA_BORDER_COLOR = DWMWA_COLOR_NONE` na
instalação; `WM_NCPAINT` e `WM_NCUAHDRAW*` retornam 0; `WM_NCACTIVATE` segue
para o Tao com `lParam = -1` (foco preservado, sem repintar a moldura).
Sem mudança em geometria, HRGN, curvas, CSS ou janela principal.
