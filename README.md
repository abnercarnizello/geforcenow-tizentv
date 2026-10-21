# GeForce NOW para Samsung T5300 — experimental

Versão de teste do launcher de Timu5 para a **UN43T5300AGXZD / Tizen 5.5**.
Inclui diagnóstico de WebRTC/codecs, detecção de controles, navegação da tela inicial
pelo controle remoto e tratamento de erros ao abrir o serviço.

**A abertura direta da versão web atual falha no Chromium 69 desta TV.** A depuração
confirmou erros de sintaxe e ausência de `globalThis` ao iniciar o site NVIDIA.
A versão 1.1.1 identifica essa incompatibilidade e interrompe a abertura com uma
explicação; **não é uma correção do streaming**. A Samsung exclui expressamente a T5300 do
[suporte oficial a cloud gaming](https://news.samsung.com/us/samsung-gaming-hub-boosteroid-cloud-gaming-expands-game-streaming-to-millions-more-devices-globally/).
Um launcher não atualiza o Chromium nem adiciona codecs ou recursos de hardware.

**O teste com apoio do PC já transmite um jogo.** Com a correção de WebRTC
(`tools/compat/rtc-shim.js`), Among Us passou da fila e conectou: vídeo 1920×1080
decodificando a cerca de 58 quadros/s e áudio chegando, sem o erro `0xC0F2220F`.
Imagem e som confirmados na TV. Ao encerrar o jogo, o app volta ao catálogo.
O controle do PS5 não é reconhecido pela TV (Tizen 5.5).

## Teste com apoio do PC

Com o aplicativo já instalado na TV, use [INICIAR-NA-TV.cmd](INICIAR-NA-TV.cmd)
no computador. O atalho está configurado para a TV `192.168.15.9`. Para outro IP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/compat/start.ps1 -TvIp IP_DA_TV
```

É necessário Node.js 22+, SDB do Tizen Studio ou a cópia local em `.tools/sdb`,
e Modo Desenvolvedor configurado com o IP do PC. Mantenha o PC ligado e a janela
aberta. Encerre com Ctrl+C; iniciar outra sessão pode abrir novamente o aplicativo.
Não execute o atalho durante uma fila ou um jogo já em andamento.

O apoio do PC adapta a sintaxe dos arquivos públicos do cliente NVIDIA para
Chrome 69 e adiciona polyfills, ResizeObserver e o worker observado nessa versão.
Também completa o WebRTC da TV: cria `getConfiguration()`, que não existe nesse
motor, e pede `unified-plan` às conexões (o padrão da TV é o antigo plan-b).
O download ocorre por HTTPS; autenticação e APIs do serviço seguem diretamente
na TV. Não são registrados corpos de autenticação nem cabeçalhos de credenciais.
Os arquivos públicos adaptados ficam apenas no cache local ignorado pelo Git.
Essa adaptação depende da versão publicada pela NVIDIA e pode precisar de revisão
quando ela mudar. O WGT sozinho não contém essa adaptação.

## Instalar pelo Apps2Samsung

1. Na TV, ative o Modo Desenvolvedor e configure o IP do computador/celular que
   realizará a instalação. Reinicie a TV se alterar essa configuração.
2. No [Apps2Samsung](https://apps2samsung.com/), conecte à TV e escolha
   **Custom WGT/TPK** ou **Custom WGT File**.
3. Selecione `dist/geforcenow-t5300-1.1.1-unsigned.wgt`.
4. Conclua a assinatura e a instalação no próprio Apps2Samsung. Ele pode solicitar
   login Samsung para criar o certificado. Não é necessário instalar Tizen Studio
   quando a assinatura é feita pelo instalador.
5. Abra **GeforceNowLauncher**, aguarde o teste e selecione **Abrir GeForce NOW**.

O arquivo `unsigned.wgt` precisa ser assinado pelo instalador; ele não é um APK
convertido. Para instalação pelo celular, o IP de desenvolvedor deve corresponder
ao celular que instala. Os nomes das opções variam conforme a versão do instalador.

## Como verificar se funcionou

- Confira o resultado em **Ver detalhes do teste**. `h264: true` significa apenas
  que a oferta WebRTC anuncia H.264; não comprova decodificação nem streaming.
- Entre no GeForce NOW e abra um jogo. A validação exige imagem em movimento,
  som e comandos funcionando durante uma sessão real.
- Conecte um controle USB e pressione um botão. A presença de `getGamepads` não
  garante que qualquer controle ou o site do serviço funcione com ele.
- Se a tela ficar branca ou o login abrir no navegador externo, registre em qual
  etapa aconteceu. A configuração permite redirecionamentos de autenticação,
  mas não controla pop-ups criados pelo site externo.

A identificação de Chromebook é opcional. Alterá-la pode passar uma verificação
de identificação do site, mas o motor da TV continua o mesmo. A interface e seus
atalhos locais deixam de executar após a navegação para o site NVIDIA.

## Compilar e testar

No Windows, com Node.js 18+ e PowerShell:

```powershell
npm test
npm run build
```

O build produz o WGT sem assinatura e um SHA-256 em `dist/`. O launcher não possui
dependências npm; o teste com apoio do PC prepara dependências separadas em `.tools`.
Apenas seis arquivos do aplicativo entram no widget; APK, evidências, testes,
ferramentas e certificados ficam fora dele.

Para assinar com um perfil Samsung já configurado no Tizen Studio:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build.ps1 -SignatureProfile MeuPerfil -TizenPath C:\tizen-studio\tools\ide\bin\tizen.bat
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install.ps1 -TvIp IP_DA_TV -PackageFile dist/geforcenow-t5300-1.1.1.wgt -SdbPath C:\tizen-studio\tools\sdb.exe -Launch
```

`ExecutionPolicy Bypass` vale só para esse processo; o projeto não altera a política
do Windows. O instalador recusa um WGT sem os dois arquivos de assinatura. A presença
deles não substitui a verificação criptográfica feita pela TV.

## Diagnóstico opcional pelo navegador da TV

```powershell
node tools/preview.cjs IP_DO_PC IP_DA_TV
```

Abra na TV o endereço exibido com `?report=1`. O resultado de capacidades é salvo
localmente em `dist/tv-browser-report.json`. O servidor serve apenas os arquivos
da interface e aceita somente os IPs informados e loopback. Interrompa com Ctrl+C.
HTTP na rede local pode restringir APIs; o resultado do navegador não substitui
o teste do widget instalado. A prévia não altera o user-agent nem abre o GeForce
NOW como se fosse um aplicativo Tizen instalado.

## Evidências e limites

Veja [analysis/FINDINGS.md](analysis/FINDINGS.md) para identidade do APK analisado,
referências REA, fontes técnicas e o que ainda precisa ser validado no aparelho.
Não foram incorporados código, certificados ou recursos do APK ao launcher.
