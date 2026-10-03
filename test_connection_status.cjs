'use strict';
// Exercise the real HTML scripts with synthetic responses only. No API traffic.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const state=JSON.parse(fs.readFileSync('testdata/paper-synthetic-state.json','utf8'));
const settle=()=>new Promise(setImmediate);
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});
function setup(){
 const dom=new JSDOM(fs.readFileSync('paper.html','utf8'),{url:'https://example.test/paper.html',runScripts:'outside-only'}),w=dom.window;
 const calls=[],timers=new Map(),errors=[];let nextTimer=0,statusReply=()=>response(200,state),performanceReply=()=>response(200,{ok:true,cohorts:[]});
 w.AbortSignal={timeout:()=>undefined};w.setTimeout=(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;};w.clearTimeout=id=>timers.delete(id);
 w.addEventListener('error',event=>errors.push(event.error));
 w.fetch=async(url,options={})=>{calls.push({url,options});if(url.endsWith('health'))return response(200,{adminConfigured:true});if(url.endsWith('status'))return statusReply();if(url.includes('/performance'))return performanceReply();throw Error('Unexpected request');};
 const ctx=dom.getInternalVMContext();
 for(const script of w.document.querySelectorAll('script[src]'))vm.runInContext(fs.readFileSync(new URL(script.src).pathname.slice(1),'utf8'),ctx);
 vm.runInContext('globalThis.__poll=poll;',ctx);
 const el=id=>w.document.getElementById(id);
 return {w,el,calls,timers,errors,setStatus:fn=>{statusReply=fn;},setPerformance:fn=>{performanceReply=fn;},connect:async(token='SYNTHETIC_TOKEN')=>{el('token').value=token;el('connect').click();await settle();},dispose:()=>dom.window.close()};
}
function unavailable(h,pattern){
 assert.match(h.el('performanceStatus').textContent,pattern);
 assert.doesNotMatch(h.el('performanceStatus').textContent,/確認中|読み込み中/);
 for(const id of ['performanceLoad','performanceExport','performanceAccount','start','pause','exit','organizeAccounts','tradePreflight'])assert.equal(h.el(id).disabled,true,id+' is disabled when state is unavailable');
 assert.equal(h.el('connect').disabled,false,'manual reconnect remains available');
 assert.equal(h.el('token').disabled,false);
 assert.equal(h.el('cash').textContent,'--','unknown balance is neither zero nor the previous balance');
 assert.equal(h.el('comparison').textContent,'');assert.equal(h.el('performanceReport').textContent,'');
 assert.equal(h.timers.size,0,'failed state reads do not schedule repeated provider probes');
 assert.equal(h.w.localStorage.length,0);assert.equal(h.w.sessionStorage.length,0);
 assert(!h.w.document.body.textContent.includes('SYNTHETIC_TOKEN'));
 assert(!h.calls.some(c=>c.options.method==='POST'||/\/(tick|command)/.test(c.url)),'viewing failure never changes server state');
 assert.deepEqual(h.errors,[]);
}
(async()=>{
 const failures=[
  ['store denial',()=>response(503,{ok:false,error:'PAPER_STORE_UNAVAILABLE'}),/保存先に接続できない/],
  ['unauthorized',()=>response(401,{}),/認証.*未確認/],
  ['forbidden',()=>response(403,{}),/アクセスが拒否/],
  ['timeout',()=>{throw Object.assign(Error('private detail'),{name:'TimeoutError'});},/通信が時間切れ/],
  ['network',()=>{throw Error('SYNTHETIC_TOKEN private transport detail');},/サーバーと通信できず/],
  ['invalid response',()=>({ok:true,status:200,json:async()=>{throw SyntaxError('invalid JSON');}}),/サーバー応答を読み取れず/],
  ['body timeout',()=>({ok:true,status:200,json:async()=>{throw Object.assign(Error('body timeout'),{name:'TimeoutError'});}}),/通信が時間切れ/]
 ];
 for(const [name,reply,pattern] of failures){const h=setup();h.setStatus(reply);await h.connect();unavailable(h,pattern);h.dispose();console.log('PASS:',name);}
 const h=setup();await h.connect();
 assert.match(h.el('performanceStatus').textContent,/保存済み口座を取得しました/);assert.doesNotMatch(h.el('performanceStatus').textContent,/確認中/);
 assert.equal(h.el('performanceLoad').disabled,false);assert.match(h.el('cash').textContent,/9,993/);
 assert.equal(h.calls.filter(c=>c.url.includes('/performance')).length,0,'login does not add a full report read');
 let resolveOld;h.setPerformance(()=>new Promise(resolve=>{resolveOld=resolve;}));h.el('performanceLoad').click();
 h.setStatus(()=>response(503,{ok:false,error:'PAPER_STORE_UNAVAILABLE'}));await h.connect();unavailable(h,/保存先に接続できない/);
 resolveOld(response(200,{ok:true,cohorts:[]}));await settle();unavailable(h,/保存先に接続できない/);
 h.setStatus(()=>response(200,state));await h.connect('');assert.equal(h.el('performanceLoad').disabled,false,'reconnect reuses memory-only credentials after a storage error');
 assert.equal(h.calls.at(-1).options.headers.Authorization,'Bearer SYNTHETIC_TOKEN');assert.match(h.el('cash').textContent,/9,993/);
 h.setPerformance(()=>response(200,{ok:true,cohorts:[]}));h.el('performanceLoad').click();await settle();assert.match(h.el('performanceStatus').textContent,/成績を取得しました/);
 h.setStatus(()=>response(503,{ok:false,error:'PAPER_STORE_UNAVAILABLE'}));await h.w.__poll();unavailable(h,/保存先に接続できない/);
 h.dispose();console.log('PASS: success, same-token stale report, recovery, old-balance clearing and polling failure');
 const b=setup();let resolveStatus;b.setStatus(()=>new Promise(resolve=>{resolveStatus=resolve;}));await b.connect();
 assert.equal(b.el('connect').disabled,true);b.el('connect').click();assert.equal(b.calls.filter(c=>c.url.endsWith('status')).length,1,'double tap never starts parallel state reads');
 resolveStatus(response(200,state));await settle();assert.equal(b.el('connect').disabled,false);assert.doesNotMatch(b.el('performanceStatus').textContent,/確認中/);b.dispose();
 console.log('PASS: duplicate connection guard');
})().catch(error=>{console.error(error);process.exitCode=1;});
