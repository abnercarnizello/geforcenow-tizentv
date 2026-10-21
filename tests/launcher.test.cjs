'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/main.js'), 'utf8');

function launcher(setUserAgentString, savedAgent) {
  const nodes = {};
  const timers = new Map();
  const events = {};
  const navigations = [];
  let timerId = 0;
  const document = {
    hidden: false,
    getElementById(id) {
      if (!nodes[id]) nodes[id] = {textContent:'',checked:true,disabled:false,hidden:true,addEventListener(name,fn){this[name]=fn;},setAttribute(){},focus(){document.activeElement=this;}};
      return nodes[id];
    },
    addEventListener(name,fn){events['document:'+name]=fn;},
    querySelectorAll(){return ['desktop-mode','launch','diagnose','toggle-report','exit'].map(id=>nodes[id]).filter(x=>!x.disabled);}
  };
  const window = {
    document,
    navigator:{userAgent:'Native Tizen 5.5 Chrome/69.0.3497.106'},
    localStorage:{getItem(){return savedAgent;},setItem(){}},
    location:{protocol:'file:',search:'',assign(url){navigations.push(url);}},
    GfnDiagnostics:{inspect(){return {gamepads:{devices:[]},engine:{name:'Chromium',version:'69'}};}},
    addEventListener(name,fn){events[name]=fn;},
    setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},
    clearTimeout(id){timers.delete(id);},
    setInterval(){},
    tizen:setUserAgentString ? {websetting:{setUserAgentString}} : undefined
  };
  // No Promise means startup uses its synchronous unsupported-probe branch.
  const context = {window,document,navigator:window.navigator};
  ['desktop-mode','launch','diagnose','toggle-report','exit','report','engine','status','gamepad'].forEach(id=>document.getElementById(id));
  vm.runInNewContext(source,context);
  events.load();
  return {nodes,navigations,timers,window,events};
}

test('launcher navigates only after user agent callback succeeds and ignores duplicate callbacks', () => {
  let ok, fail, agent;
  const app=launcher((ua,s,e)=>{agent=ua;ok=s;fail=e;});
  app.nodes.launch.click();
  assert.equal(app.nodes.launch.disabled,true);
  assert.equal(app.navigations.length,0);
  assert.match(agent,/CrOS/);
  ok(); fail(new Error('late failure')); ok();
  assert.deepEqual(app.navigations,['https://play.geforcenow.com/']);
  assert.equal(app.timers.size,0);
});

test('launcher displays synchronous and callback errors and permits retry without navigation', () => {
  for (const mode of ['throw','callback']) {
    const app=launcher((ua,s,e)=>{if(mode==='throw')throw new Error('rejected'); e({message:'rejected'});});
    app.nodes.launch.click();
    assert.match(app.nodes.status.textContent,/rejected/);
    assert.equal(app.nodes.launch.disabled,false);
    assert.equal(app.navigations.length,0);
    assert.equal(app.timers.size,0);
  }
});

test('unresponsive user agent API times out and a late callback cannot navigate', () => {
  let success;
  const app=launcher((ua,s)=>{success=s;});
  app.nodes.launch.click();
  const fn=[...app.timers.values()][0];
  fn();success();
  assert.match(app.nodes.status.textContent,/5 segundos/);
  assert.equal(app.nodes.launch.disabled,false);
  assert.equal(app.navigations.length,0);
});

test('native browser mode uses the captured original user agent on subsequent launches', () => {
  let agent;
  const app=launcher((ua,s)=>{agent=ua;s();},'Saved native Tizen 5.5 Chrome/69');
  app.nodes['desktop-mode'].checked=false;
  app.nodes.launch.click();
  assert.equal(agent,'Saved native Tizen 5.5 Chrome/69');
  assert.equal(app.navigations.length,1);
});

test('desktop preview cannot navigate as if it were the installed Tizen app', () => {
  const app=launcher();
  app.nodes.launch.click();
  assert.match(app.nodes.status.textContent,/Prévia no PC/);
  assert.equal(app.navigations.length,0);
});

test('confirmed unsupported page syntax stops launch before changing UA or navigating', () => {
  let changes=0;
  const app=launcher(()=>{changes++;});
  app.window.GfnDiagnostics.inspect=()=>({gamepads:{devices:[]},engine:{name:'Chromium',version:'69'},javascript:{optionalChaining:{status:'unsupported'}}});
  app.nodes.diagnose.click();
  assert.match(app.nodes.status.textContent,/incompatível/);
  app.nodes.launch.click();
  assert.match(app.nodes.status.textContent,/Abertura interrompida/);
  assert.equal(changes,0);
  assert.equal(app.navigations.length,0);
});

test('remote OK toggles browser mode and Back exits only the local launcher', () => {
  const app=launcher(()=>{});
  let exits=0;
  app.window.tizen.application={getCurrentApplication(){return {exit(){exits++;}};}};
  app.nodes['desktop-mode'].focus();
  app.events['document:keydown']({keyCode:13,preventDefault(){}});
  assert.equal(app.nodes['desktop-mode'].checked,false);
  app.events['document:keydown']({keyCode:10009,preventDefault(){}});
  assert.equal(exits,1);
});
