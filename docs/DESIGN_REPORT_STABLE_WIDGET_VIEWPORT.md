# Piscada persistente antes da abertura — 15/10/2026

## Evidência e mudança de abordagem

O usuário confirmou que a piscada rápida continua no Windows após o ajuste
de primeiro paint. A barreira anterior coordena a animação com o viewport
do renderer, mas começa depois de uma operação que já pode ter movido o
HWND enquanto a textura anterior da WebView ainda é apresentada.

A nova reprodução separou essas etapas. Ao mover o host antes de atualizar
o viewport do iframe, a ilha central se desloca 232 px e a direita 214 px;
normalizam quando chega a largura correta. O fixture anterior aplicava as
duas mudanças juntas e não exercitava esse intervalo. Não é uma nova gravação
da máquina do usuário, mas uma reprodução controlada do mecanismo.

## Implementação

O [desenho técnico](SYSTEM_DESIGN_STABLE_WIDGET_VIEWPORT.md) conserva o
viewport e a origem do widget durante a abertura normal. A animação continua
na superfície existente. Um recorte Win32 delimita a região desenhada e a
área que recebe cliques, incluindo a margem de sombra já usada pelo app.
O espaço reservado fora dela não deve bloquear aplicativos no desktop.

A região aumenta antes de expandir e diminui após recolher. Centro e cantos
continuam com suas âncoras; o modo híbrido consulta a região efetiva para
proximidade e retorno. A inicialização prepara o recorte antes de exibir a
ilha. Reservas seguem área útil e DPI; o último footprint lógico permite
recalcular a região quando a escala muda. O estado correspondente é efêmero,
gerenciado antes da criação das WebViews.

O frontend distingue footprint e reserva, valida os dois e mantém suporte ao
contrato anterior. A barreira de viewport permanece para preparação inicial
e mudanças legítimas de monitor/escala. Falhas restauram região e reserva;
se a restauração falhar, a janela libera interação e é ocultada nativamente.
Não há mudança no Shell, banco, reprodução ou atalhos globais.

## Verificação

- **117 testes Node aprovados**, sem falhas ou testes pulados. Incluem contrato
  de reserva/footprint, geometria inválida, DPI fracionário e recuperação das
  filas sem reenviar metadados derivados ao backend.
- **Build TypeScript/Vite aprovado**; apenas o aviso já existente sobre o
  import estático/dinâmico de `@tauri-apps/api/event.js`.
- **Cargo check Windows GNU com `--locked --tests` aprovado**, sem warnings.
  O crate Windows e seus testes foram compilados, sem execução gráfica aqui.
- **12 testes Rust portáteis executados** sobre políticas reais de geometria,
  cantos, DPI/gerações e falhas; **9720 combinações independentes** de área,
  escala e âncora também verificadas.
- Reserva em produção: **13 cenários / 941 amostras**, com atrasos de 160 ms,
  reversões, redução de movimento, falhas e retorno ao footprint compacto.
  Host e viewport permanecem fixos em todas as amostras; desvio central máximo
  de 0,008 px. O fixture de desktop recebe cliques abaixo do recorte compacto.
- Compatibilidade: **cinco cenários / 304 amostras** do protocolo de resize
  anterior passaram, inclusive mudança real e atrasada do viewport e redução
  de movimento durante a abertura.
- Revisão independente conferiu ownership do HRGN, locks fora das APIs,
  início oculto, metadados efêmeros e cancelamento por geração. Encontrou e
  corrigiu também um rollback obsoleto que poderia restaurar uma solicitação
  anterior durante mensagens nativas aninhadas.

A reaplicação de escala é marcada em `ScaleFactorChanged` e drenada em
`MainEventsCleared`, depois do ajuste final do Tao. `run_on_main_thread`
isoladamente pode executar inline e não serviria como adiamento nesse ponto.
Uma solicitação mais recente invalida trabalho antigo; falha conserva os
metadados confirmados e uma tentativa de refresh não fica em loop.

Evidência estruturada:
[qa/STABLE_WIDGET_VIEWPORT_2026-10-15.json](qa/STABLE_WIDGET_VIEWPORT_2026-10-15.json).

## Revalidação física

O usuário confirmou posteriormente que a piscada foi corrigida. A captura
seguinte revelou uma legenda nativa atrás dos widgets, tratada separadamente
em [DESIGN_REPORT_WIDGET_CAPTION.md](DESIGN_REPORT_WIDGET_CAPTION.md),
preservando a preparação estável desta entrega.

Chromium e IPC simulados verificam estados, limites, âncoras e ordem das
operações. Não comprovam a composição DWM/WebView2 nem cliques entre processos
no Windows. A alteração elimina o resize/movimento comum que produziu o salto
na reprodução; o resultado visual físico ainda precisa ser conferido.

Recompilar o executável com `npm run tauri build` após atualizar a `main`.
Testar clique/hover repetidos na central e nos dois cantos, reversão rápida,
modo híbrido e retorno por proximidade. Com a ilha compacta, clicar também
nas áreas laterais e abaixo onde o conteúdo expandido apareceria. Repetir
em 100/125/150% e ao trocar de monitor, verificando recorte, retorno e foco.
Alt+Espaço deve continuar abrindo apenas o painel principal.
