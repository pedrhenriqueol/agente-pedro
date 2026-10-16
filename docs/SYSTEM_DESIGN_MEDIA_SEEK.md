# System Design — Continuidade da sessao durante seek

## 1. Contexto e problema

Base: `717b5dd`. O usuario confirmou que skip foi corrigido, mas relatou que
avancar o tempo da faixa no SoundCloud/Opera pode apagar a reproducao do
Pedro. As capturas mostram metadados retidos em atualizacao e depois estado
vazio, com volume ainda disponivel.

O codigo comprova um caminho capaz de produzir esse comportamento: toda
amostra chama `TryGetMediaPropertiesAsync` antes de ler playback/timeline;
erro, timeout ou metadados vazios apagam a selecao, mesmo quando o catalogo
ainda apresenta o objeto vivo. Uma operacao mais lenta que o timeout e
cancelada e reiniciada em cada tentativa, sem possibilidade de completar.
Nao ha log Windows para afirmar qual HRESULT/latencia ocorreu nesta maquina.
Seek numerico e timeline ausente, isoladamente, nao apagam a faixa na store.

## 2. Arquitetura atual e proposta

- Separar descoberta, playback e timeline da leitura de titulo/artista/capa.
  Atualizar a posicao nao exige iniciar outra leitura de metadados.
- Manter um coordenador de metadados por objeto nativo retido. Ele preserva
  uma unica operacao assincrona entre polls; consulta seu estado sem esperar
  nem reinicia-la a cada tick. `GetResults` ocorre somente quando concluida.
- `MediaPropertiesChanged` invalida a versao de metadados. O callback apenas
  sinaliza uma geracao atomica. Refresh periodico limitado oferece fallback
  se o evento nao chegar. Seek/timeline nao invalidam o cache por si mesmos.
- Deadline unico por operacao e backoff impedem espera/retry ilimitados.
  Remocao, `Closed`, troca de objeto ou falha do manager cancelam a operacao
  e eliminam seu cache. Resultado antigo nunca entra na aba nova.
- A operacao tem prazo de 8 s; retries usam 1/2/4/5 s. Contexto invalidado
  expira em 12 s; falha de playback permite no maximo 4 s de contexto sem
  transporte. Refresh de seguranca usa 30 s, ou 8 s sem assinatura de evento,
  em background enquanto o cache continua valido.
- Cache de apresentacao depende de identidade ainda enumerada. Um erro de
  playback nao equivale a `Closed`; pode reter contexto por tempo limitado,
  sem autorizar transporte. Metadados invalidados ficam em atualizacao por
  prazo finito, com controles bloqueados. Um fechamento real continua vazio.
- Falha persistente de metadados de uma sessao viva inicia redescoberta com
  backoff, mesmo que `GetSessions` continue funcionando. Uma falha observada
  nao e apresentada silenciosamente como se nenhum player existisse.
- Tokens continuam opacos, exclusivos do objeto retido; comandos nunca usam
  AUMID como identidade nem tem fallback para outra aba. Skip nao e repetido.
- Diagnostico local limitado usa o log existente para etapa/HRESULT/contagens
  e recuperacao, sem registrar titulo, artista, capa ou URLs.

## 3. Contrato de dados e IPC

`media_snapshot` / `media_control` e os eventos mantem seus nomes e parametros.
O snapshot acrescenta `sessionUpdating: boolean` (false por padrao). O cliente
aceita a ausencia do campo como false, preservando fixtures e compatibilidade.
O cache inicial do worker Windows comeca com true, antes de `RequestAsync`,
para nao anunciar catalogo vazio enquanto o manager ainda esta iniciando.

- Sessao + false: metadados e playback utilizaveis; transporte pode operar.
- Sessao + true: contexto nativo conhecido em recuperacao; apresentar a faixa
  com indicacao de atualizacao e bloquear transporte, preservando volume.
- Sem sessao + true: existe descoberta/leitura inicial pendente; mostrar busca,
  sem fabricar faixa. Nao confundir com catalogo vazio.
- Sem sessao + false + sem erro: ausencia real; permanece a carencia visual de
  2.500 ms para a transicao de fechamento.
- Erro: falha observavel com tentativa automatica limitada, nunca outro player
  escolhido como alvo de um comando antigo.

Ticks nao promovem uma sessao em atualizacao para pronta. Revisao e sequencia
continuam ordenando mensagens; alteracao de `sessionUpdating` e semantica.
O painel reconcilia o cache ao recuperar foco, sem iniciar outro worker, enviar
transporte, roubar foco das ilhas ou fazer polling adicional por WebView.
Nenhuma alteracao de banco, preferencias, janelas, shell ou atalhos.

## 4. Riscos e rollback

O cache nao pode esconder encerramento nem sobreviver a outra identidade. O
coordenador precisa cancelar operacoes vencidas e remover operacoes/assinaturas
quando seus objetos saem do catalogo. Eventos concorrentes devem provocar nova
atualizacao, sem marcar metadados antigos como atuais. A espera assincrona
ocorre entre ciclos do worker, sem bloquear controles pela duracao inteira.
Getters COM sincronicos continuam sujeitos ao provedor Windows; este codigo
nao consegue cancela-los. Reverter esta revisao restaura `717b5dd`, sem migration.

## 5. Validacao

O mesmo coordenador usado pelo adaptador WinRT sera testado no host com provider
controlado e relogio virtual: leitura inicial acima de 2 s, seeks repetidos,
metadados dirty, eventos durante operacao, falha e retry, remocao/Closed,
duas abas do mesmo app e resultado tardio descartado. Nao basta testar ranking.

Frontend: seek frente/tras/zero, timeline ausente, carregamento inicial nativo,
atualizacao com contexto retido, ticks durante atualizacao, fechamento real e
nova WebView/leitura do cache. Validar o listener de foco e sua limpeza.

Executar `npm test`, `npm run build`, testes Rust portaveis e `cargo check`
Windows com testes. Chromium verifica componentes reais com fronteira IPC
controlada. A reproducao de SoundCloud/Opera no Windows real continua pendente.

### Resultados

- `npm test`: 146 aprovados, incluindo 39 de midia e 10 de reconciliacao.
  Os novos testes reproduziram quatro falhas do contrato de recuperacao,
  uma corrida de leitura quiet/explicita e duas falhas de erros de transporte
  antes das respectivas correcoes.
- `npm run build`: aprovado; permanece o aviso existente de importacao
  estatica/dinamica do modulo Tauri de eventos.
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --target
  x86_64-pc-windows-gnu --tests -j3`: aprovado, sem warnings. Compila os testes
  Windows, sem executar WinRT no host Linux.
- `rustc --edition=2021 --test src-tauri/src/media_metadata.rs`: 16 aprovados.
  O mesmo coordenador de producao completa uma leitura de 3 s sem cancelamento
  ou reinicio, preserva metadados em seeks, rejeita geracoes antigas, respeita
  backoff/prazos e limpa operacoes/assinaturas de objetos removidos.
- `rustc --edition=2021 --test src-tauri/src/media_policy.rs`: 4 aprovados.
- Chromium com componentes/cliente/store reais e IPC controlado: 15 cenarios
  aprovados, sem erros de console. Incluem seek frente/tras/zero/timeline nula,
  descoberta e recuperacao acima de 2,5 s em movimento normal/reduzido,
  fechamento real, foco/reconciliacao, respostas antigas e recusa de skip sem
  reenvio. Uma revisao pendente ou de volume nao mascara erro de transporte.

A dependencia Windows `windows-future` foi declarada explicitamente para reter
`IAsyncOperation` tipada. A versao 0.3.2 ja era dependencia transitiva de
`windows`; o lockfile so acrescenta a aresta direta do pacote do aplicativo.
