# Visibilidade da ilha

Em **Aparência → Ilha no desktop**, escolha:

- **Fixa:** permanece visível, mantendo o comportamento anterior.
- **Híbrida:** esconde após **3 segundos** com o mouse afastado e sem interação, ou quando outro aplicativo ocupa a tela/região da ilha. O prazo pode ser alterado para 5 ou 10 segundos.

O mouse sobre a ilha mantém a interação disponível. Uso do teclado e dos controles também renova o prazo. Uma sessão de foco ou música, sozinha, não mantém o widget sobre outras aplicações.

Para revelar uma ilha escondida, **aproxime o mouse do lugar onde a cápsula aparece, no topo**. Toda a largura compacta e uma proximidade de 12 pixels lógicos são reconhecidas; não é necessário acertar uma faixa fina da borda. A intenção dura 120 ms, observada a cada 80 ms: o retorno costuma ser decidido em 160–240 ms, antes do custo de aplicação no Windows. O prazo para esconder permanece 3 segundos.

Em tela cheia, essa aproximação deliberada revela temporariamente a ilha; afastar o mouse volta a permitir seu recolhimento. Um cursor já parado na região quando outro aplicativo fez a ilha se esconder precisa sair e voltar para revelar novamente. A região acompanha o monitor, DPI e a posição da ilha na área útil, inclusive com barra de tarefas no topo.

Ao esconder, a janela nativa é retirada da tela e deixa de interceptar cliques. Ao revelar, volta compacta e não toma o foco do aplicativo ativo. A região de aproximação é observada globalmente pelo cursor e não cria um HWND transparente para capturar cliques. Foco e música continuam em execução. Selecionar Fixa também restaura a ilha.

## Implementação e limites

O modo híbrido utiliza um worker Windows para observar cursor, janela em primeiro plano, limites do monitor e DPI. A detecção considera tela cheia e janelas maximizadas que cobrem a área da ilha, exclui as próprias janelas do Pedro e as janelas de desktop/barra de tarefas. Não altera a barra nativa do Windows nem as preferências globais do sistema.

`ShowWindow` oculta o HWND da ilha. A revelação usa `SW_SHOWNOACTIVATE`; a visibilidade real é confirmada com `IsWindowVisible`. Eventos `pedro:island-visibility` com revisão monotônica informam a interface. Mudanças atrasadas não devem reapresentar a ilha; a interface cancela expansão/recolhimento pendentes e o backend recusa expansão enquanto ela está escondida.

As preferências usam o armazenamento existente. Configurações antigas recebem Fixa e 3 segundos sem perder tema, opacidade ou demais escolhas. A aplicação configura o comportamento da ilha mesmo enquanto o banco ainda está abrindo.

No preview de navegador e fora do Windows, a ilha permanece visível; a escolha pode ser salva, mas o preview não observa nem oculta outras janelas do sistema.

Os testes automatizados verificam preferências, IPC, decisões de inatividade/revelação e geometria. Chromium verifica seleção, recuperação do compacto e cancelamento de expansão com IPC simulado. A checagem Windows GNU valida a integração Rust/Tauri; o comportamento real do cursor e das janelas requer teste no Windows.

## Conferência no Windows

1. Atualize o projeto, execute `npm ci` e `npm run tauri dev`.
2. Em Aparência, selecione Híbrida e 3 segundos. Afaste o mouse; confirme o desaparecimento e clique na aplicação que estava atrás da ilha.
3. Aproxime o mouse do lugar da cápsula no topo, incluindo seus lados, sem tocar exatamente a borda. Confirme retorno compacto, interaja e afaste o mouse novamente.
4. Maximize um navegador e teste também F11; confirme que a ilha se esconde sem interromper música ou foco. Aproxime novamente do lugar da ilha para usar um controle, depois deixe-a se esconder.
5. Alterne para Fixa e confirme a restauração. Revele sem mudar o aplicativo em primeiro plano.
6. Repita com diferentes DPI/monitores e janela expandida; não deve aparecer uma expansão antiga após recolher ou entrar em tela cheia.
