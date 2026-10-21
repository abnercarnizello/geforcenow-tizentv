'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ORIGIN = 'https://play.geforcenow.com';
const WORKER_URL = ORIGIN + '/mall/65.ea7fcba2f7f1caeb.js';
const COMMON_URL = ORIGIN + '/mall/common.1bb8089756535934.js';
const USER_AGENT = 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const safeUrl = value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '<invalid>'; } };

function eligible(value, type) {
  try {
    const url = new URL(value);
    if (url.origin !== ORIGIN || url.username || url.password) return false;
    if (type === 'Document') return ['/', '/mall/', '/mall/index.html', '/games'].includes(url.pathname);
    return type === 'Script' && !url.search && !url.hash && /^\/mall\/.+\.js$/.test(url.pathname);
  } catch { return false; }
}

function createAdapter({root = path.resolve(__dirname, '../..'), fetchImpl = globalThis.fetch, cacheDir = path.join(root, '.tools/compat-cache')} = {}) {
  const esbuild = require(path.join(root, '.tools/compat-deps/node_modules/esbuild'));
  const core = fs.readFileSync(path.join(root, 'tools/compat/polyfills.js'), 'utf8');
  const resize = fs.readFileSync(path.join(root, '.tools/compat-deps/node_modules/@juggle/resize-observer/lib/exports/resize-observer.umd.js'), 'utf8');
  const resizePrelude = resize + '\n(function(){var module=window.ResizeObserver;window.ResizeObserver=module.ResizeObserver;window.ResizeObserverEntry=module.ResizeObserverEntry;}());';
  // Adds getConfiguration() and unified-plan for the Tizen WebRTC engine.
  const rtcShim = fs.readFileSync(path.join(root, 'tools/compat/rtc-shim.js'), 'utf8');
  const basePrelude = core + '\n' + resizePrelude + '\n' + rtcShim + `\n(function(){
    var names=['tizen','TizenTVApiInfo','addEdgeEffectONSCROLLTizenUIF','tizentvwasm'];
    var remaining=[];
    names.forEach(function(name){
      try{delete window[name];if(window[name])Object.defineProperty(window,name,{value:undefined,configurable:true});}catch(ignore){}
      if(window[name])remaining.push(name);
    });
    window.__gfnCompatibility={version:6,nativeMarkersRemaining:remaining,resizeObserverReplaced:true,rtc:window.__gfnRtcShim||null};
  }());`;
  // Invalidate older worker/prelude caches whenever this adapter or its local
  // polyfills change. Vendor sources stay under the ignored .tools directory.
  const fingerprint = digest(fs.readFileSync(__filename)) + ':' + digest(basePrelude) + ':' + esbuild.version;
  const transformed = [];
  const compiled = new Map();
  let preludePromise;
  fs.mkdirSync(cacheDir, {recursive:true});

  async function preparePrelude() {
    if (preludePromise) return preludePromise;
    preludePromise = (async () => {
      // These two hashed URLs were observed in the tested public release. A
      // future release may need a new mapping; unrelated workers pass through.
      // No proprietary worker or common source is checked into the repository.
      let worker = await resource(WORKER_URL, 'Script');
      const common = await resource(COMMON_URL, 'Script');
      worker = worker.replace(/(\b[\w$]+\.p\s*=\s*)""/g, '$1"https://play.geforcenow.com/mall/"');
      const bootstrap = core + `\n(function(){
        var nativeImport=self.importScripts;
        var mapped=${JSON.stringify({[COMMON_URL]:common})};
        self.importScripts=function(){for(var i=0;i<arguments.length;i++){
          var url=String(arguments[i]);
          if(Object.prototype.hasOwnProperty.call(mapped,url)){(0,eval)(mapped[url]);}
          else{nativeImport.call(self,url);}
        }};
      }());\n` + worker;
      return basePrelude + `\n(function(){
        var NativeWorker=window.Worker;
        function CompatibleWorker(url,options){
          if(!(this instanceof CompatibleWorker))throw new TypeError('Worker requires new');
          var absolute=new URL(String(url),document.baseURI).href;
          if(absolute===${JSON.stringify(WORKER_URL)}){
            var blobUrl=URL.createObjectURL(new Blob([${JSON.stringify(bootstrap)}],{type:'application/javascript'}));
            var worker=new NativeWorker(blobUrl,options);
            window.setTimeout(function(){URL.revokeObjectURL(blobUrl);},60000);
            return worker;
          }
          return new NativeWorker(url,options);
        }
        CompatibleWorker.prototype=NativeWorker.prototype;
        Object.setPrototypeOf(CompatibleWorker,NativeWorker);
        window.Worker=CompatibleWorker;
        window.__gfnCompatibility.worker65Adapted=true;
      }());`;
    })();
    try { return await preludePromise; }
    catch (error) { preludePromise = undefined; throw error; }
  }

  async function transformScript(source, url) {
    const result = await esbuild.transform(source, {target:'chrome69',loader:'js',legalComments:'inline',sourcefile:safeUrl(url),minify:false});
    if (/\/runtime\.[a-f0-9]+\.js$/.test(new URL(url).pathname)) {
      // Only webpack's known assignment is adapted. All other shapes stop the
      // adaptation rather than silently executing a partially changed loader.
      let count = 0;
      result.code = result.code.replace(/(\b[\w$]+\.integrity\s*=\s*)[\w$]+\.sriHashes\[[^\]]+\]/g, (match, left) => { count++; return left + '""'; });
      if (count !== 1) throw new Error('Unexpected webpack integrity loader shape; adaptation stopped');
    }
    return result.code;
  }

  function attribute(attributes, name) {
    const match = attributes.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    return match ? (match[1] ?? match[2] ?? match[3]) : null;
  }

  async function transformHtml(source, url) {
    if (!eligible(url, 'Document')) throw new Error('Resource outside public compatibility scope');
    if (!/<head\b[^>]*>/i.test(source)) throw new Error('Expected public document head absent');
    const prelude = await preparePrelude();
    const matches = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
    let result = '', offset = 0;
    for (const match of matches) {
      result += source.slice(offset, match.index);
      let attributes = match[1], body = match[2];
      const src = attribute(attributes, 'src');
      const type = (attribute(attributes, 'type') || '').trim().toLowerCase();
      if (src !== null) {
        // Preserve integrity for scripts outside the public rewritten scope.
        if (eligible(new URL(src, url).href, 'Script')) attributes = attributes.replace(/\s+integrity\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
      } else if (body.trim() && !/^(?:application\/(?:ld\+)?json|importmap)(?:\s*;|$)/i.test(type)) {
        body = await transformScript(body, safeUrl(url) + '#inline');
      }
      result += '<script' + attributes + '>' + body + '</script>';
      offset = match.index + match[0].length;
    }
    result += source.slice(offset);
    return result.replace(/<head\b[^>]*>/i, head => head + '<script>' + prelude.replace(/<\/script/gi, '<\\/script') + '</script>');
  }

  async function resource(value, type) {
    if (!eligible(value, type)) throw new Error('Resource outside public compatibility scope');
    const url = new URL(value);
    // Navigation query strings can contain authentication context. Preserve the
    // browser URL, but never send or retain those parameters in the PC fetch.
    if (type === 'Document') { url.search = ''; url.hash = ''; }
    const canonical = url.href;
    const prelude = type === 'Document' ? await preparePrelude() : '';
    const key = digest(canonical + '\n' + type + '\n' + fingerprint + '\n' + digest(prelude));
    if (compiled.has(key)) return compiled.get(key);
    const task = (async () => {
      const output = path.join(cacheDir, key + (type === 'Document' ? '.html' : '.js'));
      if (fs.existsSync(output)) {
        const cached = fs.readFileSync(output, 'utf8');
        transformed.push({url:safeUrl(canonical),type,cached:true,outputSha256:digest(cached),outputBytes:Buffer.byteLength(cached)});
        return cached;
      }
      const response = await fetchImpl(canonical, {signal:AbortSignal.timeout(20000),headers:{'User-Agent':USER_AGENT},redirect:type === 'Document' ? 'manual' : 'error',credentials:'omit'});
      if (type === 'Document' && response.status >= 300 && response.status < 400) {
        // "/" and "/games" answer 302 -> /mall/. A redirect the TV follows on
        // its own would load the unadapted page, so send a tiny page that
        // starts a fresh navigation, which is intercepted and adapted again.
        const location = response.headers && response.headers.get && response.headers.get('location');
        const target = location ? new URL(location, canonical) : null;
        if (!target || !eligible(target.href, 'Document') || target.href === canonical) throw new Error('Unexpected document redirect');
        const path = JSON.stringify(target.pathname);
        const page = '<!DOCTYPE html><html><head><meta charset="utf-8"><script>location.replace(' + path + '+location.hash);</script></head><body></body></html>';
        transformed.push({url:safeUrl(canonical),type,redirectTo:target.pathname});
        return page;
      }
      if (!response.ok) throw new Error('Static download HTTP ' + response.status);
      const source = await response.text();
      if (Buffer.byteLength(source) > 40 * 1024 * 1024) throw new Error('Static file exceeds 40 MiB');
      const result = type === 'Document' ? await transformHtml(source, canonical) : await transformScript(source, canonical);
      fs.writeFileSync(output, result);
      transformed.push({url:safeUrl(canonical),type,sourceSha256:digest(source),outputSha256:digest(result),sourceBytes:Buffer.byteLength(source),outputBytes:Buffer.byteLength(result)});
      return result;
    })();
    compiled.set(key, task);
    try { return await task; }
    catch (error) { compiled.delete(key); throw error; }
  }

  return {resource,eligible,transformScript,transformHtml,preparePrelude,transformed,resizePrelude};
}

module.exports = {createAdapter,eligible,WORKER_URL,COMMON_URL};
