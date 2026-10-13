---
name: desktop-design-system
description: Especializacao no design system, hierarquia visual e estetica industrial do Agente Pedro. Utilize ao criar ou refatorar componentes visuais, tipografia, espacamento, paleta de cores, densidade de informacao e consistencia de estilo.
---

# Desktop Design System — Agente Pedro

## Tokens de Identidade
A estetica do Agente Pedro e industrial, limpa e funcional, focada em produtividade executiva sem ruido decorativo.

- **Fundo Primario:** #05070a (ambiente escuro absoluto)
- **Superficie / Cartoes:** #0c0e14 e #121620 (camadas de elevacao)
- **Bordas Sutis:** #1e2633 (divisores com opacidade controlada)
- **Cor de Acento (Emerald):** #10b981 (hover: #059669)
- **Texto:**
  - Primario: #f8fafc
  - Secundario / Muted: #94a3b8
  - Sutil / Labels: #64748b
- **Status:** Perigo (#ef4444), Alerta (#f59e0b)

## Arquivos Relevantes
- tailwind.config.js: Definicao oficial da paleta industrial.
- src/styles/index.css: Variaveis de superficie, reset e classes utilitarias.
- src/components/ui/Dialog.tsx: Padrao de acessibilidade e modais.
- src/components/CustomTitleBar.tsx: Moldura e controles superiores.

## Principios de Composicao
1. **Menos Elementos, Maior Clareza:** Evite telemetria decorativa ou badges vazios que nao agregam decisao ao usuario.
2. **Uso Intencional do Verde (#10b981):** O acento esmeralda deve indicar acoes primarias, progresso ativo ou status saudavel. Nunca pinte areas extensas de verde.
3. **Consistencia de Bordas e Raios:**
   - Containers externos / Ilha / Dock: rounded-2xl ou rounded-full.
   - Cartoes e modais: rounded-xl ou rounded-lg.
   - Botoes e inputs: rounded-lg.
4. **Evitar Copias Proprietarias:** Preserve a identidade original do Agente Pedro. Nao incorpore assets, logos ou marcas de outros aplicativos.

## Procedimento de Implementacao
1. Verifique sempre se ha uma classe utilitaria existente em tailwind.config.js antes de criar inline styles.
2. Mantenha suporte a telas compactas e redimensionamento fluido no console (minWidth: 760, minHeight: 600).
