---
name: react-motion-design
description: Especializacao em animacoes organicas, morphing e motion design no React para o Agente Pedro. Utilize ao implementar transicoes de estado na Dynamic Island, expansao/recolhimento do dock, menus contextuais e microinteracoes.
---

# React Motion Design & Interacoes Organicas

## Filosofia Visual
Uma animacao deve explicar a mudanca de estado e respeitar a continuidade espacial. A Dynamic Island deve parecer uma unica superficie que se transforma, nunca uma sucessao de caixas piscando.

## Arquivos Relevantes
- src/components/DynamicIsland.tsx: Ilha compacta, expandida, selecao de abas e animacao de redimensionamento.
- src/components/DesktopDock.tsx: Dock inferior com efeitos de hover, selecao e indicador ativo.
- src/styles/desktop.css e src/styles/index.css: Variaveis de transicao e keyframes.

## Regras Obrigatorias
1. **Superficie Unica:** O container externo anima de forma fluida antes ou simultaneamente ao conteudo interno. Nunca deixe conteudo visual transbordar antes do container terminar a expansao (overflow: hidden estruturado).
2. **Animacoes Interrompiveis e Reversiveis:** Se o usuario fechar a ilha no meio de uma abertura, a animacao deve retornar suavemente do ponto atual, sem saltos abruptos.
3. **Performance Perceptual:** Priorize propriedades aceleradas por hardware (transform, opacity). Evite forcar recalculacao de layout em loop.
4. **Acessibilidade (Reduced Motion):** Respeite a media query prefers-reduced-motion. Nestes casos, substitua morphing longo por fade discreto e rapido (< 100ms).
5. **Duracoes Recomendadas:**
   - Microinteracoes (hover, clique, toggle): 120ms a 180ms.
   - Transicoes de painel / expansao da Island: 200ms a 280ms.
   - Easing: Curvas suaves de desaceleracao (ex: cubic-bezier(0.16, 1, 0.3, 1)).

## Procedimento de Implementacao
1. Mapeie os estados visualmente: Fechado, Expandindo, Aberto, Recolhendo.
2. Garanta sincronia entre o tamanho da janela nativa (expandir_ilha em Tauri) e a altura do elemento DOM.
3. Teste interrupcoes rapidas: clique rapido para abrir e fechar repetidamente.
4. Valide a renderizacao em 60fps sem engasgos de processamento.
