# Refatoração do Agente Pedro

## Base e escopo

A base foi o snapshot upstream `940610895d1ab7d9a1a15fd494170a0a4163c942` de `pedrhenriqueol/agente-pedro`. O checkout de trabalho recebeu uma baseline Git local sintética para revisão do diff; essa baseline não foi enviada ao repositório remoto.

O Niko foi usado como referência visual e de organização de conteúdo. As alterações desta entrega pertencem somente ao Agente Pedro.

## Mudanças

- Navegação estável entre Hoje, Rotinas e foco, Finanças e Aparência, com busca de áreas.
- Página Hoje com prioridades, hábitos, sessões concluídas e resumo financeiro baseados nos registros locais.
- Cards, formulários, estados vazios e mensagens reorganizados para explicar o próximo passo; temas e transições com movimento reduzido.
- Ilha e dock com atalhos úteis, preferências compartilhadas e dimensionamento nativo compatível com as animações.
- Pomodoro sincronizado entre janelas por comandos e prazo de conclusão, sem transmitir cada atualização do relógio. Sessões de foco usam ID compartilhado para evitar registros duplicados.
- Finanças com contas, movimentações e limites reais. A gravação de uma movimentação e a atualização do saldo são atômicas; falhas preservam os dados anteriores.
- Scripts de preparação portáteis, com `npm ci`, verificações de ferramentas e nenhuma dependência de caminhos pessoais do Antigravity.

## Preservação de dados

O banco continua sendo `sqlite:agente_pedro.db`. Tabelas existentes não são apagadas nem saldos históricos recalculados durante a inicialização. Novos triggers validam gravações e atualizam saldos somente em novas movimentações. No preview, a chave `agente_pedro_local_db` continua preservada; conteúdo ilegível gera erro em vez de ser substituído por um banco vazio.

Dados de preview no navegador e dados SQLite do desktop permanecem separados. Preferências e estado da sessão de foco têm armazenamento próprio.

## Validação e limites

- **29 testes automatizados** de banco, persistência e stores/sincronização, incluindo conexões SQLite alternadas e recuperação de uma sessão cujo salvamento falhou.
- Build da interface com TypeScript e Vite.
- Verificações no navegador dos fluxos, widgets, temas, responsividade e preservação dos formulários após falha de gravação.
- `cargo check` para o alvo Windows GNU passou. Isso verifica compilação cruzada, não execução nativa.

A execução das janelas transparentes, atalhos globais, posicionamento em monitores e SQLite via WebView2 ainda requer validação em Windows. Para desenvolvimento e empacotamento Windows, use Rust 1.90 ou superior e a toolchain MSVC com os requisitos descritos no README.

Esta entrega não fornece um instalador validado, integrações externas ou agentes de IA. O conteúdo apresentado usa as funcionalidades locais implementadas.
