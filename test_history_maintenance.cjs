// Synthetic request-contract checks only; never production requests or orders.
const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('paper.html','utf8'),{runScripts:'outside-only'}),w=dom.window;
w.AbortSignal={timeout:()=>undefined};w.fetch=async()=>({ok:true,json:async()=>({})});
w.eval(fs.readFileSync('paper.js','utf8')+'\nwindow.refreshHistory=refresh;window.stubHistory=(fn)=>{request=fn;show=()=>{};};');
(async()=>{
 const state={accounts:{A:{clock:{marketOpen:false}}},indicatorComparison:{registeredAccounts:['A'],historyReadiness:{missingDates:['2026-09-25'],recovery:{}}}};
 const calls=[];w.stubHistory(async(path,body)=>{calls.push([path,body]);return state;});
 await w.refreshHistory();assert.deepEqual(calls.map(x=>x[0]),['status','indicator-history-recovery']);
 assert.equal(typeof calls[1][1],'object');
 for(const sample of [{accounts:{}},{...state,accounts:{A:{clock:{marketOpen:true}}}},
 {...state,indicatorComparison:{...state.indicatorComparison,historyReadiness:{missingDates:['x'],recovery:{nextAttemptAt:'2099-01-01T00:00:00Z'}}}}]){
  calls.length=0;w.stubHistory(async path=>{calls.push(path);return sample;});
  await w.refreshHistory();assert.deepEqual(calls,['status']);
 }
 w.stubHistory(async path=>{if(path==='status')return state;throw Error('retry later');});
 await w.refreshHistory();assert.match(w.document.getElementById('message').textContent,/履歴の自動補完.*retry later/);
 console.log('PASS: authenticated history-only startup, RTH/retry guards, backward compatibility, failure visibility');
 dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
