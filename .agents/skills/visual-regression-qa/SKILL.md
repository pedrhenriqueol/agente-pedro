---
name: visual-regression-qa
description: Auditoria de qualidade perceptual e prevencao de regressao visual no Agente Pedro. Utilize para validar alteracoes de interface, integridade de layout, comportamento sobreposto a outros apps e qualidade de movimento.
---

# Visual Regression QA & Validacao Perceptual

## Visao Geral
O Agente Pedro vive sobre a area de trabalho do Windows. Uma alteracao visual nao esta pronta apenas porque o build passou ou o teste de unidade teve sucesso; ela precisa ser perceptualmente impecavel e funcional.

## Niveis Obrigatorios de Evidencia
1. **Build e Compilacao:** npm run build e cargo check sem erros.
2. **Testes Automatizados:** npm test (42+ testes passando sem falhas).
3. **Renderizacao Real:** Interface monta sem erros no console (sem avisos de layout quebrado ou missing props).
4. **Interatividade e Z-Index:** Cliques, hovers e atalhos funcionam sem bloquear outros aplicativos.
5. **Comportamento Nativo:** Transparencias corretas, sem artefatos pretos nas bordas e sem roubo de foco indevido.

## Checklist de Aprovacao Visual
- [ ] **Estado Compacto:** A ilha e o dock exibem informacoes essenciais com tipografia nitida.
- [ ] **Transicao de Abertura:** A expansao ocorre suavemente, sem teleporte de elementos.
- [ ] **Estado Expandido:** Menus e controles estao perfeitamente alinhados e acessiveis.
- [ ] **Fechamento e Reversao:** O recolhimento restaura o tamanho original sem deixar fantasmas na tela.
- [ ] **Teste de Interrupcao:** Clicar rapidamente durante a animacao nao quebra o estado interno.
- [ ] **Integridade com o Desktop:** Janelas externas e barra de tarefas do Windows continuam interativas.

## Procedimento em Caso de Regressao
1. Isole a regressao (CSS, timing de estado Zustand ou redimensionamento de janela Tauri).
2. Verifique se o erro ocorre em preview (browser) ou apenas no runtime nativo Windows.
3. Se houver descontinuidade visual, simplifique o layout antes de tentar compensar com delays artificiais.
