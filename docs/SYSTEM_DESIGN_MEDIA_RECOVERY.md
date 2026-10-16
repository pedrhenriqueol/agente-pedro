# System Design — Recuperacao de midia apos troca de faixa

## 1. Contexto e problema

A base desta revisao e o commit `77b423b`, do Antigravity. A tolerancia de
2.500 ms e o fallback quando `GetCurrentSession` falha permanecem. Ainda ha
caminhos que selecionam uma aba fechada ou sem metadados, sem tentar outra,
e IDs baseados apenas no aplicativo nao distinguem duas abas do navegador.
No frontend, ticks podem reapresentar metadados vazios e uma leitura antiga
que falha pode derrubar uma faixa saudavel recebida depois por evento.

## 2. Arquitetura atual e proposta

- O worker GSMTC continua unico, em sua thread MTA. Sem scraping, servidor,
  chave de API, dependencia nova ou alteracao de dados persistidos.
- A selecao coleta candidatos de forma tolerante a falhas individuais,
  ignora `Closed`, prioriza `Playing` e tenta outro candidato quando a
  leitura falha ou os metadados ainda estao vazios. Ha um limite total por
  amostra, evitando multiplicar o timeout pelo numero de abas.
- O worker retem o objeto nativo selecionado com um token opaco de sua
  encarnacao. Identidade nativa igual pode preservar o token; identidade
  diferente recebe outro. Nome do aplicativo, titulo e posicao nao bastam
  para identificar uma aba. Uma eventual troca de proxy pode renovar o
  token, sem apagar a apresentacao nem encaminhar controles para outra aba.
- Transporte exige o token da selecao retida, revalida estado/capacidades
  e atua naquele objeto. Nao reescolhe uma sessao por aplicativo e nao tem
  fallback para outro player. A acao nunca e repetida automaticamente.
- Falhas de uma aba permitem tentar as demais; falhas de enumeracao do
  manager ficam observaveis e provocam sua reconstrucao com intervalo de
  tentativa limitado. Uma recusa de transporte tambem provoca nova leitura.
- A store aplica uma unica regra de conteudo (titulo ou artista nao vazio)
  a snapshots, ticks e fim da carencia. A ultima faixa pode permanecer
  apenas como apresentacao durante a transicao; seus controles ficam
  indisponiveis. Falhas de leitura antigas nao substituem eventos novos.

## 3. Dados e IPC

Os comandos `media_snapshot` e `media_control`, seus parametros e os eventos
`pedro:media` / `pedro:media-position` preservam o contrato atual. O ID e um
token opaco valido somente no processo, sem persistencia. Revisao e sequencia
continuam protegendo mensagens fora de ordem. Volume do sistema permanece
independente de uma sessao musical.

## 4. Riscos e limites

Nenhuma alteracao de janela, foco, atalhos, shell ou banco de dados. Retencao
visual nunca autoriza comando sobre uma aba anterior. Sem correspondencia
segura, o comando e recusado e a descoberta e atualizada; um skip nao e
repetido porque pode ja ter sido aceito pelo navegador antes de um timeout.
Artwork e opcional e deve respeitar o orcamento da amostra. O Windows pode
atrasar ou omitir metadados; a carencia continua limitada, sem fabricar faixa.
Os deadlines limitam esperas assincronas e a busca entre candidatos; chamadas
COM sincronas nao oferecem cancelamento por este mecanismo.

Rollback: reverter o commit desta revisao, preservando `77b423b` e a correcao
visual anterior. A alteracao nao cria migrations nem muda configuracoes.

## 5. Validacao

- Regressoes da store com IPC controlado: faixa temporariamente vazia,
  ticks durante transicao, carencia limitada, leitura antiga rejeitada apos
  evento novo, transporte recusado e resposta fora de ordem.
- Politica nativa exercitada com candidatos simulados: aba fechada/falha
  antes de outra valida, dois players do mesmo app, token antigo e limites
  de tempo. Esses testes nao simulam o comportamento COM real.
- `npm test`, `npm run build` e `cargo check` para Windows, incluindo testes.
- A reproducao fisica com SoundCloud/Opera ou Chrome no executavel Windows
  permanece necessaria: skip pelo Pedro e pelo navegador, autoplay, duas
  abas e fechamento/reabertura. O ambiente de desenvolvimento e Linux.

### Evidencias desta revisao

- `npm test`: 127 aprovados, incluindo 30 de midia e 10 regressoes novas.
  Sete regressoes reproduziram falhas na base antes da correcao.
- `npm run build`: aprovado. Continua o aviso ja existente do Vite sobre
  importacao estatica/dinamica de `@tauri-apps/api/event`.
- `cargo check --manifest-path src-tauri/Cargo.toml --locked --target
  x86_64-pc-windows-gnu --tests -j3`: aprovado; compila, sem executar WinRT.
- Quatro testes da politica compartilhada executados no host com
  `rustc --edition=2021 --test src-tauri/src/media_policy.rs`: aprovados.
- Chromium: seis cenarios aprovados com painel/ilha e IPC nativo simulado,
  sem erros JavaScript. Incluem metadados vazios/ticks em movimento normal e
  reduzido, fechamento com prazo limitado, leitura antiga falhando, tokens
  distintos de abas e recusa de skip sem reenvio automatico. Isso verifica
  componentes, store e cliente reais, sem comprovar COM, audio ou WebView2.
