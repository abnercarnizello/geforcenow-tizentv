'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../tools/compat/polyfills.js'), 'utf8');

function legacyContext() {
  // VM supplies real ES2015 iterators/promises as Chrome 69 does. Remove the
  // post-Chrome-69 APIs before evaluating the exact browser-injected prelude.
  const context = vm.createContext({});
  vm.runInContext(`
    delete this.globalThis;
    delete Object.fromEntries;
    delete Array.prototype.flat;
    delete Array.prototype.flatMap;
    delete String.prototype.replaceAll;
    delete Promise.allSettled;
  `, context);
  vm.runInContext(source, context, {filename:'compat/polyfills.js', timeout:5000});
  return context;
}

function json(context, expression) {
  return JSON.parse(vm.runInContext('JSON.stringify(' + expression + ')', context));
}

test('vendored prelude matches its recorded upstream digest and carries its license', () => {
  const expected = source.match(/Upstream SHA-256: ([a-f0-9]{64})/)[1];
  const upstream = source.slice(source.indexOf(' */\n') + 4);
  assert.equal(crypto.createHash('sha256').update(upstream).digest('hex'), expected);
  assert.match(source, /Permission is hereby granted, free of charge/);
  assert.match(source, /core-js 3\.51\.0/);
});

test('globalThis works without window or document and retains browser capabilities honestly', () => {
  const context = legacyContext();
  assert.equal(vm.runInContext('globalThis === this', context), true);
  assert.equal(vm.runInContext('Object.getOwnPropertyDescriptor(this,"globalThis").enumerable', context), false);
  assert.equal(vm.runInContext('typeof RTCPeerConnection', context), 'undefined');
  assert.equal(vm.runInContext('typeof document', context), 'undefined');
  assert.equal(vm.runInContext('typeof navigator', context), 'undefined');
});

test('Object.fromEntries consumes iterables and preserves symbol and __proto__ keys safely', () => {
  const context = legacyContext();
  assert.deepEqual(json(context, `(() => {
    const key = Symbol('entry');
    const result = Object.fromEntries(new Map([['__proto__', 9], [key, 7], ['a', 1]]));
    return [result.__proto__, result[key], result.a, Object.getPrototypeOf(result) === Object.prototype];
  })()`), [9, 7, 1, true]);
});

test('flat handles sparse arrays and depth; flatMap passes callback context and removes holes', () => {
  const context = legacyContext();
  assert.deepEqual(json(context, '[1,,[2,,[3]]].flat()'), [1,2,[3]]);
  assert.deepEqual(json(context, '[1,,[2,,[3]]].flat(Infinity)'), [1,2,3]);
  assert.deepEqual(json(context, `[2,,3].flatMap(function(value,index,array) {
    return [value * this.multiplier, index, array.length];
  }, {multiplier:10})`), [20,0,3,30,2,3]);
});

test('replaceAll preserves replacement tokens, literal patterns and regexp validation', () => {
  const context = legacyContext();
  assert.equal(vm.runInContext('"a.b.a".replaceAll(".", "$$")', context), 'a$b$a');
  assert.equal(vm.runInContext('"ab".replaceAll("", "-")', context), '-a-b-');
  assert.equal(vm.runInContext('"aba".replaceAll(/a/g, function(match,index){ return index; })', context), '0b2');
  assert.equal(vm.runInContext('(() => {try {"aa".replaceAll(/a/, "b");return false;}catch(e){return e instanceof TypeError;}})()', context), true);
});

test('allSettled preserves iterable order and both outcomes, including an empty iterable', async () => {
  const context = legacyContext();
  const result = await vm.runInContext(`Promise.allSettled(new Set([
    Promise.resolve('first'), Promise.reject('second'), 3
  ])).then(JSON.stringify)`, context);
  assert.deepEqual(JSON.parse(result), [
    {status:'fulfilled',value:'first'},
    {status:'rejected',reason:'second'},
    {status:'fulfilled',value:3}
  ]);
  assert.equal(await vm.runInContext('Promise.allSettled([]).then(JSON.stringify)', context), '[]');
});

test('loading the prelude twice preserves existing native promises and installed APIs', () => {
  const context = vm.createContext({});
  vm.runInContext('this.originalResolve = Promise.resolve; this.originalFromEntries = Object.fromEntries;', context);
  vm.runInContext(source, context, {timeout:5000});
  vm.runInContext(source, context, {timeout:5000});
  assert.equal(vm.runInContext('Promise.resolve === originalResolve', context), true);
  assert.equal(vm.runInContext('Object.fromEntries === originalFromEntries', context), true);
});
