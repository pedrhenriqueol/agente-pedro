# Evolução visual do Agente Pedro

## Material e alcance

Comparação dos vídeos enviados pelo usuário:

- Niko atualizado: `explorer_zi6HDsmi7j.mp4`, 89,83 segundos.
- Agente Pedro: `explorer_y9JFKhyWjz.mp4`, 39,20 segundos.
- Ambos em 1920 × 1080, gravados a 30 quadros por segundo. Foram inspecionados quadros representativos e sequências próximas às transições. A taxa da gravação não comprova o FPS, a latência ou o consumo da aplicação.

Esta análise propõe uma evolução de design; os novos menus, materiais, transições e mudanças do dock descritos aqui ainda não foram implementados. O modo fixo/híbrido solicitado anteriormente é uma entrega separada. O vídeo do Pedro antecede esse modo.

## Diagnóstico

O Pedro já possui uma identidade coerente, bons componentes de formulário e funcionalidades reais. A próxima melhoria deve concentrar-se na continuidade dos estados e na quantidade de elementos que competem pela atenção no desktop.

O Niko organiza a experiência em níveis: resumo discreto, superfície contextual pequena e painel completo. Na ilha, tamanho, cabeçalho, conteúdo e ações mudam conservando uma âncora reconhecível. Esse princípio pode orientar o Pedro sem reproduzir personagens, cores características, composição ou recursos do Niko.

O Niko também apresenta muitos destinos no painel e vários ícones na toolbar. Portanto, substituir quatro botões por uma fila maior de ícones não resolveria a intenção de minimalismo do Pedro. Há ainda navegações do painel do Niko com quadros vazios; não devem servir como meta de transição.

## Evidências comparativas

Os tempos abaixo pertencem ao vídeo indicado, não ao relógio do Windows.

| Aspecto | Niko: observação | Pedro: observação | Consequência para a proposta |
| --- | --- | --- | --- |
| Desktop e navegação | 00:32–34: sidebar recolhe para ícones. 01:12–22: superfícies pequenas compartilham âncora e toolbar contextual. | 00:08: painel com sidebar, ilha superior, quatro atalhos flutuantes e barra nativa simultâneos. O dock repete destinos da sidebar. | Retirar a dependência do dock permanente; preservar navegação clara no painel e um acesso contextual no desktop. |
| Expansão | 00:35,6–36,0: recipiente cresce; conteúdo aparece e estabiliza depois. | 00:19,58–19,98: a expansão já anima, mas capa/título compactos desaparecem antes dos detalhes. Há um instante com recipiente quase vazio. | Preservar elementos da atividade durante a transformação. A capa e o título devem funcionar como continuidade visual. |
| Troca de atividade | 01:10,0–10,6: conteúdo anterior sai, cabeçalho permanece reconhecível, altura muda e novo conteúdo entra em etapas. | Aproximadamente 00:35,6: Música → Foco substitui o conteúdo imediatamente. | Separar saída, ajuste da superfície e entrada; manter a origem espacial da interação. |
| Troca de música | O novo vídeo do Niko não permite comparar esse mesmo fluxo com segurança. | 00:24,6–25,4 e repetidamente em 00:30–34: aparece “Sua próxima trilha começa aqui” entre faixas. | Distinguir atualização transitória de ausência confirmada. Melhorar o modelo de estados antes de aumentar a duração das animações. |
| Recolhimento | A superfície pequena do Niko conserva sua posição superior durante os estados observados. | 00:36,62–36,9: o timer aparece recortado e o compacto reaparece sobre conteúdo que ainda está saindo. | Encerrar a saída do conteúdo antes de reduzir sua área visível; coordenar o tamanho nativo com o tamanho visual. |
| Hierarquia contextual | 00:49: controles rápidos em popover; apenas a seleção ativa recebe destaque forte. | 00:20: música reúne abas, status, setas, capa, transporte, progresso, volume, link do painel e saldo financeiro. | A ilha de música deve priorizar faixa e reprodução. Volume e destinos secundários podem ser revelados sob demanda. Finanças não precisa ocupar esse contexto. |
| Personalização | 01:08 e 01:25,4: categorias, abas e controles contextualizados; tema, cor, opacidade, escala, monitor e repouso. | 00:05–18: ajustes disponíveis, mas concentrados em cards que exigem abrir a área completa. | Separar ajustes rápidos de configuração detalhada, com prévia fiel da ilha. |
| Material e contraste | Superfícies pequenas organizam texto e controles com separação perceptível do wallpaper. O vídeo não identifica o mecanismo de composição. | 00:20: wallpaper atravessa texto e controles pequenos da ilha, reduzindo contraste. | Aplicar uma base mais consistente; transparência configurável não deve comprometer leitura. CSS transparente não garante blur do desktop. |

## Causas verificáveis no Pedro

- `DynamicIsland.tsx` utiliza um estado binário de expansão e apresentações independentes para compacto e detalhes. A expansão nativa antecipada e o recolhimento nativo atrasado já evitam parte dos recortes; essa proteção deve ser mantida.
- `desktop.css` já contém altura de 280 ms, fades de 120/160 ms e atraso de 90 ms. O problema observado é a coordenação e a continuidade dos elementos, não a ausência de animações.
- `MusicPlayer.tsx` alterna diretamente entre sessão e estado vazio. O vídeo confirma o vazio temporário, mas não determina se sua origem é a sessão do Windows, a consulta nativa ou outra etapa. O diagnóstico exige registrar a sequência de eventos sem dados pessoais no Windows.
- `MainDashboard.tsx` remonta a área usando `key={page}` e oferece somente animação de entrada. Não há uma saída coordenada nem preservação do estado local de uma página desmontada.
- A sidebar, o dock e links no rodapé da ilha oferecem caminhos repetidos. A multiplicação de acessos aumenta a presença do aplicativo mesmo quando o usuário não está usando o painel.

## Direção de produto: uma presença discreta do Pedro

### Entrada no desktop

A ilha deve ser o resumo da atividade, com uma única entrada para as áreas. O dock atual pode continuar disponível como preferência, mas o padrão proposto para uma experiência discreta é deixá-lo desligado. A alteração do padrão precisa respeitar a preferência já salva; não esconder um dock explicitamente escolhido pelo usuário.

- Repouso: marca discreta e informação escolhida, sem quatro destinos permanentes.
- Música: capa pequena, faixa e estado de reprodução; ao interagir, transporte compacto.
- Foco: tempo, tarefa selecionada e estado; a música permanece acessível sem competir com o resumo principal.
- Menu ancorado: Hoje, Rotinas, Música, Finanças e Aparência. A área atual tem destaque; as demais não precisam ocupar a ilha o tempo inteiro.
- Configurações rápidas: modo fixo/híbrido, tema, destaque e volume. Opções menos usadas ficam no painel.
- Painel: navegação estável e recolhível, paleta `Ctrl+K`, formulários e operações completas.
- Bandeja do Windows: abertura do painel, modos de visibilidade, configurações e sair, sem obrigar o usuário a manter widgets visíveis.

O menu deve abrir por um botão visível e por teclado; clique direito e hover podem ser atalhos adicionais. Oferecer setas, Enter, Escape, Shift+F10, foco inicial e retorno de foco. Hover exclusivo prejudicaria descoberta, teclado e dispositivos de toque.

### Continuidade de música

A apresentação deve diferenciar `sem reprodução`, `reproduzindo`, `pausada`, `atualizando faixa` e `indisponível`.

Na troca transitória, manter brevemente a apresentação reconhecível da faixa anterior, sinalizar atualização e desabilitar comandos que apontem para uma sessão antiga. Quando os novos dados chegarem, fazer uma troca suave de capa e texto. Se a ausência for confirmada, apresentar o estado vazio verdadeiro. Um intervalo inicial de 500–800 ms pode ser prototipado; não deve esconder erros persistentes nem simular reprodução.

O fechamento do player, a mudança real de sessão e a recusa de um comando precisam continuar sendo apresentados corretamente. A transição visual não autoriza inventar identidade, título ou estado de áudio.

### Superfícies e hierarquia

Manter marca do Pedro, cores existentes, linguagem em português e tipografia apropriada ao Windows. Reduzir a quantidade de bordas e rótulos secundários no widget; usar uma ação principal por contexto.

No player pequeno, a ordem visual proposta é capa/título → reprodução → progresso. Volume, abrir painel e preferências ficam em uma segunda camada acessível. O saldo financeiro aparece quando o usuário escolhe Finanças, sem disputar atenção com a música.

As configurações podem ser organizadas em **Ilha**, **Navegação**, **Aparência** e **Acessibilidade**, com opções principais visíveis e opções avançadas expansíveis. A prévia deve refletir faixa/foco, opacidade, escala e comportamento escolhido. Não adicionar controles avançados que ainda não tenham implementação funcional.

## Motion design proposto

Os valores são pontos de partida para um protótipo, não medições do Niko nem garantias de desempenho.

| Interação | Sequência proposta | Faixa inicial |
| --- | --- | --- |
| Hover/pressionar | Realce discreto; escala mínima apenas no controle, sem mover o destino do clique. | 90–140 ms |
| Abrir menu | Origem no acionador; fade e deslocamento de 4–6 px; texto nítido no repouso. | 160–200 ms |
| Trocar conteúdo | Saída curta do conteúdo antigo, ajuste do recipiente, entrada do novo; preservar âncora/cabeçalho. | 180–240 ms |
| Compacto ↔ expandido | Capa/título persistem; recipiente transforma; controles entram em sequência. Recolher segue a ordem inversa. | 280–340 ms |
| Trocar capa/faixa | Crossfade, sem apagar a superfície inteira nem exibir onboarding durante uma atualização normal. | 140–200 ms |
| Ocultar/revelar | Intenção e prazo definidos; esconder remove também o alvo de clique. Revelar não rouba foco do aplicativo ativo. | Medir no Windows |

Modelar estados explícitos de apresentação — repouso, prévia, expandindo, expandida, trocando conteúdo, recolhendo e oculta — ajuda a cancelar transições antigas quando chegam novas intenções. Música e foco devem manter suas stores e temporizadores separados da apresentação; esconder a janela não reinicia atividades.

Para a janela nativa, preparar o frame maior antes da animação e reduzir somente depois da saída. Não redimensionar o HWND a cada quadro como requisito inicial: isso aumenta trabalho de composição e pode produzir tremulação. A superfície visual pode animar dentro de um frame preparado. Tratar cliques rápidos, mudança de faixa durante expansão e ocultação por tela cheia como interrupções válidas.

Manter `inert`, foco visível, Escape e retorno de foco existentes. Movimento reduzido deve remover deslocamentos e desfoques e reduzir as transições, conservando os mesmos estados e ações. Não depender de fontes minúsculas para obter minimalismo.

## Integração com o Windows e barra de tarefas

### Caminhos recomendados

| Recurso | Viabilidade e alcance | Decisão proposta |
| --- | --- | --- |
| Bandeja e menu do Pedro | Suportados pelo Windows/Tauri; afetam o próprio aplicativo. Ícone pode ser colocado no overflow pelo sistema. | Implementar como acesso complementar, mantendo teclado e painel. |
| Jump List | API oficial do Shell; atalhos no menu do próprio ícone. | Oferecer Rotinas, Música e Finanças sem botões flutuantes permanentes. |
| Botões na miniatura | `ITaskbarList3`; dependem do botão do próprio painel na taskbar. | Prototipar pausa/foco ou música, conforme contexto. |
| Progresso no ícone | `ITaskbarList3`; progresso do próprio aplicativo. | Indicador discreto de foco, sem piscadas contínuas. |
| Dock contextual | Janela própria Tauri. | Alternativa opcional, com revelação intencional e ocultação quando obstrui outra aplicação. |
| Reserva de espaço | AppBar documentada reduz a área útil de outros aplicativos. | Somente opção explícita para dock fixo; inadequada como padrão híbrido. |
| Mica/Acrylic | DWM oficial para as janelas do Pedro em Windows 11 build 22621+. | Protótipo nativo; fallback sólido em versões incompatíveis e em caso de desempenho ruim. |
| Tema/autohide da barra do Windows | Preferências globais do sistema. | Direcionar o usuário às configurações do Windows; preservar sua escolha. |
| Substituição visual da taskbar inteira | Não há contrato público equivalente para redesenhar o Explorer dessa forma. | Não recomendar nesta primeira evolução. |

O Pedro já usa `skipTaskbar` nos widgets e posicionamento pela área útil do monitor. Essa base respeita a barra do Windows. A evolução recomendada reduz os elementos próprios sobrepostos, em vez de retirar os acessos do sistema.

CSS `backdrop-filter` em uma WebView transparente não comprova blur do desktop. O caminho de material nativo deve ser selecionado por versão/capacidade do Windows. O pacote `window-vibrancy` usa DWM em builds recentes e outro mecanismo em versões antigas; não basta habilitar o efeito indiscriminadamente. A Microsoft recomenda `DwmSetWindowAttribute` em lugar de `SetWindowCompositionAttribute`.

### O alcance da técnica encontrada no Niko

A gravação mostra suas barras e widgets, mas não comprova o mecanismo nem a versão de código que produziu aquela interface. A consulta separada ao código público atual encontrou manipulação das janelas internas `Shell_TrayWnd` e `Shell_SecondaryTrayWnd`, ativação de autohide via `ABM_SETSTATE` e repetição de `ShowWindow(SW_HIDE)` a cada segundo.

Esse comportamento vai além de decorar o próprio aplicativo: altera a barra utilizada por todos os programas. A rotina de restauração consultada remove `ABS_AUTOHIDE` das flags originais, portanto pode desativar uma preferência de autohide que o usuário já possuía. Há uma consequência concreta de recuperação e preservação de configuração. Não foi encontrada injeção de código nessa parte; ela não deve ser atribuída ao Niko.

Para o Pedro, não recomendo ocultar a taskbar do Explorer, procurar suas janelas internas, reiniciar Explorer ou injetar componentes para obter o acabamento desejado. APIs documentadas do próprio ícone, materiais próprios e menus contextuais atendem melhor ao objetivo com alcance menor e compatibilidade mais clara.

## Ordem de implementação sugerida

1. **Continuidade de estados:** diagnosticar o vazio entre músicas; preservar capa/título; corrigir sobreposição e recorte ao recolher; tratar interrupções de animação.
2. **Navegação discreta:** menu único ancorado, configurações rápidas, bandeja e dock opcional; preservar atalhos acessíveis e preferências existentes.
3. **Personalização progressiva:** seções claras, prévia fiel, ajustes principais primeiro; escala e monitor somente com suporte nativo verificado.
4. **Materiais e integração nativa:** Mica/Acrylic suportados, fallback sólido, Jump List e progresso do próprio ícone; medir antes de prometer fluidez.

## Critérios para validar o protótipo

- Trocar música sem mostrar onboarding transitório nem enviar ações para uma sessão antiga.
- Capa/título reconhecíveis ao abrir/recolher; nenhum timer recortado, camada duplicada ou superfície vazia desnecessária.
- Interromper expansão com recolhimento/tela cheia sem reabrir por comando atrasado.
- Entrar no desktop com dock desligado e ainda conseguir descobrir painel, áreas e configurações por mouse e teclado.
- Testar temas sobre wallpapers claros, escuros e movimentados; o controle de opacidade não deve tornar o texto ilegível.
- Testar 100%, 125%, 150% e 200% de DPI, múltiplos monitores, barra lateral/superior e apps maximizados/F11.
- Medir frame time, CPU/RAM e custo de blur na máquina Windows de referência. Vídeo a 30 fps não substitui essas medições.
- Comparar movimento normal e reduzido; teclado não deve perder foco durante uma transformação.
- Confirmar que nenhuma proposta altera preferências globais da barra do Windows.

## Fontes técnicas

- [Taskbar Extensions](https://learn.microsoft.com/en-us/windows/win32/shell/taskbar-extensions)
- [ITaskbarList3](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-itaskbarlist3)
- [Application Desktop Toolbars](https://learn.microsoft.com/en-us/windows/win32/shell/application-desktop-toolbars)
- [ABM_SETSTATE](https://learn.microsoft.com/en-us/windows/win32/shell/abm-setstate)
- [DWM_SYSTEMBACKDROP_TYPE](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwm_systembackdrop_type)
- [SetWindowCompositionAttribute](https://learn.microsoft.com/en-us/windows/win32/dwm/setwindowcompositionattribute)
- [System Tray — Tauri 2](https://v2.tauri.app/learn/system-tray/)

Os textos Microsoft foram consultados no repositório oficial MicrosoftDocs quando o domínio publicado não estava acessível nesta máquina. A análise do Niko usa vídeos fornecidos pelo usuário e leitura de referência; sua licença atual declara o código público para consulta, com reutilização restrita. A implementação proposta para o Pedro deve permanecer independente.
