# Navegação e integração desktop

A ilha conserva a atividade no cabeçalho ao expandir ou recolher. Use o botão de menu, clique direito ou `Shift + F10` para abrir as áreas. No menu, navegue com as setas, `Home`/`End` e `Enter`; `Escape` retorna ao acionador. Ajustes rápidos reúnem visibilidade, tema e volume do Windows. As opções completas ficam em Aparência.

O dock é uma alternativa opcional em **Aparência → Navegação**. Instalações novas começam sem os quatro atalhos flutuantes; um valor explicitamente salvo continua sendo respeitado. A sidebar do painel pode ser recolhida para ícones com nomes acessíveis. Trocar de área conserva formulários e posição de rolagem; modais de páginas inativas deixam de prender o teclado.

## Acessos do Windows

- **Bandeja:** duplo clique abre o painel; clique direito oferece áreas, modo fixo/híbrido, dock e saída do aplicativo. O Windows pode colocar o ícone no overflow da bandeja.
- **Jump List:** no menu do próprio ícone do Pedro, atalhos de Rotinas, Música e Finanças. É configurada por builds release; `tauri dev` preserva os destinos da versão instalada. Políticas do Windows podem impedir sua disponibilidade.
- **Instância única:** abrir outro atalho encaminha a área ao processo existente, sem criar outro worker de mídia ou banco concorrente. Uma abertura fria conserva o destino até o frontend estar pronto.
- **Foco:** o botão do painel na taskbar mostra progresso da sessão, amarelo quando pausada. Pausas de descanso e sessões encerradas retiram esse indicador; widgets continuam fora da taskbar.
- **Atalhos:** `Alt + Espaço` alterna o painel e `Ctrl + K` abre a paleta de áreas. Mostrar/atualizar ilha e dock não solicita foco nativo.

Ocultar o painel mantém as atividades em andamento. Para encerrar o processo, use **Sair do Pedro** na bandeja.

## Material do painel

Em **Aparência → Aparência**, escolha material do sistema ou superfície sólida. O caminho nativo solicita Mica pelo `DwmSetWindowAttribute` documentado, em Windows 11 compatível, e só expõe transparência após confirmação. Versões sem suporte ou falhas mantêm uma base sólida. O próprio Windows pode suprimir efeitos conforme acessibilidade, energia e configuração de transparência.

Ilha e dock usam suas superfícies CSS e margens transparentes. Aplicar um backdrop a todo o HWND desses widgets criaria um retângulo sobre o desktop durante a expansão; por isso, o material nativo está limitado ao painel. Texto, capas e controles não herdam a opacidade da superfície.

Nenhuma preferência global de autohide, registro, janela interna do Explorer ou área útil do desktop é modificada. Reverter material/dock/sidebar nas preferências não exige alterar o banco.

## Conferência em Windows real

Execute `npm ci`, `npm test`, `npm run build` e `npm run tauri dev` com os requisitos do README. Para Jump Lists, valide também uma instalação gerada por `npm run tauri build`.

Confira música no SoundCloud, atualização entre faixas, menu por teclado, foco de outro aplicativo durante expansão, ocultação híbrida e reativação pela borda superior. Teste DPI de 100/125/150/200%, monitores distintos, aplicativos maximizados/F11 e retorno do Explorer. No painel, valide Mica/sólido e progresso do foco em execução/pausa/encerramento.

A validação na nuvem cobre a interface Chromium, testes de dados/stores/IPC e checagem Rust para Windows. WinRT, Shell, WebView2, posicionamento físico e frame time dependem dessa conferência nativa.
