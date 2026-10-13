# Design Report — Hoje e contexto de foco na ilha

## Baseline e referência

Vídeo atualizado do Niko: em 38,4 s e 88,4 s, Hoje reúne tarefas/hábitos e criação rápida dentro da superfície da ilha. Em 66,2 s, o timer apresenta seleção de contexto. O Pedro abre o painel ao escolher Hoje; sua ilha mostra a tarefa selecionada, mas não permite escolhê-la ali.

## Escopo

- Hoje contextual com Tarefas/Hábitos, tarefas pendentes sem prazo/hoje/vencidas, criação para a data local e conclusão real. Habitos usam o calendário e persistência existentes.
- Contexto do foco pode ser escolhido na ilha antes da sessão. Durante execução/pausa/gravação, identidade/deadline permanecem protegidos.
- Reutilizar stores SQLite/eventos existentes, sem nova dependência, chat fictício, integração sem funcionamento ou assets do Niko.
- Cabeçalho e superfície contínua, menus/submenus com presença preservada, teclado e movimento reduzido. Corpo respeita tamanho nativo e scroll.

## Validação

- [x] Chromium com fallback SQL real: criação/conclusão persistem; filtro data local exclui futuras/concluídas; erro de gravação mantém rascunho e retry recupera; dupla ativação de hábito grava uma vez e conserva streak local.
- [x] Abas com setas/Home/End, camadas anteriores inert, rascunho preservado ao retornar do menu, reduced motion e viewport 390 px aprovados. Campo fica readOnly durante gravação; foco retorna ao próximo item/campo/aba sem vencer navegação ou troca de aplicativo.
- [x] Seleção compartilhada com foco; estado em execução/pausa bloqueia troca e reset preserva tarefa. Nenhuma modificação de deadlines, IDs de sessão ou stores.
- [x] Build/testes aprovados; revisão independente incluiu oito cenários de foco, ações pendentes e Escape para o menu, sem erros JavaScript. Geometria, erros extensos, cabeçalho persistente e interrupções verificados com IPC simulado.
- [x] 205 amostras de Hoje/abas/criação/foco/recolhimento ficaram dentro do frame nativo simulado, sem recortes. A entrada no foco procura controles do contexto visível; Hoje permanece montado e oculto, sem receber foco indevido. Escape após a troca fecha normalmente.
- [ ] Execução física: confirmar novas ações no SQLite do Windows, hover híbrido e dock desligado. O fallback Chromium não comprova execução WinRT/WebView2 ou hit testing físico.

## Evidência e continuidade

Capturas reais com registros isolados: [Hoje](evidence/today/hoje-contextual.png), [Hábitos](evidence/today/habitos-contextuais.png) e [contexto do foco](evidence/today/foco-contextual.png). Vídeo entregue ao usuário mostra criação/conclusão, abas, hábito, rascunho retomado, seleção e pausa do foco; recursos de janela do Windows não são gravados no navegador.

Agenda/calendário completo, Código e Conexões aparecem no Niko e continuam oportunidades separadas. Esta etapa implementa as ações locais que já têm domínio/persistência operacional no Pedro. A navegação mantém identidade industrial, cabeçalho único e detalhes sob demanda.
