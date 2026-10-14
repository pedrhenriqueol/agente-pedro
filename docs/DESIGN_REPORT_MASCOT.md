# Mascote e identidade do Pedro — 14/10/2026

## Objetivo e direção

Substituir a marca textual `p.` por um único personagem original que represente
o aplicativo em todas as superfícies. A direção escolhida é uma capivara
esmeralda: rosto amplo, orelhas pequenas, expressão tranquila e focinho creme.
Um único mascote mantém a identidade reconhecível entre contextos.

O conceito foi explorado por geração de imagem e simplificado em um SVG
próprio para ícones pequenos. O vetor é o master de produção; não utiliza
assets ou personagens do Niko. Paleta: esmeralda `#10b981`, jade `#6ee7b7`,
creme `#fff3dc` e detalhes escuros `#0c0e14`, com fundo transparente.

## Aplicação

- Ilha compacta: slot de 16 px; botão de menu expandido: 20 px.
- Painel: marca de 36 px na lateral e 40 px no carregamento/erro.
- Prévia de aparência: 16 px, preservando a substituição pela capa musical.
- Executável e bandeja: PNGs em várias resoluções e ICO Windows.
- Navegador: favicon SVG gerado do mesmo master.

O componente `PedroMascot` é decorativo, sem nomes acessíveis duplicados,
sem eventos próprios e sem estado. Os botões mantêm suas áreas clicáveis,
nomes, foco e ações. Capa musical, timer e saldo conservam sua informação.

## Movimento

Repouso estático. No hover/foco do botão da ilha, reconhecimento de 1 px;
no clique, escala de 0,94 durante 140 ms. Sem intervalos ou loops animados.
As preferências de movimento reduzido do aplicativo e do sistema removem
essas reações. A animação não altera as dimensões ou a geometria da janela.

## Fonte e regeneração

Master: `src/assets/pedro-icon.svg`. Com as dependências instaladas, executar:

```sh
node scripts/generate-app-icons.mjs
```

O script usa o gerador do Tauri já instalado, produz em uma pasta temporária
e atualiza apenas os seis arquivos usados pelo aplicativo Windows. O símbolo
fixo esmeralda mantém sua identidade quando o usuário troca o acento da UI.

## Validação

Validação concluída: 96 testes aprovados, TypeScript/Vite e cargo check Windows
aprovados. Chromium confirmou tamanhos reais 16/20/36/40 px, SVG carregado,
menu/Escape, temas claro/escuro, movimento reduzido e preservação das capas
musicais, sem erros JavaScript. PNGs RGBA e ICO têm transparência e resoluções
válidas, inclusive 16 px. O favicon do build referencia o SVG com hash gerado.
Capturas em `/workspace/pedro-mascot-preview`; a pintura nativa no Windows
permanece dependente da reconstrução e execução local.
O ícone do executável é atualizado ao reconstruir
o release; não se altera Explorer, registro, identificador ou nome do produto.
