# Design Report — desktop discreto e contínuo

## 1. Identificação e escopo

- **Superfícies:** ilha, música, navegação do painel e personalização.
- **Objetivo:** atividade reconhecível entre estados; navegação acessível sem depender de quatro botões permanentes.
- **Responsável:** Codex.
- **Data:** 2026-10-13, referência do cliente America/Sao_Paulo.

## 2. Estado atual e fricções

- Capa/título desaparecem durante expansão; conteúdos se sobrepõem ao recolher.
- Snapshot transitório vazio mostrava onboarding entre faixas.
- Dock e sidebar repetem destinos; ilha de música mistura contexto financeiro.
- Páginas remontadas descartam campos locais; transparência pode reduzir leitura sobre wallpapers.

Essas fricções descrevem o estado anterior. Na entrega, o cabeçalho é persistente, os destinos ficam no menu, a apresentação de mídia tem prazo limitado e as páginas visitadas conservam seu estado.

## 3. Direção e tokens

- Hierarquia: identidade/atividade → controle principal → ações secundárias em menu.
- Paleta: fundo `#05070a`, superfície `#0c0e14`, elevada `#121620`, borda `#1e2633`, acento `#10b981`, texto `#f8fafc`; variantes pessoais preservadas.
- Tipografia Windows/Segoe UI, texto de controles legível; raios externos de 16–24 px e controles de 8–12 px.
- Novo usuário recebe dock desligado; escolha explicitamente salva permanece.

## 4. Motion e microinterações

- Microinterações de 120–160 ms; conteúdo de 160–220 ms; ciclo de abertura/recolhimento da ilha de até 240 ms após preparar o frame nativo.
- Curva de desaceleração `cubic-bezier(0.16, 1, 0.3, 1)`; sem recalcular layout nativo por quadro.
- Um cabeçalho conserva capa/título; saída termina antes de retirar o espaço do conteúdo.
- Intenções rápidas cancelam timers e respostas antigas; ocultação híbrida encerra a apresentação sem interromper música/foco.
- Movimento reduzido usa transição mínima/imediata, mantendo os mesmos destinos e estados.

## 5. Critérios e evidências

- [x] No Chromium/IPC simulado, geometria visual cabe no frame preparado, sem cabeçalhos duplicados; inclui reversões rápidas, ocultação e respostas atrasadas após reabrir.
- [x] Menu funciona por botão, clique direito, Shift+F10, setas, Home/End, Enter/Space e Escape, com retorno de foco e rolagem até o item focado.
- [x] Páginas preservam campos, mas modais inativos não prendem teclado. QA inclui paleta aberta seguida de rota nativa para página com modal retido; Escape libera `root.inert` e o body.
- [x] Snapshot transitório não autoriza comandos antigos nem inventa reprodução. Vinte testes de mídia cobrem prazo, sessões antigas, erros e fila; troca de faixa conferida com movimento normal/reduzido local/reduzido do sistema.
- [x] 68 testes, build TypeScript/Vite e checagem Rust Windows GNU com `--tests` aprovados.
- [x] Chromium sem erros JavaScript, em temas escuro/claro e viewport compacto; viewport da ilha de 320 px e painel de 1280/760/390 px.
- [ ] Windows real: foco, material, bandeja, DPI e frame time. Pendência explícita até haver execução física.

## 6. Evidências visuais

Capturas finais do Chromium em tema escuro, com dados de preview separados do SQLite. Não são capturas de um executável Windows nem comprovam Mica/WinRT.

- [Personalização em quatro categorias](evidence/personalizacao.png).
- [Navegação recolhida](evidence/navegacao.png).
- [Menu ancorado da ilha](evidence/ilha-menu.png).
- [Ajustes rápidos](evidence/ilha-ajustes.png).

A referência anterior permanece nos vídeos e nos tempos descritos em [ANALISE_VISUAL.md](ANALISE_VISUAL.md). Nenhum asset ou código do Niko foi reutilizado.

## 7. Cenários de recuperação conferidos

- Expandir/recolher repetidamente, ocultar com expansão em voo e receber uma resposta antiga depois de reabrir: o estado atual conserva os limites corretos.
- Falhar ao crescer durante a troca de vista: recolher o frame antes de compactar. Se ambos os comandos falham, ocupar a altura confirmada, permitir rolagem e oferecer nova tentativa.
- Falhar ao reduzir depois da saída: restaurar a superfície à altura nativa confirmada, sem deixar uma área transparente permanente nem repetir resize em loop.
- Mensagem extensa: conteúdo rolável dentro da ilha; End mantém o último item visível mesmo no fallback menor.
- Música com movimento reduzido local ou do sistema: nenhuma capa ou título antigo opaco sobre a nova faixa.
- Modal financeiro retido, paleta e navegação externa: um único diálogo, rascunho preservado e teclado liberado após Escape.
