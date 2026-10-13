# Refatoração do Agente Pedro

## Base e escopo

A base foi o commit upstream `940610895d1ab7d9a1a15fd494170a0a4163c942` de `pedrhenriqueol/agente-pedro`. A integração usa o clone e o histórico originais do GitHub. O patch recebido foi conferido pelo SHA-256 `3e045fd9d2a1920e694baabaf21a81a50ed026467c463d4297428e6e6b0f689c` e aplicado sem conflitos; a baseline sintética usada na preparação anterior não foi importada.

O Niko foi usado como referência visual e de organização de conteúdo. As alterações desta entrega pertencem somente ao Agente Pedro.

## Mudanças

- Navegação estável entre Hoje, Rotinas e foco, Finanças e Aparência, com busca de áreas.
- Página Hoje com prioridades, hábitos, sessões concluídas e resumo financeiro baseados nos registros locais.
- Cards, formulários, estados vazios e mensagens reorganizados para explicar o próximo passo; temas e transições com movimento reduzido.
- Ilha e dock com atalhos úteis, preferências compartilhadas e dimensionamento nativo compatível com as animações.
- Pomodoro sincronizado entre janelas por comandos e prazo de conclusão, sem transmitir cada atualização do relógio. Sessões de foco usam ID compartilhado para evitar registros duplicados.
- Ticks consultam o estado mais recente antes de concluir uma sessão, respeitando pausa, reinício e troca de sessão feitos em outra janela mesmo quando o evento chega atrasado.
- Finanças com contas, movimentações e limites reais. A gravação de uma movimentação e a atualização do saldo são atômicas; falhas preservam os dados anteriores.
- Scripts de preparação portáteis, com `npm ci`, verificações de ferramentas e nenhuma dependência de caminhos pessoais do Antigravity.

## Preservação de dados

O banco continua sendo `sqlite:agente_pedro.db`. Tabelas existentes não são apagadas nem saldos históricos recalculados durante a inicialização. Novos triggers validam gravações e atualizam saldos somente em novas movimentações. No preview, a chave `agente_pedro_local_db` continua preservada; conteúdo ilegível gera erro em vez de ser substituído por um banco vazio.

Dados de preview no navegador e dados SQLite do desktop permanecem separados. Preferências e estado da sessão de foco têm armazenamento próprio.

## Validação e limites

- **30 testes automatizados** de banco, persistência e stores/sincronização, incluindo conexões SQLite alternadas, recuperação de uma sessão cujo salvamento falhou e ticks atrasados após comandos de outra janela.
- A integração inicial de [música](MUSICA.md) acrescentou 12 cenários de IPC, controles e recuperação, totalizando **42 testes** naquela entrega. Com visibilidade híbrida, preferências e continuidade de mídia, a suíte atual tem **68 testes**.
- Build da interface com TypeScript e Vite.
- Verificações no navegador dos fluxos, widgets, temas, responsividade e preservação dos formulários após falha de gravação.
- `cargo check` para o alvo Windows GNU passou. Isso verifica compilação cruzada, não execução nativa.

A execução das janelas transparentes, atalhos globais, posicionamento em monitores e SQLite via WebView2 ainda requer validação em Windows. Para desenvolvimento e empacotamento Windows, use Rust 1.90 ou superior e a toolchain MSVC com os requisitos descritos no README.

Esta entrega não fornece um instalador validado, integrações externas ou agentes de IA. O conteúdo apresentado usa as funcionalidades locais implementadas.
