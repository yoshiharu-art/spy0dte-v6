const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process');
const html=fs.readFileSync('index.html','utf8');
function load(html){
 let script=html.match(/<script>([\s\S]*?)<\/script>/)[1];script=script.slice(0,script.lastIndexOf('render();renderLogs();'));
 const els=new Map(),opens=[];let clock=Date.parse('2026-09-24T17:00:00Z');
 class Clock extends Date{static now(){return clock}}
 const ctx=vm.createContext({structuredClone,Intl,URL,Date:Clock,Number,Math,JSON,AbortSignal,performance:{now:()=>clock},
 setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},navigator:{clipboard:{writeText:async()=>{}}},
 window:{open:(...a)=>opens.push(a)},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
 document:{getElementById(id){if(!els.has(id))els.set(id,{textContent:'',innerHTML:'',disabled:false,classList:{add(){},remove(){},toggle(){}}});return els.get(id)}}});
 vm.runInContext(script,ctx);return {ctx,opens,els,tick:n=>{clock+=n},run:s=>vm.runInContext(s,ctx)};
}
const x=load(html),old=load(cp.execFileSync('git',['show','d7e26db8d861073e838ea87847c49baf260de0a6:index.html'],{encoding:'utf8'}));
// Preserve all direction and position functions verbatim. The existing evaluator is retained as evaluateBase.
for(const n of ['directionChecks','deltaRange','sideScore','positionCore','profitFloor','updatePositionFromState','exitPosition','confirmPaperExit','manualPaperExit'])assert.equal(x.ctx[n].toString(),old.ctx[n].toString(),n);
assert.equal(x.ctx.evaluateBase.toString().replace('function evaluateBase','function evaluate').replace("||news.availability==='OFF'",''),old.ctx.evaluate.toString());
assert.equal(x.run('state.spy'),undefined,'startup must not show a demo price');
assert.equal(x.run('evaluate(state).decision'),'DATA ERROR');
x.run("runtimeConfig={newsMode:'OFF',autoTrade:false};");
assert.equal(x.run('getNewsRisk(state).level'),'UNKNOWN');
assert.equal(x.run('getNewsRisk(state).title'),'突発ニュース未確認');
x.run("state={...structuredClone(scenarios.buy),_mock:true};");
assert.equal(x.run('evaluate(state).decision'),'PUT BUY');
assert.equal(x.run('openWebull()'),false,'simulation cannot open a purchase link');
x.run(`state={...scenarios.buy,ok:true,dataMode:'LIVE',provider:'Webull OpenAPI',environment:'prod',newsMode:'OFF',
 serverTime:new Date(Date.now()).toISOString(),fetchedAt:new Date(Date.now()).toISOString(),
 spyPriceAt:new Date(Date.now()-100).toISOString(),spyQuoteAt:new Date(Date.now()-100).toISOString(),optionQuoteAt:new Date(Date.now()-100).toISOString(),
 _receivedAt:Date.now(),_receivedMono:performance.now(),_roundTripMs:100,optionSymbol:'SPY260924P00667000',expiration:'2026-09-24',
 signal:{decision:'PUT BUY',side:'PUT',score:100,reasons:['unit fixture'],decisionAt:new Date(Date.now()).toISOString(),validUntil:new Date(Date.now()+1900).toISOString()}};`);
assert.equal(x.run('evaluate(state).decision'),'PUT BUY');
x.run('render(false)');assert.equal(x.els.get('webullBtn').disabled,false);
assert.equal(x.run('openWebull()'),true);assert.equal(x.opens.length,1);
assert.equal(x.opens[0][0],'https://www.webull.co.jp/ticker/nysearca-spy');
assert.match(x.run('contractText()'),/2026-09-24/);assert.match(x.run('contractText()'),/PUT/);
x.tick(2000);
assert.equal(x.run('evaluate(state).decision'),'NO TRADE');
assert.equal(x.run('openWebull()'),false);assert.equal(x.opens.length,1);
x.run('render(false)');assert.equal(x.els.get('webullBtn').disabled,true);
// Expiration follows monotonic elapsed time even if the wall clock is changed.
x.run('state._receivedAt=Date.now()+100000');assert.equal(x.run('evaluate(state).decision'),'NO TRADE');
x.run("runtimeConfig={newsMode:'ON'};window.newsSnapshot=null;");assert.equal(x.run('getNewsRisk(state).lock'),true);
x.run(`position={active:true,entryTs:Date.now(),entryAsk:1,currentBid:1,peakBid:1,lowBid:1,side:'PUT',strike:667,expiration:'TODAY',thesisBreakCount:0};`);
const before=x.run('JSON.stringify(position)');x.run('render(false);render(false)');assert.equal(x.run('JSON.stringify(position)'),before);
assert(!html.slice(0,html.indexOf('<script>')).includes('>PUT BUY<'));
console.log('PASS: preserved V6.4 core/position functions; live/off/on, no dummy startup, stale expiry, Webull contract/link, mock isolation.');
