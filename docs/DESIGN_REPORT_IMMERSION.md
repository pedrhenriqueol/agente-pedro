# Ilha e menus imersivos — 14/10/2026

## Investigação e escopo

Consulta do Niko em `47dbfecacf40eb5f4fb0604324b35440682df797`.
O repositório usa React, CSS próprios e `motion/react` (`motion ^13.5.0`).
Não foi encontrado template de animações ou dependência shadcn/Radix/MUI.
Three.js atende um módulo 3D, não as transições da ilha e menus.

A licença atual permite leitura e restringe reutilização de código, personagens,
sons, animações e design. A implementação do Pedro é própria; nenhum arquivo
ou asset do Niko entra no produto. Motion é uma dependência separada sob MIT,
com aviso preservado em [licenses/MOTION-LICENSE.txt](licenses/MOTION-LICENSE.txt).
Análise de fonte e referências: [NIKO_MOTION_REVIEW.md](NIKO_MOTION_REVIEW.md).

## O que explica o movimento observado

- `src/janelas/ilha/Ilha.tsx`: dimensões e raios animados juntos; abertura e
  fechamento com perfis distintos; cabeçalho permanece entre contextos.
- `src/janelas/ilha/animacoes/PersonagemContinuo.tsx`: um personagem real
  acompanha destinos entre estados, evitando desaparecer/remontar.
- `src/janelas/ilha/barra/Personalizacao.tsx`: popup nasce perto do botão,
  com opacidade, deslocamento pequeno e escala; saída mais curta.
- `src/janelas/ilha/Visoes.tsx`: direção consistente entre lista e detalhe.
- `src/componentes/basicos.tsx`: presença do fundo independente do modal.

O Niko usa viewport amplo sobre o desktop com controle de áreas interativas.
No Pedro, mantivemos frames nativos limitados e a proteção contra cliques em
áreas invisíveis. Preparar o frame e animar a superfície são responsabilidades
distintas. Não se reproduzem parâmetros, sequências ou assets proprietários.

## Implementação original entregue

1. Movimento interrompível da superfície com chegada amortecida e fechamento
   mais curto. Só reduzir o frame nativo quando a geometria visual estiver pronta.
2. Cabeçalho com capivara contínua, marcador persistente da aba ativa e entrada
   discreta dos controles na abertura; não repetir entrada ao trocar contexto.
3. Corpo com direção entre contextos e sobreposição curta, preservando drafts,
   foco e controles; conteúdo de saída inerte.
4. Popovers dos cantos com origem visual no botão, preparação nativa preservada,
   saída que termina antes de reduzir a janela.
5. Presença visual do painel e menus com tokens comuns, reações localizadas e
   movimento suspenso quando não visível. Nada de sons automáticos ou módulo 3D.

Paleta industrial (#05070a, #0c0e14, #10b981) e mascote originais do Pedro. Preferência do aplicativo e
`prefers-reduced-motion` combinadas em todos os perfis. Tempo principal até
260 ms nos perfis definidos e nenhuma movimentação de geometria nativa por quadro.

| Superfície | Movimento implementado |
| --- | --- |
| Ilha | Abertura por mola de 260 ms, mudança de tamanho de 220 ms, fechamento de 200 ms; dimensões e raios coordenados |
| Cabeçalho | Capivara persistente entre compacto/expandido; indicador de contexto de 210 ms; controles entram uma vez ao abrir |
| Menu | Linhas entram em 150 ms, com sequência de 12 ms; navegação por teclado dispensa essa sequência |
| Cantos | Entrada de 240 ms e saída de 140 ms, com origem no botão; conteúdo anterior permanece inerte durante saída |
| Painel/submenus | Direção conforme ordem da navegação, entradas de 180 ms e saídas de 100 ms; instâncias, rascunhos e scroll mantidos |
| Disclosures/modais | Altura/conteúdo de 220 ms, fundo com duração independente; interrupção amostra o movimento já desenhado |
| Capivara | Piscar de 180 ms e pequeno aceno de 220 ms, apenas em interação; sem novo loop em repouso |

A redução nativa do frame não depende mais de um timer estimado de 280 ms:
aguarda o destino visual. O teste de conclusão usa dimensões de layout por
`getComputedStyle`, pois a animação de revelar a janela pode transformar seu
ancestral. A mesma conclusão funciona com movimento reduzido e destino sem
alteração. Ativar movimento reduzido interrompe a animação em curso.

`motion@14.2.0` foi adicionado com versão exata. O runtime fica em um chunk
estático próprio, disponível desde a montagem, sem carregamento tardio que
possa atrasar a primeira aproximação. Bundle principal: cerca de 468 kB (136 kB
gzip); Motion: 159 kB (54 kB gzip). O build mantém apenas o aviso prévio
do import misto de `@tauri-apps/api/event.js`.

## Evidências e limites

- `npm test`: 96 aprovados, zero falhas ou testes pulados.
- `npm run build`: TypeScript e Vite aprovados.
- `cargo check --locked --target x86_64-pc-windows-gnu --tests`: aprovado.
- Chromium, ilha: oito cenários de interação, três de falha/reversão nativa,
  quatro de teclado/identidade e três casos de continuidade/ativação de
  movimento reduzido durante crescimento aprovados.
- Hover em iframe cujo viewport realmente redimensiona: 569 amostras,
  zero recortes, erro máximo de centro de 0,008 px, nenhuma camada acumulando
  histórico e nenhum erro JavaScript.
- Cantos: 12 cenários com amostras dentro dos frames preparados, incluindo
  conteúdo dinâmico, resposta tardia, falha, reversão e desligamento.
  Quatro casos adicionais de redução de movimento ativada durante abertura,
  combinando preferência do aplicativo/sistema e canto esquerdo/direito,
  terminam em 40 ms sem transform ou animação em curso. O teste revelou que
  alterar apenas a duração de um destino Motion já ativo não cancela sua mola;
  os valores animados agora interrompem e aplicam diretamente a pose final.
  Também foi testado fechar e reabrir após mudar essa preferência: opacidade e
  transformação usam valores explícitos estáveis, preservados entre montagens,
  sem depender da inscrição de um controlador no novo popup.
- Painel: navegação rápida, direção, mesmo nó de formulário com rascunho,
  modais de páginas ocultas, disclosures reversíveis, Escape, preferências de
  movimento reduzido e larguras 1280/760/390 aprovados.
- Capivara: oito cenários, sem alvo clicável próprio, sem animação infinita;
  ocultação/inert interrompem reação. Pixels em repouso iguais ao SVG anterior.
- Bundle de produção: painel, ilha, canto esquerdo e direito montam, navegam,
  abrem/fecham e respeitam movimento reduzido; zero erros JavaScript ou de
  carregamento, com o chunk Motion presente nas quatro rotas. Reabertura após
  a mudança de preferência chega à pose final, sem menu transparente.

As evidências usam a aplicação real no Chromium com dados locais isolados e
IPC simulado. A gravação passou sem erros JavaScript. [Prévia para baixar](previews/README.md).

Não houve alteração nos stores, SQLite, schemas, código Rust, skills ou
templates do usuário. Não se reproduziu o encerramento relatado anteriormente
no Windows; as correções acima eliminam casos de transição identificados nos
testes, sem atribuir a eles uma causa de crash não confirmada.

Foco físico, click-through, sobreposição entre aplicações, multi-monitor/DPI,
WinRT e fluidez no WebView2 precisam de validação no Windows. Após recompilar,
experimentar: hover repetido; alternância Hoje/Foco/Música; abrir/fechar menu
durante expansão; habilitar movimento reduzido em curso; modo híbrido com
retorno ao topo; desligar dock/cantos e clicar onde estavam; Alt+Espaço enquanto
outro aplicativo está em primeiro plano. Compilação cruzada não comprova FPS
ou interação física do desktop.
