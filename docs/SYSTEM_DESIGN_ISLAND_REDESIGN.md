# System Design — Ilha contextual

## 1. Contexto e problema

Em 2026-10-13, a ilha usa largura constante de 380px, abertura manual e ocultação nativa imediata. As referências visuais mostram repouso mínimo, expansão por aproximação, toolbar discreta, player horizontal e personalização contextual. O pedido autoriza implementar e publicar na main. A identidade e os dados locais do Pedro continuam como base.

## 2. Arquitetura atual vs proposta

A superfície compacta passa a 96×24px em repouso e 280×30px com atividade. A superfície expandida usa 480/560/640px, conforme preferência, com toolbar de 32px e conteúdo medido até 400px de altura. Frames nativos incluem 24px de margem. O frame prepara espaço antes da expansão e só encolhe após a transição. Todas as mudanças mantêm o centro da área útil do monitor e respeitam DPI.

O frontend controla hover com intenção curta, saída adiada, retenção de foco de teclado e gerações de layout. Hoje, Foco e Música ocupam a mesma superfície; Aparência oferece uma camada contextual e um popup no canto esquerdo. O player mantém os comandos GSMTC/Core Audio. A agenda usa datas locais das tarefas existentes. Não há migrations.

Os controles dos cantos são duas WebViews pequenas (`top-left`, `top-right`), inicialmente ocultas, sem foco e fora da taskbar. Cada uma ocupa apenas seu notch ou popup medido. Aparência/atalhos no canto esquerdo e volume no direito reutilizam preferências e Core Audio; `configure_top_control` restringe labels e dimensões, posiciona na área útil e usa a mesma estratégia nativa para mostrar/esconder. Preferência própria permite desligá-los e a ocultação híbrida também os oculta. Não existe frame de tela inteira nem alteração no Shell. O App de cada label é o único proprietário da visibilidade da sua janela.

## 3. Dados e IPC

`expandir_ilha` e `recolher_ilha` recebem altura/largura lógica limitada. O estado nativo registra a geometria compacta para recuperar a região de aproximação mesmo após expansão. `pedro:island-visibility` inclui uma transição opcional com geração, visibilidade desejada e duração. `complete_island_visibility_transition(generation)` confirma o fim da animação. A saída mantém o HWND visível e o DOM inerte até a confirmação; um timeout limitado garante o fechamento se o frontend não responder. A entrada prepara o HWND compacto sem ativação antes de animar. Reversões invalidam confirmações anteriores.

`island_available_width` fornece a largura lógica da área útil do monitor: o viewport da HWND compacta nunca deve limitar o tamanho desejado de expansão.

Preferências adicionais são validadas, persistidas e sincronizadas pelo contrato existente: tamanho, expansão por aproximação, tom da superfície e acentos. Não existem APIs pagas, scraping ou alterações no Explorer, registro ou barra de tarefas.

## 4. Riscos e mitigação

Não chamar set_focus na ilha/dock. Confirmar gerações de resize e visibilidade, cancelar animações antigas e impedir que uma resposta atrasada revele uma janela escondida. Durante falha de encolhimento, ocupar o frame ainda grande com controles utilizáveis. Nenhum elemento transparente de tela inteira deve interceptar o desktop. Respeitar movimento reduzido. Preservar sessão/tarefa e drafts ao trocar abas.

Rollback: reverter os commits desta entrega; preferências antigas continuam válidas e não há alteração no banco.

## 5. Estratégia de testes

- npm test e npm run build.
- Cargo check para Windows GNU, com reaproveitamento do toolchain.
- Testes de política de visibilidade executáveis no host, separadamente da compilação Windows.
- Chromium: hover, saída, reversões, teclado, draft, player, preferências, bounds nativos simulados e animação de ocultação/retorno.
- Captura de vídeo e imagens da interface real no Chromium.
- O executável e o comportamento físico entre aplicações no Windows exigem validação no computador do usuário; mocks não demonstram click-through ou foco do sistema operacional.

Validação concluída: 93 testes Node, build e compilação Windows GNU aprovados; 24 políticas Rust executadas no host. Evidências e limites em [DESIGN_REPORT_ISLAND_REDESIGN.md](DESIGN_REPORT_ISLAND_REDESIGN.md).
