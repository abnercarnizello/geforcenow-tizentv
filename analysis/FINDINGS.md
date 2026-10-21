# Investigação da UN43T5300AGXZD e do APK fornecido

Data: 20/10/2026. Objetivo: avaliar e preparar o projeto para teste neste modelo.

## Observações do APK, obtidas com REA 6.5.0

Arquivo: `GeForce+NOW+Cloud+Gaming_1.0.5_APKPure.apk`, recebido com nome local
`1-GeForce-NOW-Cloud-Gaming_1.0.5_APKPure.apk`.

- SHA-256: `f51cbacb4f23a4c0dbed29fde52f9adbbfefa4f42992117e7f05b82cc5c7da21`.
- Inventário: 434 ocorrências contando a raiz; 433 entradas ZIP. Nenhuma biblioteca
  `lib/` e nenhum cliente web completo em `assets/`; um `classes.dex`.
  REA Evidence `ev_3f158ee4457fb0892ca5e4422b0683465950799f0f5c6c17c30c84b7796a9081`;
  inventário interno `ev_c052561734845bacdf837858f0b41dc652a6d00fb9669bf115fd703a12b34051`.
- Pacote `com.nvidia.geforcenow`, versão `1.0.5`, código `800000107`, SDK mínimo21,
  alvo36; 570 classes. Manifesto exige `org.chromium.arc` e declara Trusted Web
  Activity, `web_manifest_url`, `DEFAULT_URL` e Android Browser Helper.
  REA Evidence `ev_c4ccac4664473a4ac4cd9b24154423fdab972a336e6d0f9a6a46cecbdb05542e`.
- `LauncherActivity.i()` apenas chama `super.i()`; `onCreate` chama o método-base
  e define orientação. O método `d()` consulta navegadores instalados e escolhe
  um auxiliar. Isso confirma o papel de lançador web desta atividade; não foi
  identificado um motor nativo de streaming para transplantar para o Tizen.
  Evidence `ev_96df1af72833f69c22dc701ce9a41443ada7ca5d9c3c1bc900168a3102bcda4e`,
  `ev_a62e616285e0aec8be041f57d8a3ad7d7ab5998707827ad7f674b01adc4affc1`,
  `ev_39abfc9214a74c724b420d0f332c9e15c2f07575648b3c181b2f5e5a06e117b9`.

Essas observações sustentam a inferência de um wrapper web para ChromeOS, em vez
de uma implementação Android autônoma de streaming utilizável no Tizen. Não
equivalem à análise de todos os métodos do pacote, nem à execução do APK.
Autenticidade e assinatura criptográfica do APK não foram verificadas.

O REA instalado estava registrado, mas seus métodos MCP não estavam disponíveis
na sessão; foi usado o CLI público instalado, sem alterar configurações do Codex.
O provedor Android não tinha o JAR JADX. Foi obtido o JAR oficial0.7.1 na pasta local
ignorada `.tools/` e conferido seu SHA-256
`6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`, conforme
[documentação REA](https://github.com/morluto/rea/blob/main/docs/android-analysis.md).
Os JSON completos de evidência estão nesta pasta. O APK não foi executado.

## Observações da TV por SDB, sem instalar ou remover aplicativos

Conexão autorizada pelo usuário à TV em `192.168.15.9:26101` a partir do PC
`192.168.15.50`. A lista de dispositivos identificou `UN43T5300AGXZD`.
`sdb capability` informou `platform_version:5.5`, `cpu_arch:armv7`, perfil `tv`,
fabricante Samsung e acesso root desabilitado. São observações de ferramentas
comuns, não Evidence do REA.

O inventário de aplicações também continha `org.tizen.chromium-efl-upgrade`.
O nome não comprova a versão efetiva do motor nem os recursos de WebRTC.
A tentativa de depuração do navegador interno retornou `closed`; nenhuma
observação JavaScript foi obtida dessa tentativa. Não houve alteração de firmware.

## Fontes oficiais e implicações

- A T5300 é excluída explicitamente na nota4 da
  [expansão Samsung de cloud gaming para modelos2020](https://news.samsung.com/us/samsung-gaming-hub-boosteroid-cloud-gaming-expands-game-streaming-to-millions-more-devices-globally/).
  Não é correto afirmar que todas as TVs2020 aceitam GeForce NOW.
- [Grupos Samsung](https://developer.samsung.com/smarttv/develop/specifications/tv-model-groups.html):
  UT5300 em `20TV_BASIC2`, Tizen5.5.
- [Especificação do motor web](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html):
  a plataforma2020 documenta Chromium M69 e WebRTC. É referência da plataforma,
  não uma medição do firmware atual desta unidade.
- [NVIDIA](https://www.nvidia.com/en-us/geforce-now/system-reqs/) documenta Chrome77+
  nas plataformas de navegador listadas. Alterar user-agent não atualiza o motor.
- [Vídeo2020 Samsung](https://developer.samsung.com/smarttv/develop/specifications/media-specifications/2020-tv-video-specifications.html):
  BASIC2 documenta H.264 até1920×1080/60. Reprodução em contêineres não comprova
  funcionamento do decodificador por WebRTC.
- [WebSetting API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/websetting-api.html):
  mudança de user-agent tem callbacks de sucesso/erro; o privilégio websetting
  não deve ser declarado desde2.4.
- [Apps2Samsung](https://apps2samsung.com/) aceita Custom WGT/TPK e cuida da
  assinatura. O usuário escolheu esse método de instalação.

## Alterações e validação

Foi removida a navegação automática após uma espera arbitrária. O usuário agora
escolhe abrir o serviço e recebe erros/timeout de configuração. O manifesto
permite navegação de autenticação fora de `geforcenow.com` e declara internet.
O wildcard é intencional para os provedores regionais e federados, cujos domínios
podem mudar. Ele não intercepta credenciais nem garante que pop-ups permaneçam
na janela do aplicativo.

O diagnóstico consulta APIs, controles e reprodução H.264 em MP4, e gera uma
oferta SDP de vídeo com canal de dados, sem STUN. Sempre fecha os recursos.
Anunciar um codec não significa que um jogo foi transmitido ou decodificado.

Validação local: testes automatizados de codecs/compatibilidade, limpeza de
recursos, implementações antigas, falhas/timeout do launcher e navegação;
teste da interface em Chromium de desktop a1920×1080 e1280×720, sem erros de
JavaScript. Testar um navegador moderno de PC não reproduz o runtime Tizen.
Build ZIP/WGT com seis arquivos e hash SHA-256; assinatura e validação pelo SDK
Samsung não foram executadas nesta etapa.

## Questões ainda abertas

Esta lista corresponde à etapa inicial; os testes de campo abaixo confirmaram
instalação, motor e login. Permanece aberta a transmissão real com vídeo, áudio e
comandos durante um jogo.

O trabalho não deve ser descrito como GeForce NOW funcionando nessa TV enquanto
essas etapas não forem confirmadas.

## Retorno de campo: trava no logo NVIDIA

O usuário instalou a versão 1.1.0 pelo Apps2Samsung e relatou a trava. Após
reconfigurar o IP do desenvolvedor para o PC e reiniciar a conexão, foi possível
depurar o aplicativo instalado. O comando de debug abriu o app e o botão local
de abertura do GeForce NOW foi acionado sob captura CDP.

`Browser.getVersion` respondeu **Chrome/69.0.3497.128**, V8 **7.0.276.41**. Isso
mede o motor real, independentemente do UA de Chrome96 aplicado pelo launcher.
Foi reproduzido o carregamento de `https://play.geforcenow.com/mall/`, seguido de:

- `SyntaxError: Unexpected token .` no HTML, linha92 da fonte observada;
- `ReferenceError: globalThis is not defined` no bundle `polyfills.55d44818a23eddb0.js`;
- `SyntaxError: Unexpected token ;` no bundle `vendor.67f3eddbbf4416ca.js`.

Nessa janela de10 segundos não houve requisição com erro de transporte ou status
HTTP >=400. Essa busca é limitada à janela capturada, não uma garantia geral da rede.
O corpo da página permaneceu vazio de texto, reproduzindo a falha de inicialização.
Captura completa em `tv-startup-failure.json`, produzida por ferramentas CDP comuns,
não por REA. O HTML estático consultado no mesmo período usa `?.` em um script inline.
[V8 documenta suporte a essa sintaxe desde Chrome80](https://v8.dev/features/optional-chaining).

O UA nativo desta unidade não contém o token `Chrome/`: informa
`69.0.3497.106/5.5 TV`. A detecção antiga identificava incorretamente o token de
compatibilidade `AppleWebKit/537.36` como motor. Isso foi corrigido e recebeu teste.

A versão1.1.1 compila um teste local fixo de optional chaining. `SyntaxError`
confirma ausência da sintaxe; bloqueio por CSP ou indisponibilidade do compilador
permanece desconhecido. Apenas a ausência confirmada interrompe a navegação para
a página incompatível. O novo diagnóstico foi executado no motor real da TV e
retornou `blocked`, sintaxe `unsupported` e `globalThis:false`; ver
`tv-diagnostic-1.1.1.json`. Os20 testes automatizados passaram.

A assinatura/instalação do1.1.0 está confirmada pelo teste real; o1.1.1 permanece
disponível como WGT sem assinatura para o instalador. Até essa etapa, nenhum jogo
havia sido iniciado.
O defeito de inicialização não é resolvido por trocar UA ou permissões de domínio;
uma solução de streaming exige um cliente executável nesse motor ou outro runtime.
Não foi identificada uma entrada web compatível na pesquisa realizada; isso não
estabelece inexistência de um cliente Samsung empacotado diferente.

## Adaptação em execução com apoio do PC

Em 20/10/2026, a captura CDP comum na mesma TV confirmou catálogo carregado e login
reconhecido após adaptação dos arquivos públicos do cliente. O usuário concluiu o
login no próprio celular e escolheu Among Us. Nenhuma credencial foi necessária
para essa investigação.

`tools/compat/adapter.cjs` transforma sintaxe com esbuild 0.28.2 para Chrome69,
inclui core-js-bundle 3.51.0 e ResizeObserver do @juggle 3.4.0. O loader webpack
precisa desativar o atributo SRI dos chunks transformados: os hashes originais não
correspondem aos novos bytes. Essa alteração exige uma única atribuição conhecida
no runtime e interrompe a adaptação se sua forma mudar. A integridade de scripts
fora do escopo é preservada. Downloads públicos usam HTTPS, sem cookies e sem
seguir redirecionamentos. A camada não intercepta requisições de autenticação/API.

O SDK identificava a TV por quatro objetos globais nativos, mesmo com UA alterado.
Ocultar esses marcadores apenas na página permitiu o caminho de navegador. Isso
não adiciona APIs nativas nem anuncia capacidades de codecs, WebRTC ou DRM.

O primeiro teste de jogo encontrou `globalThis is not defined` no worker
`65.ea7fcba2f7f1caeb.js`; o polyfill da página não alcança workers. A correção cria
um Blob somente para essa URL exata, incluindo polyfills e a versão transformada
do `common.1bb8089756535934.js` importado por ele. Após a correção, o worker
executou com `globalThis` disponível e sem aquela exceção.

O componente real `gfn-loading` recebeu o texto de fila com 300 jogadores à frente,
depois 299 e 298. Cabeçalho e posição tinham opacidade1, dimensões na tela e nenhum
fundo sobreposto no teste `elementsFromPoint`. O usuário, porém, confirmou que a
TV física continuava mostrando apenas o fundo verde. Estado do DOM e hit testing
não comprovam pintura na tela: a investigação da exibição permanece aberta.
A posição não permite prever
o tempo de espera. O vídeo permanecia sem quadros enquanto a sessão aguardava fila;
isso é esperado antes da transmissão e não comprova funcionamento da mídia.

O elemento `#remote-video` existe desde o início do componente, antes do streaming.
Sua presença isolada não prova que WebRTC iniciou. Foram observados zero quadros
decodificados e nenhum controle via Gamepad API naquela janela. Não foram
validados imagem em movimento, som ou comandos em uma sessão de jogo.

O apoio do PC precisa permanecer executando. O atalho `INICIAR-NA-TV.cmd` conecta via
SDB e inicia o adaptador; o app instalado continua sendo o launcher. O adaptador
tem testes de escopo, transformação e worker, além dos testes do launcher e do
wrapper PowerShell: 40 testes passaram nesta revisão. Não houve teste de uma nova
instalação completa do atalho enquanto a TV aguardava a fila, para preservá-la.

## Nova tentativa após reinício da TV

O usuário confirmou que via somente o fundo verde, apesar da fila atualizando no
DOM, e reiniciou a TV. A reconexão SDB abriu uma nova sessão de depuração. Foi
aplicado um teste reversível apenas em `gfn-loading-launcher`: posição fixa,
fundo opaco, z-index20 e translateZ(0). O usuário confirmou que passou a ver a
tela de erro `0xC0F2220F`; isso confirma essa tela física, mas não valida ainda a
fila nem estabelece que o teste de composição foi a causa da mudança.

No bundle público testado, `0xC0F2220F` (3237093903) é denominado
`StreamerNoLocalCandidates`. Um teste separado, sem STUN, criou quatro candidatos
host reais na TV. A observação da próxima tentativa mostrou a causa anterior
à coleta de ICE: `setRemoteDescription` lançou sincronamente
`TypeError: this.getConfiguration is not a function`. O erro ocorreu tanto em
dois testes internos de áudio quanto na oferta real de áudio/vídeo/dados.
Não foi um teste de reprodução bem-sucedido. A captura resumida fica em
`tv-rtc-getconfiguration-failure.json`, sem conteúdo SDP nem endereços ICE.

O adaptador WebRTC embarcado no SDK assume `getConfiguration()` disponível ao
identificar Chrome96 pelo UA. O método não existe nessa implementação Tizen.
O teste local de oferta funciona porque não passa por essa leitura ao aplicar
uma oferta remota. A próxima correção deve expor os parâmetros efetivamente
fornecidos à conexão nativa, sem alterar o SDP ou anunciar codecs inexistentes.

## Correção de `getConfiguration` e unified-plan (Claude, 20/10/2026)

Teste direto no motor da TV (`rtc-semantics-probe`, via CDP no launcher instalado):

- `RTCPeerConnection.prototype.getConfiguration` é `undefined`.
- O padrão é **plan-b**: `addTransceiver` lança `InvalidStateError` ("only supported
  in 'unified-plan'"). Criado com `{sdpSemantics:'unified-plan'}`, `addTransceiver`
  funciona e a oferta tem `m=audio`, `m=video` e `m=application`, com H.264 listado.
- `RTCRtpTransceiver.prototype.setCodecPreferences` não existe; o SDK já registra
  aviso e segue sem ele quando o método falta.

No bundle público, quem chama `getConfiguration()` dentro de `setRemoteDescription`
é o `shimMaxMessageSize` do webrtc-adapter, ativo porque o UA informa Chrome ≥ 76.
O SDK também lê `getConfiguration().iceTransportPolicy` e `.iceServers`, e usa
`getTransceivers()` (unified-plan) para vídeo, áudio e estatísticas. A conexão
principal é criada só com `iceServers`/`iceTransportPolicy`, sem `sdpSemantics`,
então no Chromium 69 ela cairia em plan-b mesmo com `getConfiguration` resolvido.

`tools/compat/rtc-shim.js` entra no prelúdio do adaptador (versão 6):

1. Embrulha o construtor: se a configuração não informa `sdpSemantics` e o motor
   tem plan-b como padrão mas aceita unified-plan, passa `sdpSemantics:'unified-plan'`.
   A detecção cria e fecha duas conexões de teste, uma única vez.
2. Se `getConfiguration` falta, adiciona um que devolve cópia da configuração
   efetivamente entregue à conexão nativa, com os padrões da especificação.

SDP, codecs, servidores ICE e credenciais não são alterados. Um `sdpSemantics`
explícito é respeitado. Testes em `tests/compat-rtc-shim.test.cjs` (48 no total).
Na TV, o estado `__gfnCompatibility.rtc` confirmou `getConfigurationAdded:true`,
`unifiedPlanDefaulted:true`, `nativeDefault:'plan-b'`, sem exceções na página
até a entrada na fila.

### Resultado na TV: sessão de jogo transmitindo

Com o shim ativo, o usuário abriu Among Us pelos favoritos (conta Priority, fila de
29 jogadores). Após a fila, a conexão principal chegou a `connected`/ICE `completed`,
sinalização `stable`, sem o erro `0xC0F2220F` e sem exceções registradas pela sessão.
Amostras a cada 15 s (`tv-stream-success.json`):

- vídeo `inbound-rtp`: `framesDecoded` de 3719 → 7032 em ~60 s, cerca de 58 quadros/s;
- elemento `<video>` em 1920×1080, `readyState` 4, `currentTime` avançando;
- áudio `inbound-rtp` recebendo pacotes continuamente.

`webkitDecodedFrameCount` do elemento fica parado em 58 neste motor; o contador
confiável é o `framesDecoded` das estatísticas WebRTC. Ainda falta confirmação
visual/auditiva do usuário na TV física (houve antes um caso de DOM correto com tela
só verde) e teste de comandos (controle, teclado, mouse) durante o jogo.

### Redirecionamento de `/` e `/games`

`https://play.geforcenow.com/` e `/games` respondem `302 → /mall/`. Antes, o adaptador
baixava documentos com `redirect:'error'`; a falha fazia a TV carregar a página original,
sem adaptação, e travar no logo NVIDIA. Agora, para documentos, o PC lê o redirecionamento
sem segui-lo (`redirect:'manual'`) e, se o destino estiver no mesmo escopo público,
responde com uma página mínima que faz `location.replace('/mall/' + hash)`. A nova
navegação passa pela adaptação normalmente. Destinos fora do escopo continuam recusados,
e a query original não é enviada ao PC nem copiada para a página. Scripts continuam
com `redirect:'error'`.

Os JSON de evidência (`analysis/*.json`) ficam apenas na cópia local: contêm caminhos
da máquina e, no caso do APK, trechos descompilados de código da NVIDIA.

## Volta ao catálogo após o jogo: pesquisa pós-sessão

Ao encerrar Among Us, o app não voltava à tela do GeForce NOW. A sessão registrou
`ReferenceError: globalThis is not defined` em `gx-surveys.nvidia.com/static/js/93.*.js`.
O cliente abre essa pesquisa num iframe (`#survey-frame`) e espera um `postMessage`
(`surveyengine.cancel`, `nosurvey`, `thanks` ou `error`); como o script quebrava
no Chromium 69, nenhuma mensagem chegava e a tela ficava presa.

O adaptador passou a cobrir só o documento (`/`, `/index.html`) e os scripts
`/static/js/*.js` desse domínio, com um prelúdio leve (core-js e ResizeObserver,
sem WebRTC, worker ou remoção de marcadores Tizen). A query do iframe não é enviada
ao PC. A resposta interceptada usa o próprio domínio em `Access-Control-Allow-Origin`.

Teste direto na TV: o iframe carregou, enviou mensagens à página e não houve exceções.
Teste real: o usuário encerrou Among Us e o app voltou ao catálogo; a sessão adaptou o
documento e os dois scripts da pesquisa, sem exceções registradas.
