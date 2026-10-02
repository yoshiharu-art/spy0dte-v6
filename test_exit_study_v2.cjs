'use strict';
// Offline authenticated GET contract: separate studies, no PAPER engine tick.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const dom=new JSDOM(fs.readFileSync('paper.html','utf8'),{url:'https://example.test/paper.html',runScripts:'outside-only'}),w=dom.window;
const state=JSON.parse(fs.readFileSync('testdata/paper-synthetic-state.json','utf8')),calls=[];
const metric={label:'<img src=x onerror=alert(1)>',samples:1,win_rate:0,average_profit:null,average_loss:-5,
 profit_factor:0,expectancy:-5,net:-5,max_realized_drawdown_usd:5,average_hold_seconds:300,
 mfe_capture_ratio:null,reached50_then_loss:1,early_exit_then_additional25pp:0};
metric.exit_outcomes={filled_samples:1,net_known:1,net_unknown:0,hard_stop_count:1,hard_stop_rate:1,
 reason_known:1,reason_unknown:0,mean_loss_usd:-5,loss_samples:1,
 hard_stop_reached:{count:0,assessed_samples:0,fraction:null,unknown_mae:1,unknown_policy:0},
 hard_stop_reason:{count:1,net_known:1,net_unknown:0,mean_net_usd:-5,mean_loss_usd:-5,loss_samples:1},
 mfe_mae:{mfe_known:1,mfe_unknown:0,mean_mfe_pct:60,max_mfe_pct:60,mae_known:0,mae_unknown:1},
 reached50_then_net_loss:{count:1,reached50_samples:1,net_known:1,net_unknown:0,fraction:1},
 giveback:{samples:0,mean_pp:null,max_pp:null},exit_reasons:{HARD_STOP:{count:1,net_usd:-5,net_known:1,net_unknown:0}},
 past_hard_stop:{price_below_count:1,price_assessment_known:1,net_below_count:1,net_assessment_known:1,
 cause_observations:{QUOTE_GAP_IN_EXIT_PATH:1},unknown_cause_count:1,threshold_unknown:0}};
const study={spec:{version:'EXIT_STUDY_2'},study_hash:'FIXED_TEST_HASH',active:[],completed_total:1,errors:0,
 groups:{'V64_BASELINE_1:STANDARD|hash':{paired_complete:1,partial:1,candidates:{STAGE50:metric},
 observed_only:{STAGE50:{...metric,exit_outcomes:{...metric.exit_outcomes,filled_samples:2}}}}},portfolios:{},rows:[],limitations:[]};
w.AbortSignal={timeout:()=>undefined};w.setTimeout=()=>1;w.clearTimeout=()=>{};
w.fetch=async(url,options={})=>{calls.push({url,options});return {ok:true,status:200,json:async()=>url.endsWith('health')?{adminConfigured:true}:url.includes('exit-study-v2?')?study:structuredClone(state)};};
w.eval(fs.readFileSync('paper.js','utf8'));
(async()=>{
 await new Promise(setImmediate);
 assert.equal(w.document.getElementById('exitStudyV2Load').disabled,true);
 w.document.getElementById('token').value='OFFLINE_TEST';w.document.getElementById('connect').click();await new Promise(setImmediate);
 assert(!calls.some(c=>c.url.includes('exit-study-v2')),'study is not fetched on connection');
 const before=w.document.getElementById('cash').textContent;
 w.document.getElementById('exitStudy').textContent='OLD_STUDY_OUTPUT';
 w.document.getElementById('exitStudyV2Load').click();await new Promise(setImmediate);
 const request=calls.find(c=>c.url.includes('exit-study-v2?'));
 assert.equal(request.options.method,undefined);assert.equal(request.options.headers.Authorization,'Bearer OFFLINE_TEST');
 assert(request.url.includes('account=V64_BASELINE_1%3ASTANDARD'));
 assert.match(w.document.getElementById('exitStudyV2').textContent,/EXIT_STUDY_2.*FIXED_TEST_HASH/);
 assert.match(w.document.getElementById('exitStudyV2').textContent,/費用込み純損益/);
 assert.match(w.document.getElementById('exitStudyV2').textContent,/損切り水準到達率（観測MAE）未算出/);
 assert.match(w.document.getElementById('exitStudyV2').textContent,/HARD_STOP理由による決済率100.0%.*決済理由既知 1件/);
 assert.match(w.document.getElementById('exitStudyV2').textContent,/到達後に費用込み損失1件.*分母：\+50到達・純損益既知 1件/);
 assert.match(w.document.getElementById('exitStudyV2').textContent,/候補個別の観測済み決済・経路の欠落を含む \/ 決済 2件/);
 assert.match(w.document.getElementById('exitStudyV2').textContent,/因果関係の証明ではありません/);
 assert.equal(w.document.querySelector('#exitStudyV2 img'),null);
 assert.equal(w.document.getElementById('exitStudy').textContent,'OLD_STUDY_OUTPUT');
 assert.equal(w.document.getElementById('cash').textContent,before);
 assert.match(w.document.getElementById('exitStudyV2Status').textContent,/検証不足.*自動採用はしません/);
 assert.equal(w.document.getElementById('exitStudyV2Export').disabled,false);
 w.document.getElementById('retiredAccounts').querySelector('button').click();
 assert.equal(w.document.getElementById('account').value,'V64_TIME_1:STANDARD');
 assert.equal(w.document.getElementById('exitStudyV2').textContent,'');assert.equal(w.document.getElementById('exitStudyV2Export').disabled,true);
 assert(!calls.some(c=>c.url.endsWith('tick')||c.url.endsWith('command')));
 console.log('PASS: separate ExitStudy_2 authenticated GET, fixed version/hash, net metric, escaped text, unchanged old study/balance, account-switch invalidation and automatic adoption OFF.');
})().catch(error=>{console.error(error);process.exitCode=1;});
