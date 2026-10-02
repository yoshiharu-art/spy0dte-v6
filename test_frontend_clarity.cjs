'use strict';
// Offline view checks. No network, broker, credential, or strategy mutation.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
function elements(){
 const nodes=new Map();
 const make=()=>({textContent:'',innerHTML:'',value:'',disabled:false,children:[],options:[],
  classList:{add(){},remove(){},toggle(){}},addEventListener(){},
  replaceChildren(){this.children=[];this.options=[];this.textContent='';},
  append(...rows){this.children.push(...rows);this.options.push(...rows);}});
 return {nodes,document:{getElementById(id){if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);},createElement:make}};
}
function liveView(){
 const dom=elements();let now=Date.parse('2026-09-24T17:00:00Z');
 class Clock extends Date{static now(){return now;}}
 const context=vm.createContext({structuredClone,Intl,URL,Date:Clock,Number,Math,JSON,AbortSignal,
  performance:{now:()=>now},setInterval(){},setTimeout(){},clearTimeout(){},
  navigator:{},window:{},localStorage:{getItem:()=>null},document:dom.document});
 let script=fs.readFileSync('index.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
 script=script.slice(0,script.lastIndexOf('render();renderLogs();'));
 vm.runInContext(script,context);
 const run=source=>vm.runInContext(source,context);
 run(`runtimeConfig={newsMode:'OFF'};state={...scenarios.buy,ok:true,connection:'CONNECTED',dataMode:'LIVE',
  provider:'Webull OpenAPI',environment:'prod',newsMode:'OFF',realtimeVerified:true,marketHalted:false,
  instrumentId:'OFFLINE',contractMultiplier:100,multiplierSource:'OFFLINE',askSize:10,barsValid:true,
  marketSession:{open:true,calendarReady:true},serverTime:new Date(Date.now()).toISOString(),
  spyPriceAt:new Date(Date.now()-100).toISOString(),spyQuoteAt:new Date(Date.now()-100).toISOString(),
  optionQuoteAt:new Date(Date.now()-100).toISOString(),barAt:new Date(Date.now()-60000).toISOString(),
  volPriceAt:new Date(Date.now()-20000).toISOString(),_receivedAt:Date.now(),_receivedMono:performance.now(),
  optionSymbol:'SPY260924P00667000',expiration:'2026-09-24',signal:{decision:'PUT BUY',side:'PUT',score:100,
  decisionAt:new Date(Date.now()).toISOString(),validUntil:new Date(Date.now()+1900).toISOString()}};render(false);`);
 return {...dom,run,advance:ms=>now+=ms};
}
function paperView(reply=()=>({status:401,ok:false,json:async()=>{throw Error('A 401 does not contain an authenticated snapshot');}})){
 const dom=elements(),calls=[],timers=[];let resolveHealth;
 const context=vm.createContext({Intl,URL,Date,Number,JSON,AbortSignal,crypto,
  setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},
  window:{addEventListener(){}},document:dom.document,
  fetch:async(url,options)=>{calls.push({url,options});if(url.endsWith('health'))return new Promise(resolve=>{resolveHealth=resolve;});
   return reply(url,options);}});
 vm.runInContext(fs.readFileSync('paper.js','utf8'),context);
 return {...dom,calls,timers,run:source=>vm.runInContext(source,context),
  health:()=>resolveHealth({ok:true,json:async()=>({adminConfigured:true,paperAutoEnabled:true,accounts:{private:'must not render'}})})};
}
(async()=>{
 const live=liveView(),status=live.document.getElementById('liveStatus');
 assert.match(status.textContent,/Webull応答取得済み.*鮮度条件内.*PUT BUY/);
 assert.equal(status.className,'small good');
 live.advance(2100);live.run('render(false)');
 assert.match(status.textContent,/Webull応答取得済み.*購入用データの更新待ち.*オプション気配/);
 assert.equal(status.className,'small warn');assert.equal(live.run('evaluate(state).decision'),'NO TRADE');
 live.run("state.optionQuoteAt=null;render(false)");assert.match(status.textContent,/オプション気配：時刻未取得/);
 live.run("state.marketSession.open=false;state.timeBand='CLOSED';render(false)");
 assert.match(status.textContent,/市場時間外・購入判定休止/);assert.equal(status.className,'small warn');
 const paper=paperView();
 paper.run("paperToken='OFFLINE_ONLY';paperConnected=true;paperSnapshot={saved:true};paperDiagnostics={saved:true};");
 for(const id of ['cash','stats','history','contract','indicatorAnalysis'])paper.document.getElementById(id).textContent='OLD ACCOUNT CONTENT';
 await paper.run('poll()');
 assert.equal(paper.run('paperSnapshot'),null);assert.equal(paper.run('paperDiagnostics'),null);
 assert.equal(paper.run('paperToken'),'');assert.equal(paper.run('paperConnected'),false);
 assert.match(paper.document.getElementById('runtime').textContent,/認証.*未確認/);
 assert.equal(paper.document.getElementById('cash').textContent,'--');
 assert.match(paper.document.getElementById('stats').textContent,/取引件数・損益は未確認/);
 assert.match(paper.document.getElementById('history').textContent,/未確認/);
 assert.equal(paper.document.getElementById('start').disabled,true);assert.equal(paper.timers.length,0);
 const authRuntime=paper.document.getElementById('runtime').textContent;paper.health();await new Promise(setImmediate);
 assert.equal(paper.document.getElementById('runtime').textContent,authRuntime,'late public health cannot replace the 401 state');
 assert.equal(paper.calls.length,2);assert(paper.calls[1].url.endsWith('status'));
 assert.equal(paper.calls[1].options.headers.Authorization,'Bearer OFFLINE_ONLY');
 assert.match(paper.run("reasonText('OPTION_QUOTE_STALE')"),/オプション気配.*判定時点.*鮮度上限/);
 const publicOnly=paperView();publicOnly.health();await new Promise(setImmediate);
 assert.match(publicOnly.document.getElementById('runtime').textContent,/公開ヘルス.*PAPER状態は未確認/);
 assert.equal(publicOnly.run('paperSnapshot'),null);assert.equal(publicOnly.document.getElementById('comparison').children.length,0);
 const saved=JSON.parse(fs.readFileSync('testdata/paper-synthetic-state.json','utf8'));let resolveOld;
 const reconnect=paperView((url,options)=>options.headers.Authorization==='Bearer OLD_OFFLINE'
  ?new Promise(resolve=>{resolveOld=resolve;})
  :{status:200,ok:true,json:async()=>saved});
 reconnect.run("paperToken='OLD_OFFLINE';paperConnected=true;");
 const oldPoll=reconnect.run('poll()');
 reconnect.run("paperToken='NEW_OFFLINE';paperConnected=true;el('account').value='V64_BASELINE_1:STANDARD';");
 await reconnect.run('refresh()');
 const before=reconnect.run('JSON.stringify(paperSnapshot)'),currentRuntime=reconnect.document.getElementById('runtime').textContent,
  currentCash=reconnect.document.getElementById('cash').textContent;
 resolveOld({status:401,ok:false,json:async()=>{throw Error('stale 401 must not be parsed');}});await oldPoll;
 assert.equal(reconnect.run('paperToken'),'NEW_OFFLINE');assert.equal(reconnect.run('paperConnected'),true);
 assert.equal(reconnect.run('paperAuthRequired'),false);assert.equal(reconnect.run('JSON.stringify(paperSnapshot)'),before);
 assert.equal(reconnect.document.getElementById('cash').textContent,currentCash);
 assert.equal(reconnect.document.getElementById('runtime').textContent,currentRuntime);
 assert.equal(reconnect.document.getElementById('start').disabled,true,'status without durable organization cannot resume old accounts');
 assert.equal(reconnect.timers.length,0,'an old poll must not add a timer to the new connection');
 console.log('PASS: response versus current freshness/readiness, expiry and closure; 401 unknown-state clearing, disabled controls, no public account inference or polling, stale-token 401 cannot erase a reconnected account.');
})().catch(error=>{console.error(error);process.exitCode=1;});
