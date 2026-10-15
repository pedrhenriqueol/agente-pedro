# Ajustes anteriores à release — 15/10/2026

## Escopo e diagnóstico visual

Ilha central, popup de som à direita e regressão do canto esquerdo; pequenas
melhorias de interação no painel e na rotina. Paleta, mascote, tamanhos e
identidade aprovados permanecem os mesmos. README principal e publicação do
executável são uma etapa posterior à revalidação gráfica Windows.

O vídeo do usuário tem 1920×1080, 30 fps e aproximadamente 42 s. Quadros
consecutivos demonstram:

- Em 7,300 s, a ilha central fica ausente por um quadro, antes de expandir.
- Em 21,733 s, a cápsula direita mantém a largura e salta 214 px para a
  esquerda. Em 21,767 s volta à âncora e começa a revelar o popup.
- O salto coincide com a diferença de frames 304−90 px. O canto esquerdo
  mantém a origem x quando cresce; centro e direita mudam essa origem.
- O fim desse vídeo mostra navegação e fechamento do painel, sem evidência
  de crash nesta execução.

Isso localiza o defeito na preparação/repintura, antes da curva principal.
Não foi tratado como um simples ajuste da mola. Os quadros pessoais enviados
pelo usuário não foram adicionados ao repositório.

## Correção aplicada

O [desenho técnico](SYSTEM_DESIGN_RELEASE_MOTION.md) separa duas camadas:

1. **HWND Windows:** `SWP_NOCOPYBITS` em mudança de tamanho descarta a cópia
   automática do client antigo na nova origem. A aplicação atômica, ausência
   de ativação, z-order e retorno rápido para frame igual continuam preservados.
2. **WebView:** o retorno nativo inclui dimensões aplicadas, após clamp e
   arredondamento por DPI. A apresentação aguarda o viewport real e dois RAFs
   distintos com as dimensões corretas. O intervalo conserva a pose compacta
   central; o popup dos cantos permanece invisível e inerte.

Não há sleep nativo nem aumento arbitrário da duração da animação. A espera
tem limite de 1200 ms, invalidação por geração/intenção e recuperação de erro.
Documento oculto ainda válido retoma ao voltar ou recolhe após timeout; não
abandona um frame expandido vazio. Recolhimento central também confirma o
viewport antes de encerrar a fase. Uma operação antiga não pode revelar uma
solicitação substituída.

## Interatividade entregue

**Busca Ctrl+K:** foco inicial no campo, resultado ativo discreto, setas,
Home/End e Enter; ponteiro, Tab/Shift+Tab e Escape preservados. Filtro ou nova
abertura reinicia a seleção. Zero resultados, IME, modificadores e eventos
cancelados não acionam um destino. Outro modal mantém sua prioridade.

**Confirmação de ações:** check decorativo de 150 ms nas mensagens existentes
de tarefa/hábito salvos. Só dispara após o sucesso da persistência; falha não
celebra, refresh não anima e reabrir uma página não repete o efeito. Textos,
status acessível, bloqueio de cliques duplicados e rascunhos permanecem sob
os mesmos responsáveis. Movimento reduzido é estático; ocultação cancela o
efeito. Não há som, confete ou novo popup.

## Recursos explorados para evolução

| Recurso | Decisão |
| --- | --- |
| Busca instantânea por teclado | Implementado nesta entrega; útil sem acrescentar controles permanentes |
| Confirmação localizada após salvar | Implementado; usa a área de feedback existente |
| Prévia de aparência com botão para testar expansão | Implementada na [continuação](DESIGN_REPORT_INTERACTIVE_PREVIEW_CALENDAR.md); demonstração restrita ao painel, sem controlar as atividades |
| Passagem direcional entre meses da agenda | Implementada na [continuação](DESIGN_REPORT_INTERACTIVE_PREVIEW_CALENDAR.md); a inspeção confirmou seis semanas fixas, preservando a altura da ilha |

## Validação

- `npm test`: **109 aprovados**, zero falhas ou testes pulados. Novos testes
  exercitam confirmação atrasada, dois frames estáveis, mudança intermediária
  de viewport, cancelamento, timeout/retry, documento oculto, arredondamento
  de DPI e retorno nativo limitado pelo monitor.
- `npm run build`: TypeScript/Vite aprovados; apenas o aviso já existente do
  import estático/dinâmico de `@tauri-apps/api/event.js`.
- `cargo check --locked --target x86_64-pc-windows-gnu --tests -j3`: aprovado.
  É checagem cruzada, não execução gráfica nem execução dos testes Windows.
- Primeiros quadros em desenvolvimento: **24 casos**, **1235 amostras**,
  cobrindo os três widgets e retorno IPC anterior ao resize do iframe real
  em 1/2/3 RAFs e 160 ms, reversão, cancelamento, falha, clamp e movimento
  reduzido. Centro com desvio máximo de 0,008 px e borda direita estável.
- Bundle de produção: **5 casos**, **309 amostras**, com as mesmas fronteiras
  de renderer/IPC, sem imports do código-fonte e sem erros de JS/recursos.
- Ocultação em preparação: **9 casos de integração**, nos três widgets.
  Retorno em 240 ms retoma; espera superior a 1200 ms recolhe para centro
  120×48, direita 90×46 e esquerda 128×46; cancelamento impede revelação
  tardia. Todos permitem nova abertura. A mesma matriz de nove casos passou
  também no bundle final de produção, sem erros JavaScript ou de recursos.
- Busca: seis grupos de QA, incluindo foco, modalidade, IME, zero resultados,
  teclado/ponteiro e larguras 1280/760/390.
- Confirmações: sete cenários, incluindo falha sem celebração, gravação única,
  foco/rascunho, ocultação, reabertura e movimento reduzido local/sistema.

O resumo das evidências automatizadas está em
[qa/RELEASE_POLISH_2026-10-15.json](qa/RELEASE_POLISH_2026-10-15.json).
Stores, SQL, registros financeiros, skills e templates do usuário não mudaram.

## Limite da validação e roteiro Windows

Chromium com IPC simulado valida DOM, viewport, estados e a ordem da abertura.
Não comprova descarte de texturas antigas do DWM/WebView2 ou taxa de quadros
física. A flag nativa é fundamentada pela API Windows; seu efeito visual na
máquina do usuário ainda precisa de confirmação.

Após recompilar o executável, repetir abertura/fechamento por clique e hover
na central e direita, depois na esquerda. Testar reversões rápidas, modo
híbrido, movimento reduzido e escalas 100/125/150%; observar os primeiros
quadros, o retorno ao topo e cliques em janelas por baixo. Alt+Espaço deve
continuar abrindo apenas o painel. Nenhuma alteração no Shell do Windows.
