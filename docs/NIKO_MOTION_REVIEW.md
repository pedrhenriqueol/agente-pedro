# Revisão do movimento do Niko e implementação original do Pedro

Consulta realizada em 14/10/2026 no commit
[`47dbfecacf40eb5f4fb0604324b35440682df797`](https://github.com/vitorcgo/Niko/tree/47dbfecacf40eb5f4fb0604324b35440682df797).
Os links abaixo fixam esse commit; alterações posteriores do Niko não mudam
as evidências desta revisão. A investigação é estática: leitura de dependências,
componentes, estilos e coordenação das janelas. O Niko não foi executado aqui.

## Biblioteca e possível template

O Niko declara `motion ^13.5.0`, React, Lucide e CSS próprios.
[Dependências](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/package.json#L25-L56).
Os componentes de presença importam `motion/react`; os controles básicos,
seletores e modais são implementados no próprio repositório.
[Componentes básicos](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/componentes/basicos.tsx#L1-L24).

A busca em dependências, imports e componentes examinados não encontrou um
template pronto de animações, shadcn, Radix ou MUI. Isso descreve o código
disponível, sem provar quais referências ou templates o autor possa ter usado
antes. Também não foi encontrado `layoutId` nas fontes examinadas: a continuidade
do personagem usa geometria medida, e vários outros efeitos usam CSS ou Motion.

Three.js e React Three Fiber atendem o escritório 3D. O `Canvas` desse módulo
usa renderização sob demanda; não é o motor dos menus ou da ilha.
[Cena 3D](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/modulos/escritorio/Cena3D.tsx#L815-L825).

## O que produz a continuidade visual

### Ilha: uma superfície e camadas separadas

O tamanho depende do estado e da visão ativa. Largura, altura e raios inferiores
recebem o mesmo alvo; crescimento usa mola e redução usa uma curva de saída.
No código consultado, a mola declara duração visual de 500 ms e rebote de 0,2;
o fechamento declara 340 ms.
[Perfis](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/Ilha.tsx#L110-L111),
[alvos e escolha do perfil](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/Ilha.tsx#L376-L387),
[superfície animada](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/Ilha.tsx#L586-L592).

O conteúdo fica dentro de um recorte com borda herdada. A troca entre compacto
e expandido usa `AnimatePresence` com `popLayout`; a entrada combina opacidade,
escala e blur, com atraso de 160 ms e duração de 300 ms. Esses números explicam
uma coreografia em etapas, e não apenas um fade instantâneo.
[Recorte](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/ilha.css#L64-L69),
[presença dos estados](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/Ilha.tsx#L602-L646).

A ocultação da raiz tem perfil próprio, com deslocamento para cima e opacidade.
O hover da cápsula espera 280 ms antes de abrir; o fechamento automático se
interrompe enquanto há interação, fixação ou edição de campos.
[Visibilidade](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/animacoes/visibilidade.ts#L1-L5),
[hover](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/Ilha.tsx#L623-L627),
[fechamento](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/Ilha.tsx#L291-L317).

### Menus: origem, direção e saída curta

O popup de aparência nasce no canto superior esquerdo, com deslocamento pequeno,
escala e opacidade. A entrada usa mola de duração visual de 280 ms e pouco
rebote; a saída termina em 120 ms. A origem da transformação acompanha o canto
do menu. A barra superior tem sua própria revelação vertical.
[Popup](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/barra/Personalizacao.tsx#L110-L119),
[origem](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/barra/barra.css#L809-L815),
[barra](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/barra/BarraDoTopo.tsx#L233-L243).

As visões da ilha usam presença com `mode="wait"`, mantendo a superfície externa
enquanto o conteúdo sai e entra. A passagem de grade para detalhe de conexão
tem direção lateral; os pequenos cartões entram em sequência e respondem
localmente ao hover e à pressão.
[Troca de visão](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/Ilha.tsx#L786-L797),
[grade, microinterações e detalhe](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/Visoes.tsx#L529-L600).

No painel, a entrada da página é um fade com deslocamento vertical de 6 px em
320 ms. O indicador lateral tem uma sequência própria de contração, trajetória
e expansão. O modal anima fundo e superfície separadamente e trata foco,
Escape e navegação por Tab.
[Página](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/estilos/estilo-sistema.css#L248-L259),
[indicador lateral](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/sistema/BarraLateral.tsx#L85-L117),
[modal e foco](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/componentes/basicos.tsx#L181-L253).

### Mascote: identidade que permanece entre estados

O personagem contínuo fica fora do conteúdo que é trocado. Espaços reservados
indicam seus destinos; posição e escala usam molas. A primeira apresentação e
o movimento reduzido chegam diretamente ao destino. O acompanhamento por
quadro é limitado durante a mudança; a ocultação interrompe as molas, e os
observadores são limpos ao encerrar o efeito.
[Personagem contínuo](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/animacoes/PersonagemContinuo.tsx#L16-L105).

As reações adicionais incluem expressão, compressão ao clicar, hover prolongado
e olhar limitado à proximidade do cursor. A atividade considera visibilidade e
preferência por movimento reduzido.
[Reações e olhar](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/personagens/Personagem.tsx#L139-L220),
[preferências combinadas](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/janelas/ilha/animacoes/usarMovimentoReduzido.ts#L1-L8).
Isso cria presença sem depender de trocar uma logo inteira a cada interação.

## Integração nativa e áreas que recebem cliques

A janela da ilha do Niko ocupa a largura do monitor. O frontend informa ao
backend os retângulos realmente interativos, recalculados quando estrutura,
estilos ou tamanho mudam. Um ciclo nativo consulta o cursor a cada 45 ms,
converte coordenadas pelo DPI e alterna a recepção de eventos da janela conforme
esses retângulos; fora deles emite um evento de saída.
[Dimensão da janela](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src-tauri/src/docks.rs#L102-L115),
[retângulos do frontend](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src/desktop/desktop.ts#L203-L249),
[ciclo e decisão nativa](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src-tauri/src/lib.rs#L194-L238),
[API usada no Windows](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/src-tauri/src/plataforma/windows/mod.rs#L65-L67).

Portanto, a transparência visual e `pointer-events` no CSS não explicam sozinhos
o funcionamento sobre outros aplicativos. Existe coordenação nativa específica.
Esta leitura não equivale a um teste físico do hit testing no Windows.

## Resultado original no Agente Pedro

O Pedro usa Motion **14.2.0**, instalada como biblioteca independente. Os
[perfis próprios](../src/lib/motionProfiles.ts) dão à superfície uma chegada
amortecida, sem rebote de geometria, e uma saída mais curta. Conteúdo, marcador,
popovers e modais compartilham esse vocabulário; os parâmetros e a coreografia
do Niko não foram transplantados.

| Aspecto | Implementação presente no Pedro | Diferença necessária |
|---|---|---|
| Superfície | Largura, altura e raios coordenados por Motion; reversões retomam o desenho atual. | A janela cresce antes do conteúdo e só encolhe após a geometria visual terminar; callbacks antigos são invalidados. |
| Áreas nativas | Ilha e controles dos cantos têm frames limitados e política própria de visibilidade. | O Pedro conserva sua arquitetura de janelas pequenas em vez de reproduzir a janela ampla do Niko. |
| Contextos e menus | Cabeçalho contínuo, marcador de aba e presença do conteúdo com direção. | Conteúdo de saída fica inerte; drafts e foco sobrevivem à navegação. Não se introduz uma espera vazia na fronteira com o frame nativo. |
| Painel e submenus | Páginas e categorias têm direção de navegação; disclosures coordenam altura e conteúdo. | As instâncias visitadas permanecem montadas. A animação WAAPI já segura foi preservada e recebe os perfis comuns. |
| Mascote | Uma capivara original acompanha os estados da ilha e reage brevemente à aproximação ou foco. | Piscar e pequenas expressões terminam em repouso; não há acompanhamento contínuo do cursor, sons automáticos ou reprodução dos personagens do Niko. |
| Acessibilidade | Preferência do aplicativo combinada à do sistema; interrupção e suspensão quando indisponível. | As principais transições desta entrega ficam abaixo de 300 ms, conforme o contrato do Pedro. |

Implementações relacionadas: [ilha](../src/components/DynamicIsland.tsx),
[popovers](../src/components/DesktopTopControls.tsx),
[capivara](../src/components/PedroMascot.tsx),
[páginas retidas](../src/components/ui/PageTransition.tsx),
[disclosures](../src/components/ui/AnimatedDisclosure.tsx) e
[modais](../src/components/ui/Dialog.tsx).

A revisão identifica mecanismos concretos, sem atribuir uma taxa de quadros ao
Niko ou prometer que usar a mesma biblioteca iguala a fluidez. O relatório da
entrega registra separadamente os testes do Pedro e os limites da validação em
Chromium frente ao WebView2 físico no Windows.

## Licenças e procedência

O repositório do Niko é público **para consulta**, e a licença desse commit não
concede uma licença de código aberto. Ela restringe copiar, adaptar e reaproveitar
código, personagens, sons, animações, design e textos em outros projetos.
[Licença consultada](https://github.com/vitorcgo/Niko/blob/47dbfecacf40eb5f4fb0604324b35440682df797/LICENSE.md#L7-L35).

Nenhum arquivo, código, personagem, som ou outro asset do Niko foi incorporado
nesta entrega. A capivara, paleta, componentes e coreografia são do Pedro. A
biblioteca Motion tem licença MIT própria, distinta da licença do aplicativo;
seu aviso está preservado em [MOTION-LICENSE.txt](licenses/MOTION-LICENSE.txt).
