(function () {
    'use strict';
    var launchUrl = 'https://play.geforcenow.com/';
    // Identification only: this cannot upgrade Tizen's browser engine.
    var desktopAgent = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36';
    var originalAgent = navigator.userAgent;
    var report = null;
    var busy = false;
    var probeNumber = 0;
    function element(id) { return document.getElementById(id); }
    function status(text) { element('status').textContent = text; }
    function errorText(error) { return String(error && error.message ? error.message : error || 'Erro desconhecido'); }
    function showReport() { element('report').textContent = JSON.stringify(report, null, 2); }
    function sendPreviewReport() {
        var request;
        if (window.location.protocol !== 'http:' || !/(?:\?|&)report=1(?:&|$)/.test(window.location.search)) { return; }
        report.networkContext = { secureContext: !!window.isSecureContext, origin: window.location.origin };
        request = new XMLHttpRequest();
        request.open('POST', '/api/report', true);
        request.setRequestHeader('Content-Type', 'application/json');
        request.send(JSON.stringify(report));
    }
    function setBusy(value) {
        busy = value;
        element('launch').disabled = value;
        element('diagnose').disabled = value;
    }
    function refreshGamepads() {
        var info = window.GfnDiagnostics.inspect(window).gamepads;
        element('gamepad').textContent = info.devices.length ? info.devices.length + ' controle(s) detectado(s)' :
            'Controle: conecte por USB e pressione um botão. Teclado e mouse também podem ser necessários.';
        if (report) { report.device.gamepads = info; }
    }
    function diagnose() {
        var currentProbe;
        if (busy) { return; }
        currentProbe = ++probeNumber;
        report = {
            device: window.GfnDiagnostics.inspect(window),
            capturedOriginalUserAgent: originalAgent,
            modelTarget: 'UN43T5300AGXZD',
            webRtc: { status: 'checking', streamingVerified: false }
        };
        element('engine').textContent = report.device.engine.name + ' ' + (report.device.engine.version || '(versão desconhecida)');
        status('Verificando os recursos de vídeo da TV…');
        if (report.device.javascript && report.device.javascript.optionalChaining.status === 'unsupported') {
            report.webRtc.status = 'not-run';
            status('O site atual da NVIDIA usa JavaScript incompatível com o navegador desta TV. A identificação de Chromebook não corrige isso.');
            showReport();
            sendPreviewReport();
            return;
        }
        showReport();
        refreshGamepads();
        if (!window.Promise) {
            report.webRtc.status = 'unsupported';
            status('O navegador não oferece os recursos necessários para este teste.');
            showReport();
            sendPreviewReport();
            return;
        }
        window.GfnDiagnostics.probeWebRtc(window).then(function (result) {
            if (currentProbe !== probeNumber) { return; }
            report.webRtc = result;
            if (result.status === 'offer-created') {
                status(result.h264 ? 'WebRTC anuncia H.264. Ainda é necessário testar o login e abrir um jogo.' :
                    'WebRTC não anunciou H.264. O streaming do GeForce NOW pode não funcionar.');
            } else { status('Teste WebRTC: ' + result.status + (result.error ? ' — ' + result.error : '')); }
            showReport();
            sendPreviewReport();
        }, function (error) {
            if (currentProbe !== probeNumber) { return; }
            report.webRtc = { status: 'failed', error: errorText(error), streamingVerified: false };
            status('Não foi possível testar WebRTC: ' + errorText(error));
            showReport();
            sendPreviewReport();
        });
    }
    function launch() {
        var settings = window.tizen && window.tizen.websetting;
        var agent = element('desktop-mode').checked ? desktopAgent : originalAgent;
        var settled = false;
        var timer;
        if (busy) { return; }
        if (report && report.device.javascript && report.device.javascript.optionalChaining.status === 'unsupported') {
            status('Abertura interrompida: o site atual da NVIDIA falha neste navegador. É necessário um cliente compatível para jogar.');
            return;
        }
        if (!settings || typeof settings.setUserAgentString !== 'function') {
            status('Prévia no PC: instale o aplicativo na TV para testar a abertura dentro do Tizen.');
            return;
        }
        setBusy(true);
        status('Abrindo o GeForce NOW…');
        function fail(error) {
            if (settled) { return; }
            settled = true;
            window.clearTimeout(timer);
            setBusy(false);
            status('Falha ao configurar o navegador: ' + errorText(error) + '. Tente novamente.');
        }
        timer = window.setTimeout(function () { fail('A TV não respondeu em 5 segundos'); }, 5000);
        try {
            settings.setUserAgentString(agent, function () {
                if (settled) { return; }
                settled = true;
                window.clearTimeout(timer);
                // Top-level navigation avoids iframe cookie and framing restrictions.
                try { window.location.assign(launchUrl); } catch (error) {
                    setBusy(false);
                    status('Não foi possível abrir o serviço: ' + errorText(error));
                }
            }, fail);
        } catch (error) { fail(error); }
    }
    function exit() {
        try {
            if (window.tizen && window.tizen.application) { window.tizen.application.getCurrentApplication().exit(); }
            else { status('Prévia no PC: feche esta aba para sair.'); }
        } catch (error) { status('Não foi possível sair: ' + errorText(error)); }
    }
    function keydown(event) {
        var code = event.keyCode;
        var controls;
        var index;
        var next;
        if (code === 10009 || code === 27) { event.preventDefault(); exit(); return; }
        if (code === 13 && element('desktop-mode') === document.activeElement) {
            event.preventDefault();
            element('desktop-mode').checked = !element('desktop-mode').checked;
            return;
        }
        if ([37, 38, 39, 40].indexOf(code) === -1 || element('report') === document.activeElement) { return; }
        controls = Array.prototype.slice.call(document.querySelectorAll('button:not(:disabled), input[type="checkbox"]'));
        index = controls.indexOf(document.activeElement);
        next = (index + (code === 37 || code === 38 ? -1 : 1) + controls.length) % controls.length;
        if (controls[next]) { event.preventDefault(); controls[next].focus(); }
    }
    window.addEventListener('load', function () {
        var savedAgent;
        try {
            savedAgent = window.localStorage.getItem('gfn.nativeUserAgent');
            if (savedAgent) { originalAgent = savedAgent; }
            else { window.localStorage.setItem('gfn.nativeUserAgent', originalAgent); }
        } catch (ignore) { /* Browser storage can be disabled. */ }
        element('launch').addEventListener('click', launch);
        element('diagnose').addEventListener('click', diagnose);
        element('exit').addEventListener('click', exit);
        element('toggle-report').addEventListener('click', function () {
            var visible = element('report').hidden;
            element('report').hidden = !visible;
            element('toggle-report').textContent = visible ? 'Ocultar detalhes' : 'Ver detalhes do teste';
            element('toggle-report').setAttribute('aria-expanded', String(visible));
            if (visible) { showReport(); element('report').focus(); }
        });
        document.addEventListener('keydown', keydown);
        window.addEventListener('gamepadconnected', refreshGamepads);
        window.addEventListener('gamepaddisconnected', refreshGamepads);
        window.setInterval(function () { if (!document.hidden) { refreshGamepads(); } }, 2000);
        diagnose();
        element('launch').focus();
    });
}());
