# Changelog

Todas as mudanças relevantes deste projeto são documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/)
e o projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [1.2.3] - 2026-07-05

### Adicionado

- **Tema claro/escuro no popup**: um botão no header, ao lado do "Apoiar",
  alterna entre os temas claro e escuro. Sem escolha salva, o popup segue o tema
  do sistema, como antes; a escolha fica na chave nova `themePref`, fora do
  estado do motor, então "Restaurar padrões" preserva o tema. Nos quatro
  idiomas. Contribuição de [@leandroohsr](https://github.com/leandroohsr)
  (PR #34).
- **Botões "Sobre o ZeroDelay" e "Relatar um problema"**: dois links no rodapé
  do popup levam ao repositório e às issues no GitHub, criando um caminho direto
  da extensão para a comunidade. Nos quatro idiomas. Contribuição de
  [@leandroohsr](https://github.com/leandroohsr) (PR #32).

### Alterado

- **Documentação de desenvolvimento em inglês**: README, CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY, ROADMAP, CONTRIBUTORS e docs/firefox.md foram
  traduzidos para o inglês para abrir o projeto à comunidade internacional,
  contribuição de [@leandroohsr](https://github.com/leandroohsr) (PR #33).
  O README continua disponível em português em `README.pt-BR.md`, com seletor
  de idioma no topo.
- **Suporte de desenvolvimento ao Zen Browser**: novo script `npm run run:zen`
  que carrega o build Firefox/Gecko no Zen via `web-ext`, resolvendo o binário
  por `ZEN_BINARY`/`PATH` e com perfil opcional por `ZEN_PROFILE`. Apenas
  tooling local, sem alteração no código publicado nem nos manifestos.
  Contribuição de [@GbrFrn](https://github.com/GbrFrn) (PR #26).

## [1.2.2] - 2026-07-04

### Adicionado

- **Seção "Ajuda · Como usar" no popup**: uma seção retrátil (fechada por padrão,
  irmã de "Avançado") com um FAQ curto para quem acabou de instalar — o que a
  extensão faz, como começar, por que a velocidade muda sozinha, qual modo
  escolher, o que são os números no player e os atalhos de teclado. Reaproveita os
  componentes e as cores existentes e está nos quatro idiomas (`en`, `pt_BR`,
  `es`, `fr`).

- **Memória de modo por canal (opt-in)**: um toggle **"Lembrar modo por canal"**
  (desligado por padrão) guarda o modo que você escolhe em cada canal do YouTube e
  reaplica ao voltar. Nunca sobrepõe o seu modo atual num canal sem preferência
  salva; o popup mostra **"lembrado para este canal"** com um **"esquecer"**.
  Baseado na ideia da PR #22 de [@wthallys](https://github.com/wthallys).
- **Modo "Estável"** _(experimental)_: novo modo de reprodução para conexões que
  oscilam. Você escolhe, num slider de 2 a 6 s, a distância-alvo do ao vivo; o
  controlador **persegue o ao vivo como os modos normais, mas com um freio de
  buffer que pode recompor a reprodução abaixo de 1.0x** — algo que nenhum modo
  original faz (eles só aceleram ou descansam em 1.0x, torcendo para a rede
  reabastecer). Uma única regra o guia: `taxa = 1 + perseguir − recompor`, onde
  "perseguir" reduz a latência (freado pela saúde do buffer) e "recompor"
  desacelera para refazer o colchão quando ele afina — sem derivar do ao vivo
  indefinidamente (o pulo aos 30 s segue como trava). Prioriza estabilidade em
  troca de ficar um pouco mais longe do ao vivo. Usa chaves de storage novas
  (`band`, `centerBuffer`), sem alterar as existentes.

  > **Observação:** o modo é experimental e pode mudar com o feedback de uso.
  > Futuramente o slider de alvo poderia ser estendido aos demais modos — com ou
  > sem a recomposição abaixo de 1.0x —, unificando "quão perto do ao vivo" num
  > controle só.

### Corrigido

- **Travamentos com o rate preso em 1.05x (regressão da v1.2.0)**: o controlador
  contínuo tinha perdido o `bufferTarget` como piso de descanso e moía o buffer
  até o limite de travamento (1.5s), segurando ~1.05x sem margem nenhuma até a
  live travar, em todos os modos, sempre que a latência mínima real da stream
  fica acima de ~2s (toda live de verdade). O alvo de buffer do modo voltou a
  ser o ponto de equilíbrio, com as três salvaguardas do controlador original
  restauradas (histerese de engate, backoff instantâneo em 2.5s e freio
  preditivo de drenagem da issue #12), mantendo a aceleração contínua.
  Diagnóstico confirmado ao vivo na CazeTV e por simulação (52-58 travamentos
  em 30 min antes; 0 depois, nos modos suave/equilibrado/automático).
- **Motor se auto-bloqueava achando que era o usuário**: o player do YouTube
  quantiza `setPlaybackRate` em passos de 0.05 (pedir 1.0375 aplica 1.0; 1.06
  aplica 1.05). Os rates contínuos do controlador novo divergiam do eco
  quantizado e o detector de "usuário mudou a velocidade" congelava o controle
  com a live presa em 1.05x, inclusive com o buffer morrendo. Agora o motor
  pede rates já no grid de 0.05 e adota o eco do player como valor aplicado.
- **Motor dormia em aba minimizada**: o loop era um `setInterval` puro, que o
  Chrome estrangula em aba escondida (1 tick/s, e 1 tick/min após 5 minutos sem
  áudio) — sem catch-up, sem skip e com os indicadores defasados até voltar. O
  tick agora é dirigido pelo `timeupdate` do vídeo (imune ao throttle enquanto
  a mídia toca) com resync imediato ao voltar pra aba.
- **Avisos só em lives**: tanto a oferta de "a transmissão está travando" quanto o
  convite de doação agora só aparecem enquanto uma **live está tocando de verdade**
  — nunca em VOD/replay nem numa aba ociosa.
- **Falso positivo do aviso de travamento em anúncios**: o watchdog de travamento
  ignora o evento `waiting` disparado enquanto um **anúncio** roda (buffa no mesmo
  `<video>`), então não sugere mais trocar de modo por causa de propaganda.
- **Watchdog de travamento zera a contagem ao trocar de live**: a contagem de
  travadas é reiniciada a cada transmissão, junto com o resto do estado do motor
  (EMAs/histerese, `seekableEnds`). Antes ela era global e sobrevivia à navegação
  SPA — uma travada numa live somava com outra na live seguinte (ao trocar de
  canal em até 90s) e disparava a oferta de "trocar para um modo mais calmo" sem
  que nenhuma das duas tivesse travado de verdade duas vezes. O recuo anti-repetição
  (não reoferecer por ~5min) é mantido de propósito.

### Alterado

- **Convite de apoio: presença por sessão e silêncio só por escolha explícita**:
  enquanto o usuário não decidir, o convite aparece uma vez por sessão do
  navegador (e só sobre uma live tocando de verdade). **"Hoje não"** silencia
  até o dia virar; **"Não quero apoiar"** silencia para sempre; **"Apoiar"**
  abre a doação. Ver o convite ou fechá-lo no ✕ não arma silêncio nenhum. Os
  dois botões de escolha existem no banner sobre a live e no popup, e o botão
  de apoio no header do popup segue sempre disponível.

### Segurança

- **Blindagem preventiva do SVG do popup**: a função que converte o markup dos
  ícones e do QR PIX em nós DOM agora rejeita raízes scriptáveis e remove
  `<script>`/`<foreignObject>` aninhados, handlers inline (`on*`) e URLs
  `javascript:`/`data:` de `href`/`src`. Hoje só markup próprio passa por ali
  (nenhuma falha explorável existia); a mudança garante que uma alteração
  futura não transforme esse caminho em XSS.

## [1.2.1] - 2026-07-03

### Corrigido

- **Modo Hexa — a splash "OLÊ OLÊ OLÁ" e a confete de gol agora tocam mesmo com
  `reduced-motion`**. Como o Modo Hexa é **opt-in** (você ativa de propósito), essas
  festas de um-disparo, acionadas por você, deixaram de ser suprimidas pela
  preferência de movimento reduzido — só o **loop infinito** de morph da logo
  continua calmo (estático) para quem precisa.
- **Modo Hexa — blindagem anti-cascata**: cada nó decorativo (badge, varal, botão
  GOL, logo) é montado isolado, então uma falha em um não derruba mais os outros
  nem o `keepAlive`; a funcionalidade sobe antes do boot/toast cosméticos; e cada
  falha vira um aviso `[ZeroDelay Hexa] <função> falhou:` no console (auto-diagnóstico).

## [1.2.0] - 2026-07-03

### Adicionado

- **Modo Hexa — logo do YouTube vira bandeira do Brasil**: o símbolo do "play"
  na masthead se transforma, em **loop com descanso** (~24s: a maior parte do
  tempo como bandeira, um breve retorno ao YouTube), numa **bandeira cartoon
  tremulando** — o campo vermelho vira verde, o **losango**, o **círculo azul** e
  as **6 estrelas do hexa** brotam em coroa por cima, e o **triângulo branco do
  play** permanece como elo entre os dois estados. Some no **gol** (a bandeira
  balança forte junto com a confete) e respeita `prefers-reduced-motion` (fica uma
  bandeira parada) e a tela cheia. Não é um adesivo por cima: é uma **troca no
  próprio SVG da logo** — escondemos só os paths do ícone e injetamos a bandeira no
  lugar exato dele, **reaproveitando o wordmark "YouTube" original** da página (nada
  é reproduzido/embutido; tudo fica no mesmo sistema de coordenadas e alinhado).
- **Modo Hexa — comemoração de GOL**: confete liberado **continuamente por ~3s**
  (não mais um único estouro). Dispara pelo botão **GOL!** e também
  **automaticamente** quando um **pico de volume no chat ao vivo** é detectado —
  um gol de verdade faz a torcida inteira postar de uma vez. Salvaguardas contra
  falso-positivo: exige um número alto de mensagens num intervalo curto **e** um
  múltiplo grande do ritmo normal do chat (um troll isolado mandando "GOL" não
  dispara), **e** que a rajada seja majoritariamente comemorativa
  (`classifyHexaChatMessage`) — para **não comemorar gol do adversário** (lamento
  no chat não conta). Cooldown de 45s entre disparos.
- **Modo Hexa — boot de ativação com o canto "OLÊ OLÊ OLÁ"**: a estrela tricolor
  estoura e **segura o tempo de você vê-la** (o gatilho), depois se abre e entrega
  um **campo amarelo** onde o grito **"OLÊ OLÊ OLÁ"** entra empilhado em verde (um
  "OLÊ" grande + grade 2×3 + as estrelas do hexa), na fonte da marca (Departure
  Mono, self-hosted também na página) — a festa da referência.
- **Modo Hexa — botão GOL! com experiência de botão nativo**: neutro/cinza como o
  like/dislike (mesmo tamanho, ícone de bola e espaçamento) e fica **dourado só ao
  marcar** (clique ou detecção de gol), com a bola **quicando e girando** como a
  reação do "gostei", voltando ao neutro em seguida.
- **Modo Hexa — o popup veste a camisa**: enquanto o tema está ativo numa aba, o
  **header do popup** ganha uma faixa verde full-bleed (o campo da seleção), uma
  linha tricolor de recorte e o selo "o" do wordmark em ouro.
- **Popup — ícones de cerveja redesenhados**: conjunto de traço padronizado
  (copo americano → lata → long neck → caneca), com a **lata** agora de verdade
  (ombro afunilando pra tampa + lacre, não mais um cilindro); o mug do header ganha
  **borbulhas subindo** (carbonatação, recuperando a antiga fumacinha do café) e os
  chips dão um "tim-tim" no hover. "R$ 10" não quebra mais linha.

### Alterado

- **Modo Hexa — repintura por padrão é ESTREITA (opt-in para a completa)**: por
  padrão o tema veste só o acento (barra do player, varal e os nós ZeroDelay), sem
  repintar o YouTube inteiro — menos ambiguidade de "isto é o YouTube real?". O
  **tema verde completo** continua existindo, agora **desligado por padrão** e
  ativável em "Tema completo no YouTube"; quando ligado, ele traz também a **borda
  verde** sob o masthead.
- **Modo Hexa — selo LIVE permanece VERMELHO nativo**: o selo "AO VIVO" do player
  não é tingido. Vermelho = "você está na borda ao vivo", que é justamente o que a
  extensão entrega — tingi-lo enterraria o único sinal que diz ao torcedor que ele
  está realmente ao vivo.
- **Modo Hexa fica totalmente inerte em tela cheia**: nenhum overlay (badge,
  varal, GOL!, confete, boot, toast, convite) e nenhum acento no player (barra)
  enquanto o vídeo está em fullscreen — tudo volta ao sair.

### Corrigido

- **Aceleração linear e contínua** no motor de catch-up. O controlador voltou a
  reduzir a latência de forma suave e proporcional ao atraso (quanto mais atrás
  do ao vivo, mais rápido, até 1.25x), em vez dos "tiros" de velocidade cheia
  seguidos de longos descansos — que demoravam muito para diminuir o atraso. O
  buffer agora é apenas uma trava de segurança suave (reduz a taxa gradualmente
  ao se aproximar do piso de travamento), não mais um liga/desliga travado no
  alvo de buffer. Removido o freio por tendência (`drain_ema`), que disparava no
  dreno normal do próprio catch-up e o interrompia no meio.
- Botão CTA **"Apoiar via PIX"** agora alterna o painel de doação (abre **e**
  fecha), em vez de apenas abrir — mesmo comportamento do botão "Apoiar".

### Removido

- **Botão "Ir ao Vivo"** do popup — destoava da interface. O atalho de teclado
  (`Alt+Shift+L`) continua pulando para o ao vivo.

## [1.1.1] - 2026-07-02

### Adicionado

- **Botão "Ir ao Vivo"**: Adicionado botão de ação rápida diretamente no popup para saltar manualmente para o tempo real da live.
- **Idiomas**: interface em espanhol (`es`) e francês (`fr`), além de inglês e
  português. A doação segue o idioma (Buy me a coffee fora do pt-BR). O
  `check:locales` agora valida todos os locales contra o `en`.
- **Atalhos de teclado** para ativar/desativar o ZeroDelay (`Alt+Shift+Y`) e
  pular para o ao vivo (`Alt+Shift+L`) — `⌘+Shift+…` no Mac —, sem abrir o popup.
  Reconfiguráveis em `chrome://extensions/shortcuts`.
- **Acessibilidade**: navegação por setas (padrão ARIA radiogroup, um único
  tab-stop) nos cartões de modo e `aria-label` nos indicadores do player.
- Suporte ao **Firefox Desktop**: `manifest.firefox.json`, build em Node e
  tooling `web-ext` (`run:firefox`, `lint:firefox`, `package:firefox`).
- Pipeline de **CI** (GitHub Actions) rodando lint, testes e build a cada push e
  pull request.
- **Testes unitários** do motor de catch-up (`node --test`).
- Tooling de release: validação (`scripts/validate.mjs`), build
  (`scripts/build.mjs`) e bump de versão (`scripts/bump.mjs`).
- Estrutura de governança: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
  `SECURITY.md`, templates de issue e de pull request e este `CHANGELOG.md`.
- `CONTRIBUTORS.md` creditando os autores das PRs da comunidade.

### Alterado

- **Interface do popup repaginada** com a linguagem visual "degradado → nítido":
  tipografia **Departure Mono** (self-hosted) em títulos e números; ícones de modo
  que fazem *morph* de pixelado (**Pixelarticons**) para nítido (**Lucide**) no
  hover/foco/seleção; paleta de sinal cinza↔vermelho espelhando o selo de "ao
  vivo" do YouTube; o "o" de Zer**o**Delay como selo LIVE que morfa de pixel-art
  para um disco vermelho ao sincronizar; sistema de "sticker" com sombra dura nos
  botões; CTA de apoio como balão que sai do botão; área do PIX como cupom
  destacável com um ícone de bebida por valor; e textura de scanline que some ao
  sincronizar. Puramente visual — nenhuma mudança de comportamento, storage ou
  chaves i18n. Fontes e ícones são vendorados localmente (sem CDN) e creditados no
  `THIRD-PARTY-NOTICES.md` (Departure Mono — SIL OFL; Pixelarticons — MIT;
  Lucide — ISC).
- Maior resiliência do motor de catch-up.
- Controle de catch-up **preditivo**: além do nível do buffer, o motor agora
  observa a *tendência* (a variação do buffer ao longo do tempo) e recua para
  `1.0x` de forma preventiva quando o buffer está drenando — mesmo ainda alto —
  reduzindo travamentos em redes instáveis (issue #12).
- **Modos repaginados**: "Latência Mínima" vira **"Extremo"** (buffer ~2s) e os
  demais ficam mais perto do ao vivo (Suave 8→5, Equilibrado 6→4, Próximo
  4,5→3s). Sem novas chaves de storage.
- **Tema cerveja no apoio (Brasil)**: no `pt-BR` o convite de doação usa
  "cerveja"/"cervejinha" 🍺 (título, nota, CTA, nudge e banner) e ícones de
  bebida (copo americano → lata → long neck → caneca); os demais idiomas seguem
  café/coffee. Chips do PIX reorganizados em grade de 4 colunas com "Outro" em
  linha própria. Ramificado por idioma, como o PIX × doação internacional.

### Corrigido

- **Build**: a pasta `fonts/` (Departure Mono) passou a ser incluída no pacote
  (Chrome e Firefox). Sem isso, a fonte ficava de fora do `.zip`/`dist` e a
  tipografia da repaginação caía no fallback do sistema.

- Ícones dos modos (e demais glifos SVG do popup) não apareciam — sobrava só o
  fundo circular. Os SVG inline sem `xmlns` caíam no namespace nulo ao serem
  parseados como `image/svg+xml`; `parseSvg` agora usa `text/html`, que aplica o
  namespace SVG corretamente. O QR Code do PIX segue funcionando.
- **Firefox**: a detecção de `cloneInto` passou a ser por feature detection em
  vez de sniffing de user agent — com `privacy.resistFingerprinting` (ou UA
  alterado) a extensão ficava silenciosamente inoperante. O motor também ignora
  eventos de settings cujo `detail` não atravessou os mundos (X-ray).
- PIX restrito a `pt-BR`: usuários de `pt-PT` viam o QR do PIX (inutilizável em
  Portugal) em vez do link internacional de doação.
- O contador de uso da doação não infla mais com várias abas abertas (só uma
  aba contabiliza cada minuto de relógio).
- O atalho de ativar/desativar (`Alt+Shift+Y`) voltava a gravar "desligado" em
  dados legados (`enabled=false` sem preset completo) — agora religa na
  primeira pressão.
- O popup se mantém sincronizado com mudanças externas (atalho de teclado,
  oferta de troca de modo no player) enquanto está aberto.
- O estado do controlador de catch-up (EMAs, histerese) é zerado ao navegar
  entre lives — decisões dos primeiros segundos não usam mais dados da
  transmissão anterior.
- Indicadores não exibem mais `NaN` quando o player não reporta latência ou
  buffer; o chip de "copiar link" não gera mais URL com `v=undefined`.
- `bump.mjs` agora versiona também `manifest.firefox.json` e
  `package-lock.json`; `validate.mjs` valida os dois manifests e acusa
  divergência de versão entre eles.
- Vazamentos de memória em navegações consecutivas: listener preso ao
  `<video>` antigo quando o YouTube trocava o elemento (ex.: live → live) sem
  removê-lo; risco de listeners duplicados em `chrome.storage.onChanged` caso
  o content script fosse reinicializado na mesma aba; e uma race condition no
  `setInterval` de detecção do player quando `yt-navigate-finish` disparava em
  sequência rápida (PR #17).

### Alterado (interno)

- Pacote da Chrome Web Store gerado por **whitelist** de arquivos (como no
  build do Firefox) — um arquivo estranho na árvore não pode mais vazar no zip.
- Detecção do player com back-off (20s rápidos, depois sondagem lenta) em vez
  de polling de 500ms para sempre em páginas/frames sem live; recarga de
  settings só quando uma chave do motor realmente muda.
- Deduplicações: resolução de settings unificada em `common.resolveSettings`,
  cards flutuantes (doação/stall) num único construtor, `ensureInstalledAt`
  compartilhado; removidos eventos e UI mortos
  (`_live_catch_up_onPlaybackRateChange`, `_live_catch_up_reset_playback_rate`,
  `#mode-warning`/`minWarning`).
- Radiogroup de valores do PIX navegável por teclado (setas/Home/End), `lang`
  do popup segue o idioma real da interface.
- CI usa `npm ci`; `package.json` declara `engines.node >= 22.2`; versões dos
  manifests normalizadas para `1.1.0`.

## [1.1.0] - 2026-06-30

### Adicionado

- Doação opcional adaptada ao idioma: PIX (com QR Code local) para pt-BR e
  Buy Me a Coffee para en.
- Aviso de travamento da transmissão, sugerindo trocar de modo quando a conexão
  não sustenta o alvo de buffer.

### Alterado

- Conformidade de licença: atribuição explícita ao projeto base
  [live-catch-up](https://github.com/yudai-tiny-developer/live-catch-up)
  (MIT/Apache-2.0) em `THIRD-PARTY-NOTICES.md`.

## [1.0] - 2026-06-23

### Adicionado

- Lançamento inicial na Chrome Web Store (Manifest V3).
- Motor de catch-up que reduz a latência das lives acelerando temporariamente a
  reprodução e voltando a `1.0x` ao alcançar o ao vivo.
- Popup de configurações com modos de um toque e indicadores opcionais no player
  (velocidade, latência ao vivo e saúde do buffer).
- Localização em inglês e português (BR).
- Doação opcional via PIX com QR Code gerado localmente.
