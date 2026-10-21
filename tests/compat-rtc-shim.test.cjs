'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../tools/compat/rtc-shim.js'), 'utf8');

// Mimics the Tizen 5.5 engine: plan-b by default, unified-plan on request,
// no getConfiguration().
function tizenLikeWindow({defaultSemantics = 'plan-b', withGetConfiguration = false} = {}) {
  const created = [];
  class FakePeer {
    constructor(config) {
      this.config = config || {};
      this.semantics = this.config.sdpSemantics || defaultSemantics;
      this.closed = false;
      created.push(this);
    }
    addTransceiver(kind) {
      if (this.semantics !== 'unified-plan') throw new Error("InvalidStateError: only supported in 'unified-plan'");
      return {kind};
    }
    close() { this.closed = true; }
  }
  if (withGetConfiguration) FakePeer.prototype.getConfiguration = function () { return {native: true, sdpSemantics: this.semantics}; };
  const win = {RTCPeerConnection: FakePeer, webkitRTCPeerConnection: FakePeer};
  win.window = win;
  vm.runInNewContext(source, win);
  return {win, FakePeer, created};
}

test('missing getConfiguration is added and reports the configuration given to the native peer', () => {
  const {win, FakePeer, created} = tizenLikeWindow();
  const servers = [{urls: ['turn:example.invalid:3478'], username: 'u', credential: 'c'}];
  const peer = new win.RTCPeerConnection({iceServers: servers, iceTransportPolicy: 'relay'});
  assert.ok(peer instanceof FakePeer);
  assert.ok(peer instanceof win.RTCPeerConnection);
  const nativePeer = created[created.length - 1];
  assert.equal(nativePeer, peer);
  assert.equal(nativePeer.config.sdpSemantics, 'unified-plan');
  const config = peer.getConfiguration();
  assert.equal(config.sdpSemantics, 'unified-plan');
  assert.equal(config.iceTransportPolicy, 'relay');
  assert.equal(config.bundlePolicy, 'balanced');
  assert.deepEqual(JSON.parse(JSON.stringify(config.iceServers)), servers);
  config.iceServers[0].urls.push('mutated');
  assert.equal(peer.getConfiguration().iceServers[0].urls.length, 1, 'returned copies must not change stored config');
  assert.doesNotThrow(() => peer.addTransceiver('video'));
  assert.equal(win.__gfnRtcShim.getConfigurationAdded, true);
  assert.equal(win.__gfnRtcShim.unifiedPlanDefaulted, true);
  assert.equal(win.__gfnRtcShim.nativeDefault, 'plan-b');
  assert.equal(win.webkitRTCPeerConnection, win.RTCPeerConnection);
});

test('detection peers are closed and detection runs once', () => {
  const {win, created} = tizenLikeWindow();
  new win.RTCPeerConnection();
  const probes = created.slice(0, -1);
  assert.equal(probes.length, 2);
  assert.ok(probes.every(p => p.closed));
  const before = created.length;
  new win.RTCPeerConnection();
  assert.equal(created.length, before + 1);
});

test('explicit sdpSemantics is passed through unchanged', () => {
  const {win, created} = tizenLikeWindow();
  const peer = new win.RTCPeerConnection({sdpSemantics: 'plan-b'});
  assert.equal(created[created.length - 1].config.sdpSemantics, 'plan-b');
  assert.equal(peer.getConfiguration().sdpSemantics, 'plan-b');
});

test('engines that already default to unified-plan are not forced and keep a native getConfiguration', () => {
  const {win, created} = tizenLikeWindow({defaultSemantics: 'unified-plan', withGetConfiguration: true});
  const peer = new win.RTCPeerConnection({});
  assert.equal(created[created.length - 1].config.sdpSemantics, undefined);
  assert.deepEqual(peer.getConfiguration(), {native: true, sdpSemantics: 'unified-plan'});
  assert.equal(win.__gfnRtcShim.getConfigurationAdded, false);
  assert.equal(win.__gfnRtcShim.unifiedPlanDefaulted, false);
});

test('calling without new throws and subclasses keep their prototype', () => {
  const {win} = tizenLikeWindow();
  assert.throws(() => win.RTCPeerConnection({}), /new/);
  const Sub = vm.runInNewContext('(class Sub extends RTCPeerConnection { hello() { return 1; } })', win);
  const peer = new Sub({});
  assert.equal(peer.hello(), 1);
  assert.equal(peer.getConfiguration().sdpSemantics, 'unified-plan');
});

test('missing RTCPeerConnection leaves the page untouched', () => {
  const win = {};
  win.window = win;
  vm.runInNewContext(source, win);
  assert.equal(win.RTCPeerConnection, undefined);
  assert.equal(win.__gfnRtcShim.nativePeer, false);
});
