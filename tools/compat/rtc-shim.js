// WebRTC fixes for the Tizen 5.5 engine (Chromium 69), injected before the
// NVIDIA client runs. Kept in ES2015 so it runs without transformation.
//
// Observed on UN43T5300AGXZD:
// - RTCPeerConnection.prototype.getConfiguration is missing. The webrtc-adapter
//   bundled in the SDK calls it inside setRemoteDescription once the user agent
//   reports Chrome >= 76, which threw and ended as error 0xC0F2220F.
// - The default SDP semantics is 'plan-b'. addTransceiver/getTransceivers, which
//   the SDK relies on, only work when the peer is built with
//   sdpSemantics:'unified-plan' (supported by the engine, just not the default).
//
// This only fills those two gaps. It does not touch SDP, codecs or ICE servers.
(function (win) {
    'use strict';
    var Native = win.RTCPeerConnection || win.webkitRTCPeerConnection;
    var state = { version: 1, nativePeer: typeof Native === 'function', getConfigurationAdded: false, unifiedPlanDefaulted: false, nativeDefault: null };
    if (win.__gfnRtcShim) { return; }
    win.__gfnRtcShim = state;
    if (typeof Native !== 'function') { return; }

    var proto = Native.prototype;
    var configs = new WeakMap();
    var nativeDefault = null;

    function closeQuietly(peer) { try { if (peer) { peer.close(); } } catch (ignore) { /* already closed */ } }

    // 'plan-b' when the engine defaults to it but accepts unified-plan on request,
    // 'unified-plan' when that is already the default, 'unknown' otherwise.
    function detectDefault() {
        var peer;
        if (nativeDefault !== null) { return nativeDefault; }
        nativeDefault = 'unknown';
        if (typeof proto.addTransceiver !== 'function') { state.nativeDefault = nativeDefault; return nativeDefault; }
        try {
            peer = new Native({});
            peer.addTransceiver('audio', { direction: 'recvonly' });
            nativeDefault = 'unified-plan';
        } catch (error) {
            closeQuietly(peer);
            peer = null;
            try {
                peer = new Native({ sdpSemantics: 'unified-plan' });
                peer.addTransceiver('audio', { direction: 'recvonly' });
                nativeDefault = 'plan-b';
            } catch (ignore) { nativeDefault = 'unknown'; }
        } finally { closeQuietly(peer); }
        state.nativeDefault = nativeDefault;
        return nativeDefault;
    }

    function copyObject(value) {
        var copy = {};
        var key;
        if (!value || typeof value !== 'object') { return copy; }
        for (key in value) { if (Object.prototype.hasOwnProperty.call(value, key)) { copy[key] = value[key]; } }
        return copy;
    }

    function copyServers(servers) {
        if (!Array.isArray(servers)) { return []; }
        return servers.map(function (server) {
            var copy = copyObject(server);
            if (Array.isArray(copy.urls)) { copy.urls = copy.urls.slice(); }
            return copy;
        });
    }

    function CompatiblePeerConnection(config, constraints) {
        var target = new.target;
        var effective = copyObject(config);
        var args;
        var peer;
        if (!target) { throw new TypeError("Failed to construct 'RTCPeerConnection': Please use the 'new' operator"); }
        if (!effective.sdpSemantics && detectDefault() === 'plan-b') {
            effective.sdpSemantics = 'unified-plan';
            state.unifiedPlanDefaulted = true;
        }
        args = arguments.length > 1 ? [effective, constraints] : [effective];
        peer = Reflect.construct(Native, args, target === CompatiblePeerConnection ? Native : target);
        configs.set(peer, effective);
        return peer;
    }
    CompatiblePeerConnection.prototype = proto;
    Object.setPrototypeOf(CompatiblePeerConnection, Native);
    Object.defineProperty(CompatiblePeerConnection, 'name', { value: 'RTCPeerConnection' });
    try { Object.defineProperty(proto, 'constructor', { value: CompatiblePeerConnection, writable: true, configurable: true }); } catch (ignore) { /* read-only */ }

    if (typeof proto.getConfiguration !== 'function') {
        Object.defineProperty(proto, 'getConfiguration', {
            configurable: true,
            writable: true,
            value: function getConfiguration() {
                var stored = configs.get(this) || {};
                return {
                    iceServers: copyServers(stored.iceServers),
                    iceTransportPolicy: stored.iceTransportPolicy || 'all',
                    bundlePolicy: stored.bundlePolicy || 'balanced',
                    rtcpMuxPolicy: stored.rtcpMuxPolicy || 'require',
                    iceCandidatePoolSize: stored.iceCandidatePoolSize || 0,
                    certificates: Array.isArray(stored.certificates) ? stored.certificates.slice() : [],
                    sdpSemantics: stored.sdpSemantics || (detectDefault() === 'unknown' ? 'plan-b' : nativeDefault)
                };
            }
        });
        state.getConfigurationAdded = true;
    }

    win.RTCPeerConnection = CompatiblePeerConnection;
    if (win.webkitRTCPeerConnection) { win.webkitRTCPeerConnection = CompatiblePeerConnection; }
}(window));
