# Design Report — clique, menus e submenus

## 1. Identificação e escopo

- Superfícies: navegação do painel, categorias/disclosures de Aparência, diálogos e corpo contextual da ilha.
- Objetivo: resposta imediata ao comando e continuidade de entrada/saída, preservando a identidade industrial e o cabeçalho da atividade.
- Data: 2026-10-13, America/Sao_Paulo.
- Referência: vídeo atualizado `explorer_zi6HDsmi7j.mp4`, 89,83 s, 1920×1080/30 fps. Somente referência visual; nenhuma reutilização de código ou assets.

## 2. Baseline e fricções verificadas

- Vídeo Pedro gerado: música→menu em aproximadamente 44,4–44,6 s contém dois quadros com corpo vazio, apesar do cabeçalho persistente.
- `PageTransition` inicia saída a partir de opacity 1 mesmo quando a página ainda está entrando com opacity 0; interrupção provoca flash.
- Categorias de Aparência remontam por key; disclosures abertos são perdidos ao retornar. Details animam apenas a seta.
- Dialog recebe deslocamento tanto no backdrop quanto na superfície; fechamento condicional desmonta sem saída.
- Indicadores/labels de seleção mudam abruptamente; diversos controles não têm resposta visual própria ao pressionar.

## 3. Evidências Niko e interpretação

- 35,566–36,066 s: expansão ancorada no topo/centro, ícone reconhecível e corpo que ganha legibilidade. O intervalo observado (~500 ms) não será reproduzido literalmente; Pedro conserva ciclos inferiores a 300 ms.
- 46,300–46,633 s: corpo se atenua antes da superfície recolher para o resumo.
- 58,067–58,267 s: ajustes no canto entram com opacidade, leve escala e deslocamento vertical de aproximadamente 6 px, conservando a âncora superior/direita.
- 66,900–67,400 s e 69,967–70,333 s: subpáginas mudam dentro de uma superfície; toolbar permanece e a geometria acompanha o conteúdo. Não há evidência suficiente para atribuir slide horizontal literal a essas trocas.
- Gravação a 30 fps limita precisão temporal a cerca de 33 ms; não prova FPS de execução, eventos pointerdown/keyup nem a curva matemática usada.

## 4. Implementação concluída

- Pressão/release consistente em controles: realce e pequena resposta do ícone/conteúdo, mantendo a área clicável estável.
- Seletores com indicador persistente; labels recolhidas conservam espaço durante o fade.
- Páginas animam a partir do valor visual apresentado, com cancelamento de conclusões antigas e estado local preservado.
- Categorias visitadas e opções avançadas mantêm estado; disclosures têm abertura/fechamento reversíveis e retorno de foco.
- Diálogos passam a ter presença por `open`; backdrop muda apenas opacidade, superfície tem escala/deslocamento mínimos e saída curta. Página inativa libera portal/trap imediatamente.
- Ilha conserva uma camada visual anterior inacessível durante a troca até a nova apresentação começar. Nenhum período de corpo vazio nem duplicação de controles ativos. Frame preparado antes do crescimento, recolhido após a saída e fallback ocupa a altura nativa confirmada.
- Paleta/tipografia existentes. Movimento reduzido remove deslocamento/escala e conclui imediatamente. Sem blur amplo, alterações do Shell ou novas dependências de animação.

## 5. Critérios e evidências

- [x] Cliques por mouse e teclado têm resposta sem alterar o alvo físico.
- [x] Interrupções não causam flashes, camadas antigas ativas ou conclusão atrasada.
- [x] Menus/submenus abrem e fecham com continuidade e foco correto.
- [x] Formulários, disclosures e scroll preservados; modais inativos liberam teclado.
- [x] Movimento reduzido local e do sistema verificados.
- [x] Testes, build e checagem Rust aprovados.
- [x] Vídeo atualizado e comparação por quadro registrados.
- [ ] Windows físico: foco/blur/DPI/desempenho. Não afirmar execução nativa a partir de Chromium ou compilação cruzada.

### Sequência e tempos implementados

| Interação | Movimento | Duração |
| --- | --- | --- |
| Pressionar | Realce interno e ícone em escala 0,9; alvo físico fixo | Resposta imediata; ícone 140 ms, realce mínimo 80 ms |
| Página/categoria | Saída e entrada sobrepostas a partir da opacidade atual | Saída 100 ms, entrada 180 ms; altura da categoria 200 ms |
| Opção avançada | Altura/opacidade reversíveis, filhos preservados | 190 ms |
| Diálogo | Backdrop em fade; superfície desloca 4 px/escala 0,985 | Entrada 190 ms, saída 120 ms |
| Menu/submenu da ilha | Conteúdo anterior congelado visualmente, novo corpo entra mantendo cabeçalho e âncora | Anterior 110 ms, entrada 150–160 ms; troca concluída em 220 ms após preparar frame |
| Recolher ilha | Corpo sai, superfície reduz, frame nativo recolhe | Corpo 80 ms; redução inicia em 90 ms, pedido nativo em 270 ms |

O tempo de uma chamada nativa não é incluído nessas durações. Durante a espera, a apresentação anterior continua visível. Movimento reduzido conclui os estados imediatamente; as ações e a ordem de preparação nativa permanecem iguais.

### Evidência executada

- `npm test`: 68 aprovados, zero falhas/pulados. Banco, stores e sincronização continuam cobertos; não houve mudanças de schema ou lógica transacional.
- `npm run build`: TypeScript e Vite aprovados. Persiste o aviso conhecido de importação estática/dinâmica de `@tauri-apps/api/event`; não impede o build.
- `cargo check --locked --target x86_64-pc-windows-gnu --tests`: aprovado sem warnings. Checagem real do alvo Windows; não execução dos testes Windows neste host Linux.
- Chromium: uma página interrompida com opacidade **0,466132** conservou **0,466132** ao começar a saída, sem reset para 1. Navegação rápida preservou campos/scroll e deixou áreas anteriores `inert`.
- Mouse junto à borda do botão e Space: área física idêntica durante pressão; ação executada e realce liberado. `pointercancel` limpa a pressão.
- Categorias: disclosure aberto continua aberto ao retornar. Três reversões rápidas e Escape no conteúdo devolvem foco ao summary.
- Diálogos: saída visual continua por 120 ms, mas portal inativo libera lock/teclado imediatamente. Reabrir durante saída, alternar página nativa e fazer handoff com Ctrl+K preservaram rascunho e restauraram `inert`/overflow do fundo.
- Ilha: **59 amostras por requestAnimationFrame**, zero amostras com corpo e camada anterior ambos abaixo de 0,01 de opacidade, zero recortes contra o frame IPC confirmado. Seis reversões de recolhimento/reabertura aprovadas. Camada anterior é `inert`, sem IDs e removida ao concluir; cabeçalho conserva a mesma instância.
- Fallbacks: falha de redução, dupla falha, resposta antiga após reabrir, mensagem extensa com scroll e ocultação durante pedido pendente aprovados. Sem novo comando Rust nem alteração no redimensionamento/foco nativo.
- Movimento reduzido local/sistema, teclado dos menus (Home/End/setas/Escape), viewport de 390 px sem overflow e zero erros JavaScript verificados.
- Revisão independente do diff: nenhum bloqueador encontrado em epochs, cleanup, locks/foco, páginas retidas e recuperação do frame.

### Capturas e roteiro de revisão

[Opções avançadas](evidence/motion/aparencia-motion.png), [layout compacto](evidence/motion/motion-mobile.png), [ilha](evidence/motion/ilha-motion.png) e [amostras da troca](evidence/motion/overlap-evidence.json). Capturas reais de Chromium com dados isolados. Música e IPC nativo simulados, sem áudio real.

Gravação entregue ao usuário: `pedro-transicoes-preview.mp4`, **43,48 s, H.264, 1280×884, 1,61 MB**. Vídeo, galeria HTML autossuficiente e ZIP são artefatos externos ao checkout; não contêm código/assets do Niko. A galeria foi verificada quanto à decodificação do vídeo/imagens e abertura/fechamento da ampliação.

Para revisão manual, abrir Aparência → Acabamento da ilha, trocar para Navegação e voltar: disclosure deve manter estado. Interromper sua abertura com novo clique. Abrir Ctrl+K, fechar e reabrir durante a saída. Abrir Finanças, editar um rascunho e alternar página; voltar deve recuperar o diálogo. Na ilha, alternar música/menu/ajustes e recolher/reabrir rapidamente: cabeçalho permanece, conteúdo não fica vazio, menus anteriores não recebem foco. Repetir com movimento reduzido.

A referência contínua para próximas mudanças de motion é o vídeo **atualizado** do Niko, analisado por interação e sequência de quadros. Não atribuir curvas, springs ou FPS que a gravação não comprova; preservar a identidade e os limites de duração do Pedro.
