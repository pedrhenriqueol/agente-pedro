# Faixa nativa atrás das ilhas — 15/10/2026

## Antes e diagnóstico

O usuário confirmou o fim da piscada após `7bbbe85`, mas relatou uma faixa
azul com ícone e título atrás dos três widgets. Na captura do controle direito,
o texto é `Agente Pedro - Volume`, correspondente ao HWND configurado.

A análise do Tao identificou os estilos de legenda ainda presentes em
janelas sem decoração. A repintura do recorte expôs essa área nativa. As
atualizações de interação também podem regravar esses estilos; o defeito
não corresponde a um fundo ou elemento da interface React.

## Correção

O [desenho técnico](SYSTEM_DESIGN_WIDGET_CAPTION.md) limita a proteção aos
três widgets. Uma política persistente retira legenda e bordas decorativas
no estilo inicial e nas futuras regravações do Tao. Todos os demais bits de
visibilidade, foco, cursor, transparência, composição e taskbar são preservados.

O resultado esperado é a interface sem a faixa do Windows, conservando o
viewport estável, o recorte, as transições e o retorno híbrido já existentes.
O ajuste não muda tamanho, posição, curvas, dados ou a janela principal.

## Evidências e limite

- **117 testes Node aprovados**, sem falhas ou testes pulados.
- **Três testes Rust portáteis executados e aprovados**: escopo dos widgets,
  máscaras idempotentes e preservação dos flags operacionais.
- **Build TypeScript/Vite aprovado**, com o aviso já existente de importação
  estática/dinâmica de `@tauri-apps/api/event.js`.
- **Cargo check Windows GNU com `--locked --tests` aprovado**, sem warnings.
  Três testes Win32 com HWND oculto foram compilados: regravações de estilo,
  recortes, bounds client/outer, instalação na thread correta, zero válido nas
  APIs e substituição reentrante que deve preservar os flags novos do cursor.
  Esses testes nativos **não foram executados neste Linux**.
- Revisão independente aprovada: cadeia das subclasses, limpeza no destroy,
  tratamento de erros, geração e flags de foco/transparência preservados.

Apenas `Win32_System_Threading` foi declarada explicitamente para a verificação
de thread; nenhuma versão, crate ou lockfile mudou. O frontend e as curvas da
animação não foram alterados. O novo módulo nativo é `widget_chrome.rs`.

Evidência estruturada em
[qa/WIDGET_CAPTION_2026-10-15.json](qa/WIDGET_CAPTION_2026-10-15.json).

Este ambiente Linux não executa a pintura não cliente do Win32: uma captura
Chromium não comprovaria a remoção dessa legenda. O resultado gráfico final
exige recompilar e conferir no Windows.

## Conferência no Windows

Após atualizar a `main`, executar `npm run tauri build` e abrir o novo `.exe`.
Repetir abertura e recolhimento da central, aparência à esquerda e som à
direita; verificar a ausência de faixa/título nativos. Alternar modo híbrido,
ocultação/retorno e escala 100/125/150%, mantendo a fluidez confirmada.
Conferir também cliques fora da região compacta e o foco da janela ativa.

Para executar os seis testes dessa política no Windows, incluindo os três
que usam HWND oculto:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib widget_chrome -- --test-threads=1
```
