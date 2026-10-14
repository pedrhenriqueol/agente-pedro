# Design Report — Ilha contextual

## 1. Identificação e escopo

DynamicIsland, player, Hoje e aparência. Data: 2026-10-13. Aproximar a hierarquia e a continuidade das referências enviadas, preservando paleta industrial e identidade Pedro.

## 2. Estado anterior

Cabeçalho de 48px com identidade e dois botões permanentes, largura igual nos estados compacto/expandido, menus em listas e player vertical. A expansão depende de clique e o modo híbrido esconde o HWND imediatamente. Isso diminui o contraste entre repouso e uso e torna a navegação pesada.

## 3. Direção e tokens

Repouso reduzido, toolbar fina por ícones, chip do contexto selecionado, conteúdo largo abaixo e ajustes alinhados à direita. Player horizontal com capa, metadados, progresso e controles agrupados. Agenda/calendário local. Superfícies #0c0e14/#121620, acento #10b981, bordas discretas e raios contínuos. Nenhum asset ou personagem do Niko.

## 4. Motion

Intenção de hover antes de abrir; expansão de largura/altura em até 250ms, entrada do conteúdo sobreposta à geometria. Saída curta do conteúdo antes do recolhimento. Ocultação/retorno usam opacidade e pequeno deslocamento para o topo, com geração nativa e confirmação. Reversões partem da apresentação atual. Movimento reduzido evita morphing longo.

## 5. Evidências

- `npm test`: **93 aprovados**, zero falhas e zero testes pulados.
- `npm run build`: TypeScript e bundle Vite aprovados.
- `cargo check --locked --target x86_64-pc-windows-gnu --tests -j3`: aprovado. O crate Windows foi compilado, não executado neste Linux.
- **24 testes Rust portáveis executados no host**: 19 de visibilidade/animação e 5 dos cantos, usando os blocos reais de política.
- Chromium: 15 cenários da ilha e 6 dos cantos aprovados, além de 271 amostras de limites durante mudanças de altura com IPC lento. Confirmados hover, teclado, saída/retorno, reversões, recuperação de falhas e rascunhos preservados.
- Player horizontal revisado em 560/480/390/310px: sessão obsoleta bloqueada, capacidades, pendência, volume, capa indisponível, tema claro e movimento reduzido.
- Agenda: datas locais, criação/conclusão persistidas, falha de armazenamento, hábitos sem duplicação, teclado e layouts de 390/480/560px.
- Preferências no popup e painel: persistência, cores validadas, contraste, categorias e layouts de 1280/760/390px.

Prévia gerada em `/workspace/pedro-island-redesign-preview`: MP4 H.264 de **33,92 segundos, 1280×720**, quatro PNGs, galeria HTML offline e ZIP. A gravação usa três rotas reais do App no Chromium, dados locais isolados e uma sessão musical de demonstração. Geometria, visibilidade e mídia são fornecidas na fronteira IPC. Não grava áudio, SoundCloud real, WinRT ou o desktop Windows. Nenhum erro JavaScript na sequência capturada.

Correções encontradas na revisão: largura de expansão baseada na área do monitor em vez do viewport compacto; preparação FIFO ao reabrir durante shrink pendente; encolhimento compacto após o CSS; foco de teclado devolvido após retirar inert; pose transparente mantida antes do ShowWindow; popups medidos incluindo bordas e limitados ao frame confirmado; OFF nativo nunca restaura visibilidade em rollback.

A paleta industrial, os stores transacionais, o banco e os arquivos de skills/templates do usuário foram preservados. Monitor selecionável e indicadores de rede/bateria não foram adicionados nesta etapa. O comportamento físico de HWND, foco, DPI e cliques entre aplicativos ainda requer a conferência Windows descrita em [ILHA_HIBRIDA.md](ILHA_HIBRIDA.md).
