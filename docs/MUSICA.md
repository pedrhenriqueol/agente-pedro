# Música no Agente Pedro

A integração lê a reprodução que o navegador ou player publica nos controles de mídia do Windows. Não usa a API do SoundCloud, uma assinatura, chave de API ou provedor de IA. O usuário continua ouvindo no serviço de sua escolha.

## Usar no Windows

1. Prepare o desktop com os requisitos do README e execute `npm ci` e `npm run tauri dev` na pasta do projeto.
2. Abra o SoundCloud no Chrome ou Edge no mesmo Windows e inicie uma música.
3. Abra a área **Música** no Pedro ou expanda a atividade da ilha. Se ela estiver mostrando o foco, use **Ver música**. A faixa, artista e capa aparecem conforme os metadados publicados pelo navegador.
4. Use pausa/reprodução, anterior e próxima quando disponíveis. Na ilha, o volume fica em **Menu → Ajustes rápidos**; no painel, fica no player. Ele altera a saída padrão do Windows, incluindo os outros aplicativos; aumentar um volume positivo também retira o mudo da saída.

A ilha compacta mostra a faixa automaticamente quando não há foco ativo ou pausado nem um registro de foco pendente. Foco e Música continuam acessíveis pela ilha expandida. O painel não precisa ficar aberto para acompanhar a reprodução.

O Pedro acompanha a sessão atual que está tocando no Windows. Se outra reprodução passar a ser a sessão ativa, a interface pode mudar para ela. Comandos de faixa enviados para uma sessão antiga são recusados, evitando controlar outro player inadvertidamente.

Na troca entre músicas, uma ausência transitória conserva brevemente a capa e os metadados anteriores com indicação de atualização, por até 1.150 ms. Progresso fica congelado e transporte desabilitado até chegar a sessão real. Novas amostras vazias não prolongam esse prazo; erros aparecem imediatamente. Fechar o player continua levando ao estado vazio verdadeiro.

Se nenhuma reprodução aparecer, confirme que o site está tocando e que os controles de mídia do próprio Windows reconhecem a faixa. Sites, navegadores e players que não publicam uma sessão de mídia não podem ser detectados por esta integração. Capa, artista, duração e anterior/próxima podem não ser fornecidos pelo player. Não são substituídos por dados fictícios.

## Implementação

- `src-tauri/src/media.rs` usa [GlobalSystemMediaTransportControlsSessionManager](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager) para metadados e transporte, e Core Audio para o volume do sistema.
- Um worker nativo consulta a reprodução aproximadamente a cada segundo e atende todas as janelas. As chamadas assíncronas ao Windows têm limite de espera; nenhum processo PowerShell ou serviço HTTP adicional é necessário.
- `media_snapshot` devolve o estado atual. `media_control` revalida a sessão e as capacidades antes de executar um comando. Uma recusa do player é apresentada como erro.
- `pedro:media` publica mudanças de faixa, capa, estado ou volume. `pedro:media-position` carrega somente posição e duração, evitando retransmitir a capa a cada tick.
- Revisão, sequência e identidade da sessão impedem que respostas atrasadas substituam metadados ou progresso mais recentes. O instante e a taxa de reprodução informados pelo Windows ancoram o progresso.
- Capas raster são lidas da sessão com limite de 2 MB e cache. Não há scraping do SoundCloud nem busca de imagens em URLs arbitrárias.
- `useMediaStore` compartilha um transporte por WebView, preserva erros e restabelece listeners pela ação de tentar novamente. A sessão autoritativa é separada dos metadados de apresentação; a fila revalida transporte antes de executar e serializa ajustes de volume.
- `MusicPlayer` é usado no painel e na ilha com os temas, cores e movimento reduzido existentes. A música não altera tarefas, sessões de foco ou dados financeiros.

A implementação é própria do Agente Pedro, baseada nas APIs públicas do Windows. O Niko foi consultado para identificar o mecanismo; código, personagens e recursos visuais desse projeto não foram incorporados.

## Validação e limites

Testes automatizados exercitam o store e o cliente reais com apenas a fronteira IPC do Windows simulada: eventos fora de ordem, capacidades, fila de volume, falhas, recuperação e limpeza de listeners. A interface é verificada no Chromium com uma sessão de teste isolada; isso não representa uma conexão real com o SoundCloud.

O backend foi checado com `cargo check --locked --target x86_64-pc-windows-gnu --tests`. A checagem cruzada verifica tipos e integração Tauri, mas não executa WinRT, WebView2 ou áudio em Windows. O preview do navegador e outros sistemas exibem um estado de integração indisponível.

O teste final no Windows deve confirmar a capa/faixa do SoundCloud, pausa e continuação nas duas apresentações, troca de faixa, atualização após fechar o player, volume do sistema e continuidade do foco ao usar a música. Empacotamento e instalador também exigem validação no Windows.
