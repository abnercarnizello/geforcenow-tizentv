(function (win) {
    'use strict';
    if (win.__gfnCompatProbe) { return; }
    var peers = [];
    var Native = win.RTCPeerConnection || win.webkitRTCPeerConnection;
    var state = { peers: peers, nativePeerAvailable: typeof Native === 'function' };
    win.__gfnCompatProbe = state;
    if (typeof Native !== 'function') { return; }
    function ObservedPeer(config, constraints) {
        if (!(this instanceof ObservedPeer)) { throw new TypeError('RTCPeerConnection requires new'); }
        var peer = arguments.length > 1 ? new Native(config, constraints) : new Native(config);
        peers.push(peer);
        return peer;
    }
    ObservedPeer.prototype = Native.prototype;
    if (Object.setPrototypeOf) { Object.setPrototypeOf(ObservedPeer, Native); }
    win.RTCPeerConnection = ObservedPeer;
    if (win.webkitRTCPeerConnection === Native) { win.webkitRTCPeerConnection = ObservedPeer; }
}(window));
