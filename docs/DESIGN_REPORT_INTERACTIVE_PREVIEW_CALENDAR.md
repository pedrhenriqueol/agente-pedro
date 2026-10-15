# Prévia interativa e passagem entre meses — 15/10/2026

## Intenção e estado anterior

Continuação dos dois recursos sugeridos no relatório de polimento da release.
A prévia de aparência já reflete preferências e atividades reais, mas não
permite experimentar a abertura da ilha. A agenda troca os dias do mês
instantaneamente, sem uma indicação visual da direção da navegação.

## Escopo aprovado para implementação

- Um controle explícito de abertura e recolhimento dentro da prévia de
  aparência. A demonstração não envia comandos para as janelas nativas,
  reprodução ou sessões de foco. Metadados reais continuam somente leitura.
- Passagem curta entre os meses da agenda, com direção correspondente à
  navegação. O calendário já usa 42 dias em seis semanas; essa altura será
  preservada, evitando redimensionar a janela apenas pela troca de mês.
- Movimento reduzido por preferência do aplicativo e do sistema; reversão
  rápida, ocultação e navegação por teclado fazem parte da revisão.

A identidade, os tokens e as curvas compartilhadas do Pedro são mantidos.
Não há mudanças no backend, nas janelas, no banco ou nas regras de negócio.
README e distribuição do executável permanecem na etapa posterior de release.

## Critérios de aceitação

Prévia com abertura contínua e reversível, controle acessível e foco estável,
sem comandos externos. Agenda com um único calendário acessível, sem meses
antigos acumulados nem alteração de altura; setas, Home/End, PageUp/PageDown,
seleção e retorno a hoje preservados. Ambos devem terminar no estado pedido
após interrupções, funcionar em larguras menores e dispensar movimento quando
solicitado pelo usuário.

## Resultado e evidências

### Prévia de aparência

`AppearancePreview` concentra a demonstração antes embutida na página de
configurações. **Testar abertura / Recolher prévia** transforma uma única
superfície, com as curvas compartilhadas de abertura de 260 ms e fechamento
de 200 ms. MotionValues conservam a pose desenhada nas reversões. O desktop
da demonstração mantém 236 px de altura e a ilha expandida ocupa 166 px;
trocar o contexto não desloca os controles abaixo da prévia.

Foco, música e saldo continuam lendo os registros reais. Repouso tem uma
demonstração identificada, com o mascote original e os espaços do Pedro.
O botão expõe `aria-expanded` e `aria-controls`; Escape recolhe sem alterar
o foco. Corpo recolhido é inerte e oculto para leitores de tela. Redução de
movimento local/sistema, página inativa e documento oculto assentam a pose.
Largura zero de uma página retida não substitui sua última medida válida.

A revisão corrigiu a precedência dos estilos antigos e o tamanho do span
do mascote decorativo; as capturas finais foram inspecionadas. O componente
não envia comandos para controlar a ilha real, a música ou o foco.

### Agenda

Os meses entram na direção da navegação em 180 ms; a saída usa 100 ms.
Cabeçalho, dias da semana e rodapé permanecem imóveis. Há uma grade acessível
com 42 dias e, durante a passagem, no máximo uma camada de saída inerte,
sem IDs, refs ou ações ativos duplicados. Ela é removida ao terminar.

Reversão amostra opacidade e posição atuais. Em navegação rápida A → B → C,
a camada visual predominante permanece na saída, evitando apagar A quando
B ainda está quase transparente. Redução de movimento e ocultação pelos
ancestrais da ilha cancelam as animações; reabrir não repete a passagem.
Setas, Home/End, PageUp/PageDown e o retorno para hoje preservam as regras
de data local e os guardas de foco existentes.

### Verificação

- **109 testes Node aprovados**, sem falhas ou testes pulados.
- **Build TypeScript/Vite aprovado**; apenas o aviso existente de importação
  estática/dinâmica de `@tauri-apps/api/event.js`.
- **Cargo check Windows GNU com `--tests --locked` aprovado**. Os testes do
  executável Windows foram compilados, sem execução gráfica neste Linux.
- Prévia em produção: **oito grupos** cobrindo ARIA, foco, persistência sem
  alterações, onze reversões de 35 ms, contextos, três tamanhos, dock,
  larguras 1280/760/390 px, tema claro, ocultação e movimento reduzido.
- Metadados em desenvolvimento: **oito grupos** com foco/tarefa/progresso,
  pausa/registro pendente, título/artista/capas e falha de capa, estados de
  mídia e saldo negativo em centavos. Oito alternâncias não chamaram ações
  nem alteraram os quatro stores/localStorage; 24 atualizações de faixa
  durante a abertura não reiniciaram a geometria.
- Agenda em produção: **16 cenários / 1531 amostras visíveis**, incluindo
  12 meses nas larguras 480/560/640 px, reversões e sequências a 5/15/30 ms.
  Altura da agenda de 217,6875 px e da ilha de 321 px constantes nessa
  matriz; **zero novos IPCs de resize por mudança de mês**. Uma grade,
  42 células e um tab stop; clamp 31 → 30, foco e dados preservados.
- Nenhum erro JavaScript ou de recurso nas rodadas aprovadas.

Resumo estruturado em
[qa/INTERACTIVE_PREVIEW_CALENDAR_2026-10-15.json](qa/INTERACTIVE_PREVIEW_CALENDAR_2026-10-15.json).
Capturas do app: [prévia expandida](qa/interactive-preview-expanded.png) e
[agenda](qa/calendar-directional-medium.png). São renderizações de QA,
sem conteúdo pessoal dos vídeos enviados pelo usuário.

## Limite e revalidação Windows

O Chromium verifica apresentação, foco no DOM e viewport real de iframe com
IPC simulado. Não comprova composição física do DWM/WebView2, FPS nem
click-through sobre outros aplicativos. Nenhuma janela ou comando nativo
mudou nesta entrega. Após recompilar no Windows, conferir a prévia em
Aparência e navegar rapidamente pelos meses na ilha; repetir recolhimento
durante a passagem e movimento reduzido. A revalidação dos primeiros quadros
da central e do canto direito continua sendo a condição gráfica da release
documentada no relatório anterior.
