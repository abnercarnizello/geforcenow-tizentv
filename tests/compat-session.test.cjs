'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const source = fs.readFileSync(path.join(__dirname, '../tools/compat/session.cjs'), 'utf8');

async function disconnectScenario(closeDuringStartup) {
  const commands = [], logs = [], reports = [];
  const timeouts = new Set(), intervals = new Set();
  const processState = new EventEmitter();
  processState.env = {GFN_OBSERVE_MS:'0',GFN_CAPTURE_TEXT:'0'};
  let sockets = 0;
  class FakeCDP extends EventTarget {
    static OPEN = 1;
    constructor() {
      super();
      sockets++;
      this.readyState = 0;
      setImmediate(() => { this.readyState=FakeCDP.OPEN; this.dispatchEvent(new Event('open')); });
    }
    send(payload) {
      assert.equal(this.readyState, FakeCDP.OPEN, 'No command may be sent after disconnection');
      const command = JSON.parse(payload);
      commands.push(command.method);
      if (closeDuringStartup && command.method === 'Browser.getVersion') {
        setImmediate(() => this.close());
        return; // A real pending CDP command is rejected by the close event.
      }
      queueMicrotask(() => {
        const event = new Event('message');
        event.data = JSON.stringify({id:command.id,result:{}});
        this.dispatchEvent(event);
      });
      if (command.method === 'Page.navigate') setImmediate(() => this.close());
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
  }
  const context = vm.createContext({
    __dirname:path.join(__dirname, '../tools/compat'),
    require(name) {
      if (name === 'node:fs') return {writeFileSync(file,content) { reports.push(JSON.parse(content)); }};
      if (name === './adapter.cjs') return {createAdapter:() => ({transformed:[],eligible:() => false})};
      return require(name);
    },
    process:processState,
    console:{log:value => logs.push(String(value)),error:value => logs.push(String(value))},
    WebSocket:FakeCDP,
    fetch:async () => ({json:async () => [{type:'page',url:'https://play.geforcenow.com/mall/',webSocketDebuggerUrl:'ws://fixture.invalid/page'}]}),
    URL,Buffer,
    setTimeout(callback, duration) { const timer=setTimeout(callback,duration); timeouts.add(timer); return timer; },
    clearTimeout(timer) { timeouts.delete(timer); clearTimeout(timer); },
    setInterval(callback, duration) { const timer=setInterval(callback,duration); intervals.add(timer); return timer; },
    clearInterval(timer) { intervals.delete(timer); clearInterval(timer); }
  });
  let watchdog;
  try {
    await Promise.race([
      vm.runInContext(source, context, {filename:'compat/session.cjs'}),
      new Promise((resolve,reject) => { watchdog=setTimeout(() => reject(new Error('Session did not end promptly after CDP close')),1000); })
    ]);
    return {commands,logs,reports,sockets,exitCode:processState.exitCode,remainingTimeouts:timeouts.size,remainingIntervals:intervals.size};
  } finally {
    clearTimeout(watchdog);
    for (const timer of timeouts) clearTimeout(timer);
    for (const timer of intervals) clearInterval(timer);
  }
}

test('TV disconnection ends a persistent session without querying the closed socket or reconnecting', async () => {
  const result = await disconnectScenario(false);
  assert.equal(result.exitCode, undefined);
  assert.equal(result.sockets, 1);
  assert.equal(result.commands.filter(command => command === 'Page.navigate').length, 1);
  assert.equal(result.commands.includes('Runtime.evaluate'), false);
  assert.equal(result.reports.at(-1).final.connectionEnded, true);
  assert.ok(result.logs.some(line => line.includes('Conexao com a TV encerrada')));
  assert.equal(result.remainingTimeouts, 0);
  assert.equal(result.remainingIntervals, 0);
});

test('disconnect rejects an outstanding CDP request and skips disconnected cleanup calls immediately', async () => {
  const result = await disconnectScenario(true);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.commands, ['Browser.getVersion']);
  assert.equal(result.sockets, 1);
  assert.equal(result.remainingTimeouts, 0);
  assert.equal(result.remainingIntervals, 0);
  assert.ok(result.logs.some(line => line.includes('Conexao com a TV encerrada')));
});
