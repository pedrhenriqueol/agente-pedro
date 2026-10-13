# Design Report — Agente Pedro

## 1. Identificacao e Escopo
- **Componente / Superficie:** [ex: Dynamic Island, Desktop Dock, Console Main]
- **Objetivo Visual:** [ex: Reduzir friccao perceptual na expansao da ilha]
- **Responsavel:** [Agente / Desenvolvedor]
- **Data:** YYYY-MM-DD

## 2. Estado Atual e Problemas Perceptuais
- **Comportamento Atual:** [Descricao concisa]
- **Pontos de Friccao:** [ex: Recorte de borda, transicao abrupta, excesso de telemetria visual]
- **Densidade de Informacao:** [ex: Excesso de elementos competindo por atencao]

## 3. Direcao Proposta & Tokens
- **Hierarquia Visual:** [Camadas primarias, secundarias e acentos]
- **Paleta Utilizada:** [Fundo #05070a, Superficie #0c0e14, Acento #10b981]
- **Tipografia e Escala:** [Tamanhos, pesos e contraste]
- **Raio e Bordas:** [rounded-2xl, bordas #1e2633]

## 4. Motion & Microinteracoes
- **Timeline Perceptual:** [ex: Expansao da moldura em 220ms, fade-in do conteudo em 180ms]
- **Curva de Easing:** [ex: cubic-bezier(0.16, 1, 0.3, 1)]
- **Comportamento de Interrupcao:** [Como a animacao responde a cliques rapidos de fechamento]
- **Acessibilidade:** [Comportamento sob prefers-reduced-motion]

## 5. Criterios de Aprovacao & Evidencias
- [ ] Nao quebra outros componentes vizinhos
- [ ] Nao rouba foco da janela ativa do Windows
- [ ] Testes automatizados passando (npm test)
- [ ] Evidencias visuais validadas no runtime nativo
