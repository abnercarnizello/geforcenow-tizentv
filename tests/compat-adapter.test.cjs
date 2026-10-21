'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {createAdapter,eligible,WORKER_URL,COMMON_URL} = require('../tools/compat/adapter.cjs');
const root = path.resolve(__dirname, '..');
const available = fs.existsSync(path.join(root, '.tools/compat-deps/node_modules/esbuild/package.json')) &&
  fs.existsSync(path.join(root, '.tools/compat-deps/node_modules/@juggle/resize-observer/lib/exports/resize-observer.umd.js'));
const requiresCompiler = {skip:available ? false : 'Optional compatibility compiler dependencies are absent; run tools/compat/start.ps1 to prepare them.'};

function fixture(t, extras = {}) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gfn-adapter-test-'));
  t.after(() => fs.rmSync(cacheDir, {recursive:true,force:true}));
  const calls = [];
  const sources = {
    [WORKER_URL]:'var req = {}; req.p = ""; importScripts(req.p + "common.1bb8089756535934.js"); globalThis.workerAnswer = globalThis.commonValue?.value ?? 0; importScripts("https://play.geforcenow.com/mall/unmapped.js");',
    [COMMON_URL]:'globalThis.commonValue = {value:41};',
    'https://play.geforcenow.com/mall/':'<html><head></head><body></body></html>',
    ...extras
  };
  const fetchImpl = async (url, options) => {
    calls.push({url,options});
    if (!Object.prototype.hasOwnProperty.call(sources, url)) throw new Error('Unexpected fixture fetch: ' + url);
    return {ok:true,status:200,text:async () => sources[url]};
  };
  return {adapter:createAdapter({root,cacheDir,fetchImpl}),calls,cacheDir};
}

test('scope excludes authentication, APIs, foreign origins and queried scripts', () => {
  for (const [url,type] of [
    ['https://login.nvidia.com/authorize?code=secret','Document'],
    ['https://play.geforcenow.com/auth/callback?code=secret','Document'],
    ['https://play.geforcenow.com/mall/main.js?token=secret','Script'],
    ['https://play.geforcenow.com/mall/main.js#x','Script'],
    ['https://play.geforcenow.com/mall/config.json','Script'],
    ['https://play.geforcenow.com/mall/main.js','XHR'],
    ['https://someone:secret@play.geforcenow.com/mall/main.js','Script'],
    ['http://play.geforcenow.com/mall/main.js','Script'],
    ['https://play.geforcenow.com.evil.example/mall/main.js','Script']
  ]) assert.equal(eligible(url,type), false, url);
  for (const route of ['/', '/mall/', '/mall/index.html', '/games']) {
    assert.equal(eligible('https://play.geforcenow.com' + route + '?launch=secret', 'Document'), true);
  }
});

test('rejected resources never reach the fetch implementation', requiresCompiler, async t => {
  const {adapter,calls} = fixture(t);
  await assert.rejects(adapter.resource('https://login.nvidia.com/authorize','Document'), /outside public/);
  await assert.rejects(adapter.resource('https://play.geforcenow.com/mall/main.js?code=secret','Script'), /outside public/);
  assert.equal(calls.length, 0);
});

test('downlevelled optional chaining and class fields preserve executable results', requiresCompiler, async t => {
  const {adapter} = fixture(t);
  const source = 'class Example { value = 7; #secret = 3; get() { return this?.value + this.#secret; }} globalThis.answer = new Example().get() ?? 99;';
  const result = await adapter.transformScript(source, 'https://play.geforcenow.com/mall/main.abc.js');
  assert.doesNotMatch(result, /\?\.|#secret/);
  const context = vm.createContext({});
  vm.runInContext(result, context);
  assert.equal(context.answer, 10);
});

test('HTML preserves JSON/import maps and foreign script integrity while lowering executable inline code', requiresCompiler, async t => {
  const {adapter} = fixture(t);
  const json = '{"nested":{"optional":"a?.b"}}';
  const importMap = '{"imports":{"example":"https://example.com/module.js"}}';
  const html = '<html><head>' +
    '<script type="application/ld+json">' + json + '</script>' +
    '<script type=application/json>' + json + '</script>' +
    '<script type="importmap">' + importMap + '</script>' +
    '<script>globalThis.inlineResult = ({value:8})?.value ?? 4;</script>' +
    '<script src="/mall/main.abc.js" integrity="sha384-public"></script>' +
    '<script src="https://example.com/other.js" integrity="sha384-foreign"></script>' +
    '</head><body></body></html>';
  const result = await adapter.transformHtml(html, 'https://play.geforcenow.com/mall/');
  assert.ok(result.includes('<script type="application/ld+json">' + json + '</script>'));
  assert.ok(result.includes('<script type=application/json>' + json + '</script>'));
  assert.ok(result.includes('<script type="importmap">' + importMap + '</script>'));
  assert.ok(!result.includes('sha384-public'));
  assert.ok(result.includes('integrity="sha384-foreign"'));
  const inline = [...result.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
  assert.doesNotMatch(inline, /\?\./);
  const context = vm.createContext({});
  vm.runInContext(inline, context);
  assert.equal(context.inlineResult, 8);
});

test('runtime integrity patch requires exactly one known loader assignment', requiresCompiler, async t => {
  const {adapter} = fixture(t);
  const source = 'const r={sriHashes:{a:"sha384-original"}}; const s={}; s.integrity=r.sriHashes["a"]; globalThis.integrity=s.integrity;';
  const patched = await adapter.transformScript(source, 'https://play.geforcenow.com/mall/runtime.abc.js');
  const context = vm.createContext({});
  vm.runInContext(patched, context);
  assert.equal(context.integrity, '');
  const original = await adapter.transformScript(source, 'https://play.geforcenow.com/mall/main.abc.js');
  vm.runInContext(original, vm.createContext({}));
  assert.match(original, /sha384-original/);
  await assert.rejects(adapter.transformScript('globalThis.noLoader=true;', 'https://play.geforcenow.com/mall/runtime.abc.js'), /Unexpected webpack/);
  await assert.rejects(adapter.transformScript('var s={},r={sriHashes:{}};s.integrity=r.sriHashes[1];s.integrity=r.sriHashes[2];', 'https://play.geforcenow.com/mall/runtime.abc.js'), /Unexpected webpack/);
});

test('document query context is excluded from upstream fetches, metadata and cache identity', requiresCompiler, async t => {
  const {adapter,calls,cacheDir} = fixture(t);
  const first = await adapter.resource('https://play.geforcenow.com/mall/?code=secret-one', 'Document');
  const second = await adapter.resource('https://play.geforcenow.com/mall/?code=secret-two', 'Document');
  assert.equal(first, second);
  assert.equal(calls.filter(call => call.url === 'https://play.geforcenow.com/mall/').length, 1);
  for (const call of calls) {
    assert.equal(new URL(call.url).search, '');
    // Redirects are never followed by the PC: documents read them manually
    // (see the redirect test), scripts reject them.
    assert.equal(call.options.redirect, /\.js$/.test(call.url) ? 'error' : 'manual');
    assert.equal(call.options.credentials, 'omit');
    assert.deepEqual(Object.keys(call.options.headers), ['User-Agent']);
  }
  assert.doesNotMatch(JSON.stringify(adapter.transformed), /secret-one|secret-two/);
  for (const file of fs.readdirSync(cacheDir)) {
    assert.doesNotMatch(fs.readFileSync(path.join(cacheDir,file),'utf8'), /secret-one|secret-two/);
  }
});

test('worker bootstrap installs core APIs and evaluates only the pinned transformed common dependency', requiresCompiler, async t => {
  const {adapter} = fixture(t);
  const prelude = await adapter.preparePrelude();
  const blobs = [];
  const created = [];
  const nativeImports = [];
  class TestURL extends URL {
    static createObjectURL(blob) { blobs.push(blob.source); return 'blob:fixture/' + blobs.length; }
    static revokeObjectURL() {}
  }
  function TestBlob(parts) { this.source = parts.join(''); }
  function NativeWorker(url, options) { this.url = url; this.options = options; created.push(this); }
  const page = vm.createContext({URL:TestURL,URLSearchParams,Blob:TestBlob,Worker:NativeWorker,document:{baseURI:'https://play.geforcenow.com/mall/'},setTimeout:() => 0});
  vm.runInContext('this.self=this;this.window=this;', page);
  vm.runInContext(prelude, page, {timeout:5000});
  vm.runInContext('new Worker(' + JSON.stringify(WORKER_URL) + ',{name:"fixture"}); new Worker("/mall/other.js");', page);
  assert.equal(created[0].url, 'blob:fixture/1');
  assert.equal(created[0].options.name, 'fixture');
  assert.equal(created[1].url, '/mall/other.js');
  assert.equal(blobs.length, 1);
  const worker = vm.createContext({importScripts:url => nativeImports.push(url)});
  vm.runInContext('this.self=this;delete this.globalThis;', worker);
  vm.runInContext(blobs[0], worker, {timeout:5000});
  assert.equal(worker.workerAnswer, 41);
  assert.deepEqual(nativeImports, ['https://play.geforcenow.com/mall/unmapped.js']);
  assert.equal(vm.runInContext('globalThis === self', worker), true);
  assert.equal(vm.runInContext('typeof RTCPeerConnection', worker), 'undefined');
});

test('document redirects inside the public scope become a fresh in-page navigation', requiresCompiler, async t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gfn-adapter-test-'));
  t.after(() => fs.rmSync(cacheDir, {recursive:true,force:true}));
  const sources = {
    [WORKER_URL]:'var req = {}; req.p = "";',
    [COMMON_URL]:'globalThis.commonValue = 1;'
  };
  const redirects = {'https://play.geforcenow.com/':'/mall/','https://play.geforcenow.com/games':'https://login.nvidia.com/'};
  const fetchImpl = async (url, options) => {
    if (redirects[url]) {
      assert.equal(options.redirect, 'manual');
      return {ok:false,status:302,headers:{get:name => name === 'location' ? redirects[url] : null},text:async () => ''};
    }
    return {ok:true,status:200,text:async () => sources[url]};
  };
  const adapter = createAdapter({root,cacheDir,fetchImpl});
  const page = await adapter.resource('https://play.geforcenow.com/?code=secret#/layout/games','Document');
  assert.match(page, /location\.replace\("\/mall\/"\+location\.hash\)/);
  assert.doesNotMatch(page, /secret/);
  await assert.rejects(adapter.resource('https://play.geforcenow.com/games','Document'), /Unexpected document redirect/);
});

test('post-game survey frame is in scope with only its static documents and scripts', () => {
  assert.equal(eligible('https://gx-surveys.nvidia.com/?surveyId=abc&token=secret', 'Document'), true);
  assert.equal(eligible('https://gx-surveys.nvidia.com/index.html', 'Document'), true);
  assert.equal(eligible('https://gx-surveys.nvidia.com/static/js/93.37c5056e.js', 'Script'), true);
  for (const [url,type] of [
    ['https://gx-surveys.nvidia.com/api/survey', 'Document'],
    ['https://gx-surveys.nvidia.com/static/js/main.js?x=1', 'Script'],
    ['https://gx-surveys.nvidia.com/other/app.js', 'Script'],
    ['https://gx-surveys.nvidia.com/', 'XHR'],
    ['https://evil.gx-surveys.nvidia.com/', 'Document'],
    ['http://gx-surveys.nvidia.com/', 'Document']
  ]) assert.equal(eligible(url, type), false, url);
});

test('survey documents get the light prelude without the game client parts', requiresCompiler, async t => {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gfn-adapter-test-'));
  t.after(() => fs.rmSync(cacheDir, {recursive:true,force:true}));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url !== 'https://gx-surveys.nvidia.com/') throw new Error('Unexpected fetch ' + url);
    return {ok:true,status:200,text:async () => '<!doctype html><html><head><script>globalThis.v = ({a:1})?.a ?? 2;</script><script defer src="/static/js/main.1.js"></script></head><body></body></html>'};
  };
  const adapter = createAdapter({root,cacheDir,fetchImpl});
  const page = await adapter.resource('https://gx-surveys.nvidia.com/?surveyId=secret', 'Document');
  assert.deepEqual(calls, ['https://gx-surveys.nvidia.com/'], 'no worker download and no query sent');
  assert.match(page, /Chrome 69 compatibility bridge/);
  assert.doesNotMatch(page, /__gfnRtcShim|CompatibleWorker|TizenTVApiInfo/);
  assert.doesNotMatch(page, /\?\.a/);
  assert.doesNotMatch(page, /secret/);
});
