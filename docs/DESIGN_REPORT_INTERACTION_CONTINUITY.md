# Design Report — Continuidade dos controles e menus

## 1. Identificacao e escopo

- Superficies: menu do Pedro, selecao Foco/Pausa no painel e na ilha,
  controles de aparencia/volume nos cantos.
- Objetivo: tornar a relacao entre gesto e resposta mais continua e legivel.
- Base: `bfff4af`; data: 2026-10-16, America/Sao_Paulo.
- Skills: react-motion-design, desktop-design-system e visual-regression-qa.

## 2. Baseline e friccoes

A ilha ja possui superficie persistente, preparacao nativa antes da entrada,
transicoes direcionais, crossfade, marcadores nas abas e reversoes. A rodada
atua sobre lacunas menores da mesma linguagem, sem substituir esse mecanismo.

- O menu do Pedro repinta cada item isoladamente; falta uma referencia visual
  que acompanhe a mudanca entre apontar e navegar por teclado.
- Foco/Pausa muda o fundo de dois botoes, enquanto outros seletores do app ja
  possuem um marcador continuo.
- A seta do canto direito e trocada por outro SVG ao abrir. Silenciar tambem
  substitui o icone de uma vez. Superficie e conteudo do popup entram juntos,
  sem uma pequena hierarquia temporal.

O baseline foi capturado no Chromium com componentes reais e fronteira IPC
controlada antes das edicoes. A comparacao anterior com o Niko atualizado
permanece em `DESIGN_REPORT_MOTION.md`: continuidade, ancoragem e organizacao
em camadas sao referencias; assets, personagens e curvas nao sao copiados.

## 3. Direcao visual

Conservar paleta industrial, tipografia, densidade, raios e areas clicaveis.
O acento indica selecao de Foco/Pausa; o realce de menu usa a superficie
elevada e uma borda discreta. Nao adicionar telemetria ou movimento ambiental
continuo. Os controles devem explicar o que mudou a partir do gesto.

## 4. Motion e microinteracoes

- Menu: um unico realce acompanha mouse/foco/setas, sem mover o alvo fisico.
  A primeira aparicao ocorre no item correto; reversoes partem do estado
  desenhado e sair do menu atenua o realce. Roving tabindex continua separado
  da posicao do mouse. Camada decorativa nao recebe eventos nem acessibilidade.
- Foco/Pausa: componente apresentacional compartilhado, marcador horizontal
  de aproximadamente 200 ms. Os comandos e bloqueios da sessao permanecem
  nos componentes/na store existentes.
- Cantos: a mesma seta gira 180 graus em aproximadamente 180 ms, em wrapper
  separado do feedback de pressao. Icones de volume fazem crossfade em area
  fixa. O conteudo acompanha a superficie com atraso curto de 20–30 ms;
  o ciclo completo fica abaixo de 280 ms.
- Movimento reduzido local e do sistema interrompem o movimento em andamento
  e aplicam o destino imediatamente. Mouse e teclado mantem as mesmas acoes.
- Nao animar altura dos campos condicionais nem alterar medicao/frame nativo:
  transform/opacity nos filhos nao geram redimensionamento a cada quadro.

## 5. Verificacao

- Menu: hover rapido, setas/Home/End, troca entre mouse/teclado, saida/retorno,
  fechamento durante o realce e ausencia de controles duplicados.
- Foco/Pausa: marcador correto em duas superficies, alvo estavel, modo iniciado
  continua bloqueando alteracao; estado preservado ao navegar.
- Popups: primeira entrada, reversoes rapidas, movimento reduzido acionado em
  voo, altura medida estavel e nenhum pixel apresentado antes do preparo.
- Executar `npm test`, `npm run build`, checagem Rust Windows e QA real de
  renderizacao/interacao no Chromium, com screenshots comparaveis.
- Transparencia, foco entre apps, DPI e desempenho do WebView2 continuam a
  exigir verificacao no Windows. Chromium com IPC simulado nao comprova isso.

## 6. Implementacao e resultados

O menu agora possui um unico realce decorativo, com deslocamento de 160 ms e
entrada/saida de 100 ms. Mouse e teclado mantem seu proprio estado: apontar
nao altera o tabindex nem transfere o foco. A primeira entrada posiciona o
realce no item antes de apresenta-lo; reversoes cancelam a animacao anterior.

`FocusModeSwitch` compartilha o marcador Foco/Pausa entre painel e ilha, com
deslocamento de 200 ms. `SelectionIndicator` preserva a ultima geometria
quando uma pagina retida esta oculta, evitando retorno a partir de uma caixa
de tamanho zero. As restricoes de sessoes em andamento permanecem ativas.

Nos cantos, a seta permanece montada e gira em 180 ms; volume/silencio usam
duas camadas em area fixa, com crossfade de 140 ms e escala de 160 ms. O
conteudo entra em 180 ms, com atraso de 25 ms apos a superficie preparada, e
sai em 100 ms. A pose inicial e aplicada diretamente durante o preparo,
independentemente da latencia IPC. Opacity/transform nao alteram a medicao
dos popups. O feedback de pressao dos icones do menu foi preservado.

Validacao da implementacao final:

- `npm test`: 146 testes aprovados.
- `npm run build`: aprovado. Permanece o aviso existente de importacao
  estatica/dinamica do modulo de eventos do Tauri.
- `cargo check --locked --target x86_64-pc-windows-gnu --tests -j3`: aprovado.
- Chromium real: 19 de 19 cenarios aprovados, 2.230 quadros amostrados e 36
  ciclos de abertura/fechamento, alem de reversoes durante o movimento.
- Menu por mouse e teclado, Home/End, marcador persistente, seis alternancias
  Foco/Pausa e bloqueio durante sessao iniciada/pausada: aprovados.
- Movimento reduzido local e do sistema, inclusive acionado durante uma
  transicao: aprovado.
- Conteudo dos cantos manteve alturas de 337/98 px e larguras internas de
  350/262 px. Nenhum overflow nos 134 quadros de entrada inspecionados.
- Preparo IPC com atraso de 140 ms e viewport limitada com DPR 1,5 simulados:
  aprovados; a mudanca de largura ocorreu apenas pelo limite planejado.
- Nenhum erro JavaScript, de console ou resposta HTTP de erro na execucao.

O resumo dos cenarios esta em
[`evidence/interaction-continuity/qa-summary.json`](evidence/interaction-continuity/qa-summary.json).
A [previa MP4](evidence/interaction-continuity/preview.mp4) e as capturas de
[menu](evidence/interaction-continuity/menu.png),
[foco](evidence/interaction-continuity/foco.png) e
[volume](evidence/interaction-continuity/volume.png) usam componentes reais,
dados demonstrativos e IPC simulado. O cenario de desktop pertence apenas a
gravacao. Esta evidencia nao substitui validacao nativa no Windows.
