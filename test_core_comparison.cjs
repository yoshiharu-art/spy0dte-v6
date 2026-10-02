'use strict';
// Offline contract checks. No external packages, market data, orders or credentials.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const nodes=new Map(),calls=[];
function node(){return {textContent:'',innerHTML:'',value:'',disabled:false,children:[],options:[],
 addEventListener(){},replaceChildren(){this.children=[];this.options=[];this.textContent='';},
 append(...children){this.children.push(...children);this.options.push(...children);}};}
const document={getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
const context=vm.createContext({Intl,URL,Date,Number,JSON,AbortSignal,crypto,document,
 setTimeout(){return 1;},clearTimeout(){},window:{addEventListener(){}},
 fetch:async(url,options)=>{calls.push({url,options});return {ok:true,status:200,json:async()=>({adminConfigured:true})};}});
vm.runInContext(fs.readFileSync('paper.js','utf8'),context);
const run=source=>vm.runInContext(source,context),text=id=>[document.getElementById(id).textContent,...document.getElementById(id).children.map(n=>n.textContent)].join(' ');
const fixture=JSON.parse(fs.readFileSync('testdata/paper-synthetic-state.json','utf8'));
const original=structuredClone(fixture),snapshot=structuredClone(fixture);
const core=structuredClone(snapshot.accounts['V64_BASELINE_1:STANDARD']);
core.account_id='V66_CORE_TREND_1:STANDARD';
core.entry_funnel={version:'entry-funnel-1',observed_since:'2026-10-02T13:30:00Z',
 eligible_observations:100,valid_data_observations:70,valid_flat_observations:60,
 signals:6,fills:4,unfilled:1,unique_5m_direction_opportunities:3,
 categories:{SYSTEM_NOT_READY:20,NO_TRADE:50},reasons:{OPTION_CONTRACT_UNAVAILABLE:2}};
core.last_indicator_analysis={strategy:'V66_CORE_TREND_1',entryBasis:'CLOSED_5M_CORE_TREND_AND_COST_RISK',
 observedAt:'2026-10-02T14:00:00Z',decisionClass:'SIGNAL_READY',status:'PASS',features:{},reasons:[]};
core.core_entry_sampling={session:'2026-10-02',observations:100,baselineBuyObservations:3,
 independentBuyObservations:6,additionalBuyObservations:4,uniqueBuyWindows:3};
core.clock.marketOpen=true;
core.report.execution_quality={entry:{samples:4,mean_seconds:.25,p50_seconds:.2,p95_seconds:.4,max_seconds:.5},
 exit:{samples:1,mean_seconds:1,p50_seconds:1,p95_seconds:1,max_seconds:1},max_observation_gap_seconds:60};
snapshot.accounts[core.account_id]=core;
const stress=structuredClone(core);stress.account_id='V66_CORE_TREND_1:STRESS';snapshot.accounts[stress.account_id]=stress;
context.snapshot=snapshot;
run("el('account').value='V66_CORE_TREND_1:STANDARD';show(snapshot)");
assert.match(document.getElementById('account').options.find(o=>o.value===core.account_id).textContent,/独立判定版V66.*STANDARD/);
assert.equal(document.getElementById('account').options.find(o=>o.value===stress.account_id),undefined,'STRESS is accessible through auxiliary history rather than the main selector');
assert(document.getElementById('auxiliaryAccounts').children.some(card=>card.children[0].textContent==='独立判定版V66 · STRESS'));
assert.match(text('indicatorAnalysis'),/基準版の80点BUYとは独立したPAPER口座/);
assert.match(text('indicatorAnalysis'),/独立条件通過 6回・重複を除く 3枠/);
assert.match(text('indicatorAnalysis'),/追加候補 4回/);
assert.match(run("reasonText('CORE_DIRECTION_CONTRACT_UNAVAILABLE / DELTA_OUTSIDE_POLICY')"),/選んだ方向の実際の契約候補が未取得.*時間帯ごとのデルタ条件未達/);
assert.match(text('entryFunnel'),/観測 100回.*有効データ 70回.*70.0%/);
assert.match(text('entryFunnel'),/購入指示 6件.*分母：保有なし・有効データ 60回、10.0%/);
assert.match(text('entryFunnel'),/PAPER購入約定 4件.*分母：購入指示 6件、66.7%/);
assert.match(text('entryFunnel'),/5分足×方向の候補 3枠/);
assert.match(text('entryFunnel'),/オプション契約候補が未取得/);
assert.match(text('stats'),/決済 1件.*勝率 0.0%.*純損益 \$-7.00.*決済費用 \$2.00.*平均損失 \$-7.00/);
assert.match(text('executionQuality'),/中央値 0.2秒.*95%点 0.4秒.*実測 4件/);
assert.match(text('history'),/個別約定の保存時刻は未記録/);
assert.deepEqual(snapshot.accounts['V64_BASELINE_1:STANDARD'],original.accounts['V64_BASELINE_1:STANDARD'],'rendering preserves comparison history, balances and policy');
assert.equal(calls.length,1,'rendering only performs the existing public health read; never runs tick');

const zero={...core.report.summary,trades:0,win_rate:0,average_net:null,net:0,fees:0};
core.report.summary=zero;run('show(snapshot)');
assert.match(text('stats'),/決済 0件.*勝率 未算出/);
assert.doesNotMatch(text('stats'),/勝率 0.0%/);
assert.equal(document.getElementById('comparison').children.find(r=>r.children[0].textContent.includes('独立判定版V66')).children[2].textContent,'未算出（決済なし）');
core.entry_funnel={version:'entry-funnel-1',observed_since:null,eligible_observations:0,valid_data_observations:0,
 valid_flat_observations:null,signals:null,fills:null,unfilled:null,unique_5m_direction_opportunities:null};
run('show(snapshot)');assert.match(text('entryFunnel'),/観測 0回.*有効データ 0回/);
assert.match(text('entryFunnel'),/購入指示 未記録件.*PAPER購入約定 未記録件/);
assert.doesNotMatch(text('entryFunnel'),/NaN|Infinity/);
delete core.entry_funnel;run('show(snapshot)');assert.match(text('entryFunnel'),/新集計は未記録.*ゼロとして補完しません/);
run("el('exitStudy').textContent='OLD_STUDY';showExitStudy({spec:{version:'EXIT_STUDY_2'},study_hash:'TEST_HASH',groups:{},portfolios:{}},'V2')");
assert.match(text('exitStudyV2'),/EXIT_STUDY_2.*TEST_HASH/);
assert.equal(document.getElementById('exitStudy').textContent,'OLD_STUDY');
assert.match(text('exitStudyV2Status'),/検証不足.*自動採用はしません/);
run("el('account').value='V64_BASELINE_1:STANDARD';show(snapshot)");
assert.equal(document.getElementById('account').value,'V64_BASELINE_1:STANDARD','explicit legacy selection remains available');
run('showAuthRequired()');assert.match(text('entryFunnel'),/件数は未確認/);
assert.equal(document.getElementById('exitStudyV2').children.length,0);assert.equal(document.getElementById('exitStudyV2Export').disabled,true);
assert.equal(document.getElementById('comparison').children.length,0);
assert(nodes.values().every(n=>n.innerHTML===''),'new data renders as text');
assert.match(fs.readFileSync('paper.html','utf8'),/実注文 OFF/);
console.log('PASS: independent PAPER account names, legacy comparison preserved, funnel denominators/null versus zero, 0-trade unavailable versus 0% win rate, cost/net/average loss, latency percentiles, unknown persistence and auth clearing.');
