'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const diagnostics = require('../js/diagnostics.js');

function browser(Peer, extras) {
    return Object.assign({
        Promise,
        RTCPeerConnection: Peer,
        navigator: { userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.5) AppleWebKit/537.36 Chrome/69.0.3497.106 TV Safari/537.36' },
        setTimeout,
        clearTimeout,
        document: { createElement: () => ({ canPlayType: () => 'probably' }) }
    }, extras);
}

function peer(offerImplementation) {
    const calls = { closed: 0, channelClosed: 0, configs: [], transceivers: [] };
    class Peer {
        constructor(config) { calls.configs.push(config); }
        createDataChannel(label) {
            calls.label = label;
            return { close() { calls.channelClosed++; } };
        }
        addTransceiver(kind, options) { calls.transceivers.push({ kind, options }); }
        createOffer(options) { calls.offerOptions = options; return offerImplementation(); }
        close() { calls.closed++; }
    }
    return { Peer, calls };
}

test('browser module loads without CommonJS and reports actual Tizen UA without modifying it', () => {
    const win = browser(function () {});
    const originalUa = win.navigator.userAgent;
    const context = vm.createContext({ window: win });
    vm.runInContext(fs.readFileSync(require.resolve('../js/diagnostics.js'), 'utf8'), context);
    const report = win.GfnDiagnostics.inspect(win);
    assert.equal(report.userAgent, originalUa);
    assert.equal(win.navigator.userAgent, originalUa);
    assert.equal(report.engine.name, 'Chromium');
    assert.equal(report.engine.major, 69);
    assert.equal(report.engine.belowGfnBrowserMinimum, true);
    assert.equal(report.platform.tizenVersion, '5.5');
    assert.equal(report.status, 'limited');
    assert.equal(report.video.h264Playback.status, 'advertised');
    assert.equal(report.video.isWebRtcDecodeTest, false);
    assert.equal(report.streamingVerified, false);
});

test('missing APIs and unknown engine remain explicit rather than claiming compatibility', () => {
    const report = diagnostics.inspect({ navigator: { userAgent: 'Unknown device' } });
    assert.equal(report.engine.name, 'unknown');
    assert.equal(report.engine.belowGfnBrowserMinimum, null);
    assert.equal(report.video.h264Playback.status, 'unknown');
    assert.equal(report.status, 'blocked');
    assert.ok(report.reasons.includes('webrtc-unavailable'));
    assert.ok(report.reasons.includes('promise-unavailable'));
});

test('actual T5300 bare Chromium UA is recognized without confusing the WebKit token', () => {
    const report = diagnostics.inspect(browser(function () {}, {
        navigator: {userAgent:'Mozilla/5.0 (SMART-TV; LINUX; Tizen 5.5) AppleWebKit/537.36 (KHTML, like Gecko) 69.0.3497.106/5.5 TV Safari/537.36'}
    }));
    assert.equal(report.engine.name, 'Chromium');
    assert.equal(report.engine.version, '69.0.3497.106');
    assert.equal(report.engine.belowGfnBrowserMinimum, true);
});

test('unsupported NVIDIA page syntax blocks readiness despite an available WebRTC API', () => {
    const report=diagnostics.inspect(browser(function () {}, {
        Function(){throw new SyntaxError('Unexpected token .');}
    }));
    assert.equal(report.javascript.optionalChaining.status,'unsupported');
    assert.equal(report.status,'blocked');
    assert.ok(report.reasons.includes('gfn-page-syntax-unsupported'));
});

test('CSP refusal is unknown syntax support, while supported syntax never proves streaming', () => {
    let report=diagnostics.inspect(browser(function () {}, {Function(){throw new EvalError('CSP');}}));
    assert.equal(report.javascript.optionalChaining.status,'unknown');
    assert.equal(report.reasons.includes('gfn-page-syntax-unsupported'),false);
    report=diagnostics.inspect(browser(function () {}, {Function,globalThis:{}}));
    assert.equal(report.javascript.optionalChaining.status,'supported');
    assert.equal(report.javascript.globalThis,true);
    assert.equal(report.streamingVerified,false);
});

test('gamepad inventory handles sparse arrays and errors without failing inspection', () => {
    let report = diagnostics.inspect(browser(function () {}, {
        navigator: { getGamepads: () => [null, { index: 1, id: 'USB gamepad', mapping: 'standard', connected: true, buttons: [{ pressed: false }], axes: [0, 0] }] }
    }));
    assert.deepEqual(report.gamepads.devices, [{ index: 1, id: 'USB gamepad', mapping: 'standard', connected: true, buttons: 1, axes: 2 }]);
    report = diagnostics.inspect(browser(function () {}, {
        navigator: { getGamepads() { throw new Error('Permission denied'); } }
    }));
    assert.equal(report.gamepads.status, 'failed');
    assert.equal(report.gamepads.error, 'Permission denied');
});

test('local offer probes recvonly video and data channel with no STUN and always closes resources', async () => {
    const { Peer, calls } = peer(() => Promise.resolve({ sdp: [
        'v=0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 111',
        'a=rtpmap:111/ignored H264/90000',
        'm=video 9 UDP/TLS/RTP/SAVPF 96 97 98 99',
        'a=rtpmap:96 H264/90000',
        'a=fmtp:96 profile-level-id=42e01f;packetization-mode=1',
        'a=rtpmap:97 rtx/90000',
        'a=fmtp:97 apt=96',
        'a=rtpmap:98 VP8/90000',
        'a=rtpmap:99 vp9/90000',
        'm=application 9 DTLS/SCTP 5000'
    ].join('\r\n') }));
    const result = await diagnostics.probeWebRtc(browser(Peer));
    assert.equal(result.status, 'offer-created');
    assert.deepEqual(calls.configs, [{ iceServers: [] }]);
    assert.deepEqual(calls.transceivers, [{ kind: 'video', options: { direction: 'recvonly' } }]);
    assert.equal(result.dataChannelCreated, true);
    assert.equal(result.h264, true);
    assert.equal(result.vp8, true);
    assert.equal(result.vp9, true);
    assert.equal(result.codecs[0].fmtp, 'profile-level-id=42e01f;packetization-mode=1');
    assert.equal(result.codecs[1].name, 'RTX');
    assert.equal(result.scope, 'local-sdp-offer');
    assert.equal(result.streamingVerified, false);
    assert.equal(calls.closed, 1);
    assert.equal(calls.channelClosed, 1);
});

test('SDP codec parsing ignores audio, rejected video, unlisted payloads and application metadata', async () => {
    const { Peer } = peer(() => Promise.resolve({ sdp: [
        'v=0',
        'm=audio 9 UDP/TLS/RTP/SAVPF 96',
        'a=rtpmap:96 H264/90000',
        'm=video 0 UDP/TLS/RTP/SAVPF 96',
        'a=rtpmap:96 H264/90000',
        'm=video 9 UDP/TLS/RTP/SAVPF 98',
        'a=rtpmap:96 H264/90000',
        'a=rtpmap:98 VP8/90000',
        'm=application 9 DTLS/SCTP 5000',
        'a=rtpmap:99 VP9/90000'
    ].join('\n') }));
    const result = await diagnostics.probeWebRtc(browser(Peer));
    assert.equal(result.h264, false);
    assert.equal(result.vp8, true);
    assert.equal(result.vp9, false);
    assert.deepEqual(result.codecs.map(codec => codec.name), ['VP8']);
});

test('older prefixed callback implementation uses offerToReceiveVideo and closes peer', async () => {
    const calls = { closed: 0 };
    function LegacyPeer() {}
    LegacyPeer.prototype.createOffer = function (success, failure, options) {
        calls.options = options;
        success({ sdp: 'v=0\r\nm=video 9 RTP/SAVPF 96\r\na=rtpmap:96 H264/90000\r\n' });
    };
    LegacyPeer.prototype.close = function () { calls.closed++; };
    const result = await diagnostics.probeWebRtc(browser(undefined, { webkitRTCPeerConnection: LegacyPeer }));
    assert.equal(result.status, 'offer-created');
    assert.equal(result.h264, true);
    assert.equal(result.dataChannelCreated, false);
    assert.equal(calls.options.offerToReceiveVideo, true);
    assert.equal(calls.closed, 1);
});

test('offer rejection closes channel and peer without converting failure to codec absence', async () => {
    const { Peer, calls } = peer(() => Promise.reject(new Error('Codec initialization failed')));
    const result = await diagnostics.probeWebRtc(browser(Peer));
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'Codec initialization failed');
    assert.equal(result.h264, null);
    assert.equal(calls.closed, 1);
    assert.equal(calls.channelClosed, 1);
});

test('synchronous errors, malformed SDP and cleanup errors still return bounded failures', async () => {
    const { Peer, calls } = peer(() => { throw new Error('Native failure'); });
    let result = await diagnostics.probeWebRtc(browser(Peer));
    assert.equal(result.status, 'failed');
    assert.equal(calls.closed, 1);
    const malformed = peer(() => Promise.resolve({ sdp: 'invalid' }));
    malformed.Peer.prototype.close = function () { throw new Error('Close failure'); };
    result = await diagnostics.probeWebRtc(browser(malformed.Peer));
    assert.equal(result.status, 'failed');
    assert.match(result.error, /valid SDP/);
    assert.equal(result.h264, null);
});

test('timeout closes a hanging peer and late offer cannot mutate the returned report', async () => {
    let complete;
    const { Peer, calls } = peer(() => new Promise(resolve => { complete = resolve; }));
    const result = await diagnostics.probeWebRtc(browser(Peer), { timeoutMs: 5 });
    assert.equal(result.status, 'timeout');
    assert.equal(calls.closed, 1);
    assert.equal(calls.channelClosed, 1);
    complete({ sdp: 'm=video 9 RTP/SAVPF 96\na=rtpmap:96 H264/90000' });
    await Promise.resolve();
    assert.equal(result.status, 'timeout');
    assert.equal(result.h264, null);
    assert.equal(calls.closed, 1);
});

test('unsupported peer constructor returns no codec or streaming claims', async () => {
    const result = await diagnostics.probeWebRtc(browser(undefined));
    assert.equal(result.status, 'unsupported');
    assert.equal(result.h264, null);
    assert.equal(result.streamingVerified, false);
});
