'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {createAdapter} = require('./adapter.cjs');
const root = path.resolve(__dirname, '../..');
const recordFile = path.join(root, 'analysis/tv-compat-session.json');
const adapter = createAdapter({root});
const endpoint = process.env.GFN_CDP_ENDPOINT || 'http://127.0.0.1:19222';
const duration = Number(process.env.GFN_OBSERVE_MS || 25000);
const keepPage = process.env.GFN_KEEP_PAGE === '1';
const captureText = process.env.GFN_CAPTURE_TEXT === '1';
const verbose = process.env.GFN_VERBOSE === '1';
const safeUrl = value => {try {const u=new URL(value);return u.origin+u.pathname;} catch{return '<invalid>';}};
const records={startedAt:new Date().toISOString(),scope:'Only public NVIDIA static HTML/JavaScript; auth and API traffic are not intercepted',transformed:adapter.transformed,exceptions:[],failures:[],httpErrors:[],xhrResponses:[],consoleErrors:[],serverInfo:[]};
let finishWaiting;
const stopSignal = new Promise(resolve => { finishWaiting = resolve; });
process.once('SIGINT', () => finishWaiting());
process.once('SIGTERM', () => finishWaiting());

(async()=>{
  const targets=await(await fetch(endpoint+'/json/list')).json();
  const target=targets.find(t=>t.type==='page'&&(t.url==='file:///index.html'||t.url.startsWith('https://play.geforcenow.com/')));
  if(!target)throw new Error('Expected app target absent');
  const ws=new WebSocket(target.webSocketDebuggerUrl);
  let id=0;
  const pending=new Map(),urls=new Map();
  let shuttingDown=false;
  let capturing=false;
  const active=new Set();
  ws.addEventListener('close',()=>{
    finishWaiting();
    for(const respond of pending.values())respond({error:{message:'Conexao com a TV encerrada.'}});
    pending.clear();
    if(!shuttingDown)console.log('Conexao com a TV encerrada. Abra o app e inicie o teste novamente quando desejar.');
  });
  await new Promise((resolve,reject)=>{
    ws.addEventListener('open',resolve,{once:true});
    ws.addEventListener('error',reject,{once:true});
    ws.addEventListener('close',()=>reject(new Error('Conexao com a TV encerrada.')),{once:true});
  });
  function call(method,params={}){
    if(ws.readyState!==WebSocket.OPEN)return Promise.reject(new Error('Conexao com a TV encerrada.'));
    return new Promise((resolve,reject)=>{
      const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout '+method));},30000);
      pending.set(n,r=>{clearTimeout(timer);r.error?reject(new Error(method+': '+r.error.message)):resolve(r.result);});
      try{ws.send(JSON.stringify({id:n,method,params}));}
      catch(error){clearTimeout(timer);pending.delete(n);reject(error);}
    });
  }
  async function intercept(p){
    const u=new URL(p.request.url);
    if(!adapter.eligible(p.request.url,p.resourceType)){await call('Network.continueInterceptedRequest',{interceptionId:p.interceptionId});return;}
    try{
      const body=await adapter.resource(p.request.url,p.resourceType);
      const bytes=Buffer.from(body);
      const headers='HTTP/1.1 200 OK\r\nContent-Type: '+(p.resourceType==='Document'?'text/html':'application/javascript')+'; charset=utf-8\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: https://play.geforcenow.com\r\nAccess-Control-Allow-Credentials: true\r\nContent-Length: '+bytes.length+'\r\n\r\n';
      await call('Network.continueInterceptedRequest',{interceptionId:p.interceptionId,rawResponse:Buffer.concat([Buffer.from(headers),bytes]).toString('base64')});
      if(verbose)console.log('Adapted '+p.resourceType+' '+u.pathname);
    }catch(e){
      records.failures.push({url:safeUrl(p.request.url),error:e.message});
      await call('Network.continueInterceptedRequest',{interceptionId:p.interceptionId});
    }
  }
  ws.addEventListener('message',event=>{
    const data=JSON.parse(event.data);
    if(data.id){const fn=pending.get(data.id);if(fn){pending.delete(data.id);fn(data);}return;}
    const p=data.params||{};
    if(data.method==='Network.requestIntercepted'){
      const task=intercept(p).catch(e=>console.error(e.message)).finally(()=>active.delete(task));active.add(task);
    }
    if(data.method==='Runtime.exceptionThrown' && capturing){
      const ex=p.exceptionDetails;records.exceptions.push({text:ex.exception&&ex.exception.description||ex.text,url:ex.url&&safeUrl(ex.url),line:ex.lineNumber,column:ex.columnNumber});
      if(verbose)console.log('Page error: '+(ex.exception&&ex.exception.description||ex.text).slice(0,350));
    }
    if(data.method==='Network.requestWillBeSent')urls.set(p.requestId,safeUrl(p.request.url));
    // Do not retain page console payloads during authenticated operation.
    if(data.method==='Network.loadingFailed')records.failures.push({url:urls.get(p.requestId),error:p.errorText,type:p.type});
    if(data.method==='Network.responseReceived'&&p.response.status>=400)records.httpErrors.push({url:urls.get(p.requestId),status:p.response.status});
    if(data.method==='Network.responseReceived'&&['XHR','Fetch'].includes(p.type))records.xhrResponses.push({url:urls.get(p.requestId),status:p.response.status,mime:p.response.mimeType});
    if(data.method==='Network.loadingFinished' && /\/v2\/serverInfo$/.test(urls.get(p.requestId)||'')) {
      const task=call('Network.getResponseBody',{requestId:p.requestId}).then(r=>{
        const body=r.base64Encoded?Buffer.from(r.body,'base64').toString():r.body;
        if(!body)return;
        try{const info=JSON.parse(body);records.serverInfo.push({url:urls.get(p.requestId),status:info.requestStatus&&info.requestStatus.statusDescription,protocol:info.version&&info.version.protocolMajorVersion});}catch{}
      }).catch(e=>records.serverInfo.push({error:e.message})).finally(()=>active.delete(task)); active.add(task);
    }
  });
  try{
    records.browser=await call('Browser.getVersion');
    await call('Page.enable');await call('Runtime.enable');await call('Network.enable');
    if(!keepPage)await call('Network.setUserAgentOverride',{userAgent:'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36',platform:'Linux x86_64'});
    await call('Network.setCacheDisabled',{cacheDisabled:true});
    await call('Network.setBypassServiceWorker',{bypass:true});
    await call('Network.setRequestInterception',{patterns:[{urlPattern:'https://play.geforcenow.com/*',resourceType:'Document',interceptionStage:'Request'},{urlPattern:'https://play.geforcenow.com/*',resourceType:'Script',interceptionStage:'Request'}]});
    capturing=true;
    console.log('Compatibilidade ativa. Mantenha este PC ligado. Para encerrar, pressione Ctrl+C.');
    if(keepPage){
      await call('Runtime.evaluate',{expression:adapter.resizePrelude,returnByValue:true});
      console.log('Compatibility active on existing page; login preserved.');
    }else await call('Page.navigate',{url:'https://play.geforcenow.com/mall/'});
    const timer=duration>0?setTimeout(finishWaiting,duration):null;
    const reportTimer=setInterval(()=>{
      fs.writeFileSync(recordFile,JSON.stringify(records,null,2));
    },5000);
    try{await stopSignal;}finally{if(timer)clearTimeout(timer);clearInterval(reportTimer);}
    if(ws.readyState===WebSocket.OPEN)await Promise.allSettled([...active]);
    if(ws.readyState===WebSocket.OPEN){
      const result=await call('Runtime.evaluate',{expression:`(function(){var text=document.body.innerText;var info={url:location.origin+location.pathname,title:document.title,hasLibrary:text.indexOf('Minha biblioteca')>=0,hasLoginPending:text.indexOf('CANCELAR LOGIN')>=0,hasQueue:/fila|jogadores à sua frente|aguardando|preparando/i.test(text),videos:Array.prototype.map.call(document.querySelectorAll('video'),function(v){return {width:v.videoWidth,height:v.videoHeight,time:v.currentTime,decodedFrames:v.webkitDecodedFrameCount};}),compatibility:window.__gfnCompatibility};${captureText?'info.body=text.slice(0,7000);':''}return JSON.stringify(info);}())`,returnByValue:true});
      records.final=result.result&&result.result.value?JSON.parse(result.result.value):result;
    }else records.final={connectionEnded:true};
    fs.writeFileSync(recordFile,JSON.stringify(records,null,2));
    console.log('Sessao de compatibilidade encerrada.');
    if(verbose)console.log(JSON.stringify({transformed:records.transformed.length,exceptions:records.exceptions,failures:records.failures,httpErrors:records.httpErrors,final:records.final},null,2));
  }finally{
    shuttingDown=true;
    await call('Network.setRequestInterception',{patterns:[]}).catch(()=>{});
    await call('Network.setCacheDisabled',{cacheDisabled:false}).catch(()=>{});
    await call('Network.setBypassServiceWorker',{bypass:false}).catch(()=>{});
    ws.close();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
