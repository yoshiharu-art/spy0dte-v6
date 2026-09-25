'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const path=require('node:path');
const cp=require('node:child_process');
const originalHtml=cp.execFileSync('git',['show','570248db828f1e80203c912f2a27ca90e288e3ce:index.html'],{encoding:'utf8'});
const original=originalHtml.slice(originalHtml.indexOf('async function fetchLive('),originalHtml.indexOf('async function tryLive('));
const currentHtml=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
const patched=currentHtml.slice(currentHtml.indexOf('// DATA-QUALITY RETRY V2:'),currentHtml.indexOf('async function tryLive('));
function response(data={},status=200,headers={}){
 const map=Object.fromEntries(Object.entries(headers).map(([k,v])=>[k.toLowerCase(),String(v)]));
 return {ok:status>=200&&status<300,status,headers:{get:k=>map[k.toLowerCase()]??null},json:async()=>data};
}
const live=(open=true)=>({ok:true,marketSession:{open},newsMode:'OFF',autoTrade:false,signal:{decision:'CALL BUY',validUntil:'2026-09-25T16:26:29.899000+00:00'},processingMs:0});
function harness(source=patched){
 let now=Date.parse('2026-09-25T16:30:00Z');
 const calls=[],timers=[],elements=new Map();
 class ClockDate extends Date{static now(){return now;}}
 const box={Date:ClockDate,performance:{now:()=>now},URL,
  AbortSignal:{timeout:()=>({})},
  document:{getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}},
  render:()=>{},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
  fetch:async(...args)=>{calls.push(args);return box.next();},
  next:async()=>response(live())};
 vm.createContext(box);
 vm.runInContext("let liveGeneration=1,liveInFlight=false,liveTimer=null,state={},runtimeConfig=null,position=null;const API_URL='https://example.invalid/';\n"+source,box);
 return {box,calls,timers,run:s=>vm.runInContext(s,box),advance:ms=>now+=ms};
}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+count+' '+name);}
(async()=>{
 await test('Reproduce original: network failure schedules 30 seconds',async()=>{const h=harness(original);h.box.next=async()=>{throw Error('network');};await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,30000);});
 await test('New: first network failure retries after 2 seconds',async()=>{const h=harness();h.box.next=async()=>{throw Error('network');};await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,2000);});
 await test('Repeated failures use capped 2/4/8/16/30/30 second backoff',async()=>{const h=harness();h.box.next=async()=>{throw Error('network');};for(let i=0;i<6;i++)await h.run('pollLive(1)');assert.deepEqual(h.timers.map(t=>t.ms),[2000,4000,8000,16000,30000,30000]);});
 await test('Successful open session keeps original 1-second post-response wait',async()=>{const h=harness();await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,1000);});
 await test('Successful CLOSED response keeps original 30-second wait',async()=>{const h=harness();h.box.next=async()=>response(live(false));await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,30000);});
 await test('Unknown session is not misclassified as closed',async()=>{const h=harness();h.box.next=async()=>response({ok:true});await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,2000);});
 await test('Recovery clears accumulated failure backoff',async()=>{const h=harness();h.box.next=async()=>{throw Error('network');};await h.run('pollLive(1)');await h.run('pollLive(1)');h.box.next=async()=>response(live());await h.run('pollLive(1)');assert.equal(h.run('liveRetryV2.failures'),0);h.box.next=async()=>{throw Error('again');};await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,2000);});
 await test('Timeout still invalidates data and releases request lock',async()=>{const h=harness();h.run('state={ok:true,signal:{decision:"CALL BUY"}}');h.box.next=async()=>{const e=Error('timeout');e.name='TimeoutError';throw e;};await h.run('pollLive(1)');assert.equal(h.run('Object.keys(state).length'),0);assert.equal(h.run('liveInFlight'),false);assert.equal(h.timers.at(-1).ms,2000);});
 await test('HTTP 500 response is a failed fetch, not a market-close response',async()=>{const h=harness();h.box.next=async()=>response({ok:false,error:'unavailable'},500);await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,2000);});
 await test('Invalid JSON response follows short first retry',async()=>{const h=harness();h.box.next=async()=>({...response(),json:async()=>{throw Error('bad JSON');}});await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,2000);});
 await test('Retry-After seconds on HTTP 429 is honored',async()=>{const h=harness();h.box.next=async()=>response({ok:false},429,{'Retry-After':'60'});await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,60000);});
 await test('Retry-After HTTP date uses response Date against clock skew',async()=>{const h=harness();h.box.next=async()=>response({ok:false},503,{'Date':'Fri, 25 Sep 2026 15:00:00 GMT','Retry-After':'Fri, 25 Sep 2026 15:01:30 GMT'});await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,90000);});
 await test('Malformed Retry-After falls back to bounded backoff',async()=>{const h=harness();h.box.next=async()=>response({ok:false},429,{'Retry-After':'invalid'});await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,2000);});
 await test('Repeated manual fetch attempts cannot bypass Retry-After',async()=>{const h=harness();h.box.next=async()=>response({ok:false},429,{'Retry-After':'60'});await h.run('pollLive(1)');await h.run('fetchLive(1)');assert.equal(h.calls.length,1);h.advance(60000);h.box.next=async()=>response(live());assert.equal(await h.run('fetchLive(1)'),true);assert.equal(h.calls.length,2);});
 await test('HTML error body still respects Retry-After',async()=>{const h=harness();h.box.next=async()=>({...response({},429,{'Retry-After':'45'}),json:async()=>{throw Error('html body');}});await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,45000);});
 await test('Only one overlapping fetch is allowed',async()=>{const h=harness();h.run('liveInFlight=true');assert.equal(await h.run('fetchLive(1)'),false);assert.equal(h.calls.length,0);});
 await test('Stale generation cannot create a new polling timer',async()=>{const h=harness();await h.run('pollLive(0)');assert.equal(h.calls.length,0);assert.equal(h.timers.length,0);});
 await test('Old in-flight response cannot overwrite current state',async()=>{const h=harness();h.box.next=async()=>{h.run('liveGeneration=2;state={marker:"newer"}');return response(live());};await h.run('pollLive(1)');assert.equal(h.run('state.marker'),'newer');assert.equal(h.timers.length,0);});
 await test('Success preserves broker decision validity rather than extending it',async()=>{const h=harness();await h.run('pollLive(1)');assert.equal(h.run('state.signal.validUntil'),live().signal.validUntil);});
 await test('Server processing subtraction from transport time is preserved',async()=>{const h=harness();h.box.next=async()=>{h.advance(4500);return response({...live(),processingMs:4000});};await h.run('pollLive(1)');assert.equal(h.run('state._roundTripMs'),500);});
 await test('Fixed held option contract stays in request',async()=>{const h=harness();h.run('position={active:true,optionSymbol:"SPY260925C00772000"}');await h.run('pollLive(1)');assert.equal(new URL(h.calls[0][0]).searchParams.get('position_symbol'),'SPY260925C00772000');});
 await test('Backend provider 429 uses 60-second backoff even with HTTP 500',async()=>{const h=harness();h.box.next=async()=>response({ok:false,error:'WEBULL_HTTP_429'},500);await h.run('pollLive(1)');assert.equal(h.timers.at(-1).ms,60000);await h.run('fetchLive(1)');assert.equal(h.calls.length,1);});
 console.log('\n'+count+' tests passed. Isolated VM tests; NOT a browser, full-app, backend, or production test.');
})().catch(e=>{console.error(e);process.exitCode=1;});
