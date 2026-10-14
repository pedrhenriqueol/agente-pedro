# Comparação dos vídeos e correções de motion — 14/10/2026

## O que os vídeos mostram

Comparação entre o Pedro de `explorer_8XVAweboNT.mp4` (92,67 s) e o Niko
de `explorer_zi6HDsmi7j.mp4` (89,83 s). Ambos têm 30 quadros por segundo;
não permitem medir o FPS real de cada aplicativo nem identificar uma exceção.

| Aspecto | Pedro observado | Niko observado | Alteração no Pedro |
|---|---|---|---|
| Recolhimento | ~1,9–2,2 s: conteúdo apaga, superfície fica vazia e só então encolhe; padrão se repete ~5,7 s e ~11,2 s | ~46 s: conteúdo e contorno recolhem como uma mesma ação | Redução começa junto com a saída; removida a espera inicial de 90 ms |
| Expansão por aproximação | Entrada separada entre cabeçalho, conteúdo e geometria; usuário também relatou travamento fora da gravação | ~35–36 s e ~40–41 s: abertura com continuidade do ponto de origem | Cabeçalho aguarda a preparação do frame; entrada se sobrepõe ao morph; retorno cancela o deadline anterior |
| Troca de contexto | Música → Hoje → menu muda largura e redistribui controles; cliques no contexto ativo podiam reiniciar a transição | ~37–38 s: troca preserva a barra superior | Toolbar com largura interna estável; seleção ativa não reinicia; somente uma apresentação de saída é retida |
| Âncora espacial | Deslocamento lateral nas alterações de largura | Centro da ilha e canto do popup permanecem referências | Posição e tamanho em uma operação Windows; canto direito acompanha imediatamente o viewport |
| Submenus de Hoje | Conteúdo de saída participava do tamanho até terminar o fade | Conteúdo e contorno mudam juntos | Painel de saída passa a ser uma camada absoluta; nova altura fica disponível desde o início |
| Hierarquia musical | Player com elementos sobre o fundo externo | Superfície interna reúne capa, metadados e controles | Agrupamento interno com fundo elevado, borda discreta e espaçamento consistente |
| Responsividade final | ~63–89 s: painel desenhado, timer e ajustes param de atualizar normalmente | Gravação de referência não apresenta sintoma equivalente | Corrigida tempestade reproduzível de preferências; operações nativas deixam de segurar mutex de estado |

A referência orienta movimento, hierarquia e continuidade. Paleta industrial,
monograma, dados locais e navegação do Pedro são preservados. Não foram
introduzidos personagens, logos ou assets do Niko.

## Falha reproduzida e correção

O middleware `persist` gravava no armazenamento mesmo quando `setState`
recebia um evento `storage`. Cinco WebViews recebendo valores sucessivos
de um slider voltavam a gravar valores antigos e geravam novos eventos.
O novo teste com cinco alterações de opacidade ainda tinha **100 eventos
pendentes após 500 entregas** antes da correção.

A persistência agora é explícita: a origem grava e publica; o receptor de
storage atualiza apenas a memória. Um envelope com revisão monotônica e
emissor rejeita mensagens atrasadas e duplicadas. A edição local consulta
a preferência mais recente persistida antes de alterar outro campo.
O teste termina com **cinco gravações e fila vazia**. A chave e o campo `state`
continuam compatíveis com os dados existentes; não há migração SQLite.

É uma falha confirmada e compatível com a saturação vista no vídeo. Sem o
log da execução gravada, não é possível afirmar que foi sua única causa.

## Movimento e integração nativa

- Superfície: 260 ms; troca de contexto: 220 ms; corpo entra em 180/220 ms.
- Recolhimento e fade começam juntos; frame nativo reduz após 280 ms.
- Hover mantém intenção de 120 ms, evitando abrir durante passagens acidentais.
- Um temporizador de saída anterior não cancela uma nova abertura com IPC lento.
- Conteúdo interno tem largura fixa durante o morph; seleção ativa não provoca piscar.
- Snapshots de saída não acumulam uma árvore de todos os contextos interrompidos.
- `SetWindowPos` atualiza posição/tamanho juntos, sem ativar a janela ou mudar z-order.
- ShowWindow, resize e acesso ao WebView ocorrem fora dos mutexes de política;
  a geração é conferida novamente após a operação nativa.
- Movimento reduzido, teclado, dados de mídia e ações de rotina continuam operantes.

## Evidências

- `npm test`: **96 aprovados**, sem falhas ou testes pulados.
- `npm run build`: TypeScript/Vite aprovados; aviso preexistente de import misto do módulo de eventos Tauri.
- `cargo check --locked --target x86_64-pc-windows-gnu --tests -j3`: aprovado.
- **24 testes Rust portáveis** executados no host: 19 de visibilidade e cinco de cantos.
- Chromium: oito cenários de interação, três de falha/reversão, quatro de teclado/identidade,
  seis de cantos e verificação de agenda/tarefas/hábitos, inclusive erros de persistência.
- Hover com frame que efetivamente muda de tamanho: **568 amostras**, nenhum recorte,
  desvio máximo do centro **0,0078125 px**, 30 trocas rápidas, apresentação de saída
  limitada a 212 elementos na carga usada, nenhum erro JavaScript.
- Gravação atual da interface real em Chromium, com três frames e dados de demonstração:
  `/workspace/pedro-motion-stability-preview/pedro-motion-corrigido.mp4`.

Essas amostras comprovam o comportamento do frontend no cenário testado, não
uma taxa de FPS física no Windows. Foco do HWND, pintura do WebView2, DPI e
interação sobre outros aplicativos ainda precisam do executável Windows.
Roteiro local: hover repetido, saída/retorno durante morph, alternar contextos,
arrastar opacidade com menus abertos e usar Alt+Espaço após essas ações.
