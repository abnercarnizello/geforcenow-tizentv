(function (root, factory) {
    'use strict';
    var diagnostics = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = diagnostics;
    } else {
        root.GfnDiagnostics = diagnostics;
    }
}(typeof window !== 'undefined' ? window : this, function () {
    'use strict';

    function message(error) {
        return String(error && error.message ? error.message : error || 'Unknown error').slice(0, 500);
    }

    function peerConstructor(win) {
        return win.RTCPeerConnection || win.webkitRTCPeerConnection;
    }

    function syntaxProbe(win, source) {
        if (typeof win.Function !== 'function') { return { status: 'unknown', error: 'Function constructor unavailable' }; }
        try {
            // Only compile a fixed, local test. Never evaluate downloaded code here.
            win.Function(source);
            return { status: 'supported', error: null };
        } catch (error) {
            return { status: error && error.name === 'SyntaxError' ? 'unsupported' : 'unknown', error: message(error) };
        }
    }

    function inspect(win) {
        var nav = win.navigator || {};
        var ua = String(nav.userAgent || '');
        var chromium = /(?:Chrome|Chromium)\/([\d.]+)/i.exec(ua);
        var webkit = /AppleWebKit\/([\d.]+)/i.exec(ua);
        var tizen = /Tizen[\s\/]([\d.]+)/i.exec(ua);
        // Actual T5300 UA: "... (KHTML, like Gecko) 69.0.3497.106/5.5 TV ...".
        // The AppleWebKit compatibility token is not its engine identity.
        if (!chromium && tizen) { chromium = /\b(\d+\.\d+\.\d+\.\d+)\/\d+\.\d+\s+TV\b/i.exec(ua); }
        var javascript = {
            optionalChaining: syntaxProbe(win, 'return ({ value: 1 })?.value;'),
            globalThis: typeof win.globalThis !== 'undefined',
            scope: 'local-runtime-feature-tests'
        };
        var engine = {
            name: chromium ? 'Chromium' : webkit ? 'WebKit' : 'unknown',
            version: chromium ? chromium[1] : webkit ? webkit[1] : null,
            major: chromium ? parseInt(chromium[1], 10) : webkit ? parseInt(webkit[1], 10) : null,
            belowGfnBrowserMinimum: chromium ? parseInt(chromium[1], 10) < 77 : null,
            source: 'reported-user-agent'
        };
        var apis = {
            promise: typeof win.Promise === 'function',
            webRtc: typeof peerConstructor(win) === 'function',
            webSocket: typeof win.WebSocket === 'function',
            webAssembly: typeof win.WebAssembly === 'object',
            webCrypto: !!(win.crypto && win.crypto.subtle),
            gamepad: typeof nav.getGamepads === 'function'
        };
        var gamepads = { status: apis.gamepad ? 'available' : 'unsupported', devices: [], error: null };
        var h264 = { status: 'unknown', result: '', mimeType: 'video/mp4; codecs="avc1.42E01E"', error: null };
        var reasons = [];
        var pads;
        var pad;
        var video;
        var i;
        if (apis.gamepad) {
            try {
                pads = nav.getGamepads() || [];
                for (i = 0; i < pads.length; i += 1) {
                    pad = pads[i];
                    if (pad) {
                        gamepads.devices.push({
                            index: pad.index,
                            id: String(pad.id || ''),
                            mapping: String(pad.mapping || ''),
                            connected: pad.connected !== false,
                            buttons: pad.buttons ? pad.buttons.length : 0,
                            axes: pad.axes ? pad.axes.length : 0
                        });
                    }
                }
            } catch (error) {
                gamepads.status = 'failed';
                gamepads.error = message(error);
            }
        }
        try {
            video = win.document && win.document.createElement('video');
            if (video && typeof video.canPlayType === 'function') {
                h264.result = video.canPlayType(h264.mimeType) || '';
                h264.status = h264.result === 'probably' || h264.result === 'maybe' ? 'advertised' : 'not-advertised';
            }
        } catch (error) {
            h264.error = message(error);
        }
        if (!apis.promise) { reasons.push('promise-unavailable'); }
        if (!apis.webRtc) { reasons.push('webrtc-unavailable'); }
        if (javascript.optionalChaining.status === 'unsupported') { reasons.push('gfn-page-syntax-unsupported'); }
        if (engine.belowGfnBrowserMinimum) { reasons.push('chromium-below-gfn-browser-minimum'); }
        if (h264.status === 'not-advertised') { reasons.push('h264-file-playback-not-advertised'); }
        if (!apis.gamepad) { reasons.push('gamepad-api-unavailable'); }
        return {
            schemaVersion: 1,
            userAgent: ua,
            engine: engine,
            platform: { isTizen: !!tizen || !!win.tizen, tizenVersion: tizen ? tizen[1] : null },
            apis: apis,
            javascript: javascript,
            gamepads: gamepads,
            video: { h264Playback: h264, isWebRtcDecodeTest: false },
            status: !apis.promise || !apis.webRtc || javascript.optionalChaining.status === 'unsupported' ? 'blocked' : reasons.length ? 'limited' : 'unverified',
            reasons: reasons,
            streamingVerified: false,
            limitations: [
                'User-agent reports a version; it does not prove the underlying engine version.',
                'MP4 canPlayType is a playback capability hint, not a WebRTC decoder test.',
                'No NVIDIA authentication, network streaming or game session has been tested.'
            ]
        };
    }

    function parseOffer(sdp) {
        var lines = sdp.split(/\r?\n/);
        var sections = [];
        var section = null;
        var codecs = [];
        var match;
        var parts;
        var payload;
        var item;
        var i;
        var j;
        for (i = 0; i < lines.length; i += 1) {
            if (lines[i].slice(0, 2) === 'm=') {
                parts = lines[i].trim().split(/\s+/);
                section = parts[0] === 'm=video' && parts[1] !== '0' ? { payloads: parts.slice(3), maps: {}, parameters: {} } : null;
                if (section) { sections.push(section); }
            } else if (section) {
                match = /^a=rtpmap:(\d+)\s+([^\s/]+)\/(\d+)(?:\/\d+)?\s*$/i.exec(lines[i]);
                if (match) {
                    section.maps[match[1]] = { name: match[2].toUpperCase(), clockRate: parseInt(match[3], 10) };
                }
                match = /^a=fmtp:(\d+)\s+(.+)$/i.exec(lines[i]);
                if (match) { section.parameters[match[1]] = match[2].trim(); }
            }
        }
        for (i = 0; i < sections.length; i += 1) {
            section = sections[i];
            for (j = 0; j < section.payloads.length; j += 1) {
                payload = section.payloads[j];
                item = section.maps[payload];
                if (item) {
                    codecs.push({
                        payloadType: parseInt(payload, 10),
                        name: item.name,
                        clockRate: item.clockRate,
                        fmtp: section.parameters[payload] || '',
                        videoSection: i
                    });
                }
            }
        }
        return codecs;
    }

    function probeWebRtc(win, options) {
        var PromiseType = win.Promise || (typeof Promise !== 'undefined' ? Promise : null);
        if (!PromiseType) { throw new Error('Promise API unavailable; WebRTC probe cannot run.'); }
        return new PromiseType(function (resolve) {
            var Constructor = peerConstructor(win);
            var pc = null;
            var channel = null;
            var settled = false;
            var timer = null;
            var timeoutMs = options && Number(options.timeoutMs);
            var setTimer = win.setTimeout ? function (fn, delay) { return win.setTimeout(fn, delay); } : setTimeout;
            var clearTimer = win.clearTimeout ? function (id) { win.clearTimeout(id); } : clearTimeout;
            var result = {
                status: 'unsupported',
                scope: 'local-sdp-offer',
                h264: null,
                vp8: null,
                vp9: null,
                codecs: [],
                dataChannelCreated: false,
                streamingVerified: false,
                error: null,
                limitations: [
                    'An SDP offer advertises codecs; it does not prove decoding or server compatibility.',
                    'The local data channel is created but no remote peer, STUN server or network session is used.'
                ]
            };
            if (!(timeoutMs >= 1 && timeoutMs <= 30000)) { timeoutMs = 8000; }
            function finish(status, error) {
                if (settled) { return; }
                settled = true;
                result.status = status;
                result.error = error ? message(error) : null;
                if (timer !== null) { clearTimer(timer); }
                if (channel && typeof channel.close === 'function') {
                    try { channel.close(); } catch (ignored) { /* Continue closing the peer. */ }
                }
                if (pc && typeof pc.close === 'function') {
                    try { pc.close(); } catch (ignored) { /* Cleanup must not hide the probe result. */ }
                }
                resolve(result);
            }
            function failed(error) { finish('failed', error); }
            function offered(offer) {
                var i;
                if (settled) { return; }
                if (!offer || typeof offer.sdp !== 'string' || !/^m=/m.test(offer.sdp)) {
                    failed(new Error('createOffer returned no valid SDP media sections.'));
                    return;
                }
                result.codecs = parseOffer(offer.sdp);
                result.h264 = false;
                result.vp8 = false;
                result.vp9 = false;
                for (i = 0; i < result.codecs.length; i += 1) {
                    if (result.codecs[i].name === 'H264') { result.h264 = true; }
                    if (result.codecs[i].name === 'VP8') { result.vp8 = true; }
                    if (result.codecs[i].name === 'VP9') { result.vp9 = true; }
                }
                finish('offer-created');
            }
            if (typeof Constructor !== 'function') { finish('unsupported'); return; }
            timer = setTimer(function () { finish('timeout', new Error('WebRTC offer timed out.')); }, timeoutMs);
            try {
                pc = new Constructor({ iceServers: [] });
                if (typeof pc.createDataChannel === 'function') {
                    channel = pc.createDataChannel('gfn-local-diagnostic');
                    result.dataChannelCreated = !!channel;
                }
                if (typeof pc.addTransceiver === 'function') {
                    try { pc.addTransceiver('video', { direction: 'recvonly' }); } catch (ignored) {
                        // offerToReceiveVideo below also supports older implementations.
                    }
                }
                if (typeof pc.createOffer !== 'function') {
                    failed(new Error('RTCPeerConnection.createOffer unavailable.'));
                } else if (pc.createOffer.length >= 2) {
                    pc.createOffer(offered, failed, { offerToReceiveVideo: true, offerToReceiveAudio: false });
                } else {
                    var offer = pc.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: false });
                    if (offer && typeof offer.then === 'function') { offer.then(offered, failed); }
                    else { failed(new Error('createOffer did not return a Promise.')); }
                }
            } catch (error) { failed(error); }
        });
    }

    return { inspect: inspect, probeWebRtc: probeWebRtc };
}));
