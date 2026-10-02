'use strict';
// Offline DOM verification; no market data, broker, real credentials or state writes.
const fs=require('node:fs'),assert=require('node:assert/strict'),{JSDOM,ResourceLoader,VirtualConsole}=require('jsdom');
const state=JSON.parse(fs.readFileSync('testdata/paper-synthetic-state.json','utf8'));
const account='V64_BASELINE_1:STANDARD',hashA='a'.repeat(64),hashB='b'.repeat(64);
state.accounts[account].config_hash=hashA;
state.accounts[account].report.configuration={current_hash:hashA,recorded_hashes:[hashA,hashB],unrecorded_trades:0,scope:'MIXED_OR_UNRECORDED_CONFIG_REFERENCE_ONLY'};
state.accounts[account].report.groups.config_hash={[hashA]:{trades:1,net:10,status:'検証不足'},[hashB]:{trades:1,net:-7,status:'検証不足'}};
const coverage=(known,total)=>({known,total,missing:total-known,fraction:total?known/total:null});
const closed={count:4,wins:null,losses:null,draws:null,known_wins:2,known_losses:1,known_draws:0,
 win_rate:2/3,win_rate_denominator:3,average_win_usd:20,average_loss_usd:-30,average_net_usd:10/3,
 net_usd:null,known_net_usd:10,fees_usd:8,net_coverage:coverage(3,4),fee_coverage:coverage(4,4),
 profit_factor:4/3,profit_factor_status:'DEFINED',breakeven_win_rate:.6,breakeven_denominator_usd:50,trading_days:2};
const band={samples:3,win_rate:2/3,net:10,average_net:10/3,average_profit:20,average_loss:-30,max_realized_drawdown_usd:30};
const cohort={cohort_id:'A',account_id:account,strategy:'V64_BASELINE_1',config_hash:hashA,closed,
 open:{count:1,pending_entry_count:0,pending_exit_count:1,unresolved_count:0,unrealized_usd:12,mark_at:'2026-10-02T15:00:00Z'},
 drawdown:{realized_closed_usd:null,realized_closed_pct:null,initial_capital_usd:10000,
 method:'CHRONOLOGICAL_CLOSED_NET; SAME_TIMESTAMP_AGGREGATED; INITIAL_PEAK_NET_ZERO',full_marked_pct:2,
 full_marked_scope:'CURRENT_ACCOUNT_CONFIG_LIFETIME; OBSERVED_MARKS_AND_CONSERVATIVE_ZERO_ON_MISSING_QUOTES; OUTSIDE_DATE_FILTER',
 full_marked_method:'RECORDED_RUNNING_HIGH_WATER_EQUITY_PERCENT; MISSING_QUOTES_CAN_VALUE_POSITION_AT_ZERO; INTRABAR_PATH_UNKNOWN'},
 sample:{status:'INSUFFICIENT',cautions:['NET_EVIDENCE_MISSING; TOTAL_NET_UNAVAILABLE','<img src=x onerror=alert(1)>']},
 missing:{ledger_available:true,position_evidence_available:true,net:1,fees:0,closed_time:0,config_hash:0,entry_stage_funnel:'FORWARD_RECORDED',entry_telemetry_errors:null,last_entry_telemetry_error_at:null,score_study_errors:0},
 entry_funnel:{version:'ACCOUNT_ENTRY_STAGES_2',eligible_observations:10,total_observations:15,excluded_observations:5,
 counts:{candidate_detection:4,strategy_evaluation:6,contract_acquisition:7,fresh_quote:5,paper_signal:2,paper_fill:1,unfilled:0},
 stage_unknown:{candidate_detection:2,strategy_evaluation:0,contract_acquisition:0,fresh_quote:0,paper_signal:0},
 categories:{data_missing:2,conditions:6},category_rates:{data_missing:.2,conditions:.6},reasons:{SPYPRICEAT_MISSING:2},
 observed_since:'2026-10-02T13:30:00Z',last_observed_at:'2026-10-02T14:00:00Z',coverage:{retained_from:'2026-10-02',retained_to:'2026-10-02'}},
 score_study:{version:'SCORE_VIXY_STUDY_1',threshold:80,totals:null,cohorts:[],score_bands:{'100':band},
 vixy_groups:{UNKNOWN:band},missing_entry_evidence_trades:3,selected_actual_trades:3,
 coverage:{retained_cohort_limit:45,dropped_cohorts:0},variants_actual_trade_associations:{AS_OBSERVED:{...band,samples:0,win_rate:null,net:0}}},cumulative:[]};
const other={...structuredClone(cohort),cohort_id:'B',config_hash:hashB,closed:{...closed,count:0,wins:0,losses:0,draws:0,known_wins:0,known_losses:0,known_draws:0,win_rate:null,win_rate_denominator:0,net_usd:0,known_net_usd:0,net_coverage:coverage(0,0)},entry_funnel:null,score_study:null};
const report={ok:true,version:'paper-performance-1',generated_at:'2026-10-02T15:05:00Z',updated_at:null,
 filters:{from_date:'2026-09-29',to_date:'2026-10-02',account_id:account,config_hash:null},cohorts:[cohort,other],limitations:[]};
const calls=[],assetRequests=[],scriptErrors=[];
let performanceReply=async()=>({ok:true,status:200,json:async()=>structuredClone(report)});
const reply=async(url,options={})=>{calls.push({url,options});if(url.includes('/performance'))return performanceReply();
 return {ok:true,status:200,json:async()=>url.endsWith('health')?{adminConfigured:true}:url.includes('exit-study-v2?')?{spec:{version:'EXIT_STUDY_2'},study_hash:'FIXED_HASH',period:{from_date:'2026-09-29',to_date:'2026-10-02',unknown_date_excluded:0},groups:{},portfolios:{},history_scope:'RECENT_COMPLETED_CHECKPOINT',portfolio_scope:'UNAVAILABLE_FOR_FILTERED_PERIOD'}:structuredClone(state)};};
class LocalAssets extends ResourceLoader{
 fetch(url){
  const asset=new URL(url),path=asset.pathname.slice(1);assetRequests.push(path);
  assert.equal(asset.origin,'https://example.test','HTML assets never use external network');
  assert(['paper.js','performance.js','paper.css'].includes(path),'only production HTML assets are loaded');
  return Promise.resolve(Buffer.from(fs.readFileSync(path)));
 }
}
const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>scriptErrors.push(error));
// Load the real defer scripts through the document loader. Separate eval calls
// create private lexical scopes and cannot model classic browser script globals.
const dom=new JSDOM(fs.readFileSync('paper.html','utf8'),{url:'https://example.test/paper.html',runScripts:'dangerously',resources:new LocalAssets(),virtualConsole,
 beforeParse(window){window.AbortSignal={timeout:()=>undefined};window.setTimeout=()=>1;window.clearTimeout=()=>{};window.fetch=reply;
  window.addEventListener('error',event=>scriptErrors.push(event.error||Error(event.message)));}}),w=dom.window;
const loaded=new Promise(resolve=>w.addEventListener('load',resolve,{once:true}));
const settle=()=>new Promise(setImmediate),element=id=>w.document.getElementById(id);
(async()=>{
 await loaded;await settle();assert.deepEqual(scriptErrors,[],'the production HTML scripts load and execute without errors');
 assert.deepEqual(assetRequests.filter(path=>path.endsWith('.js')),['paper.js','performance.js'],'real production defer scripts execute in their declared order');
 assert.equal(element('performanceLoad').disabled,true);
 element('token').value='SYNTHETIC_TEST_TOKEN';element('connect').click();await settle();
 assert.equal(element('performanceLoad').disabled,false);assert(!calls.some(c=>c.url.includes('/performance')),'connection and polling do not fetch report or run its engine');
 const cashBefore=element('cash').textContent,historyBefore=element('history').textContent;
 const overview=[...element('comparison').querySelectorAll('tr')].find(r=>r.cells[0].textContent.includes('基準版')&&r.cells[0].textContent.includes('通常条件'));
 for(const col of [2,3,5,6])assert.equal(overview.cells[col].textContent,'設定別で確認');
 assert.match(element('stats').textContent,/固定設定が混在.*設定別で確認/);assert.match(element('stats').textContent,new RegExp(hashA));assert.match(element('stats').textContent,new RegExp(hashB));
 assert.doesNotMatch(element('stats').textContent,/勝率 0.0%|平均純損益 \$-7.00|PF 0.00/);
 assert.equal(element('groups').querySelectorAll('h3').length,1);assert.equal(element('groups').querySelector('h3').textContent,'固定設定のハッシュ');
 element('performanceFrom').value='2026-09-29';element('performanceTo').value='2026-10-02';element('performanceAccount').value=account;
 element('performanceLoad').click();await settle();
 const request=calls.find(c=>c.url.includes('/performance'));
 assert.equal(request.options.method,undefined);assert.equal(request.options.headers.Authorization,'Bearer SYNTHETIC_TEST_TOKEN');
 const query=new URL(request.url).searchParams;assert.equal(query.get('from'),'2026-09-29');assert.equal(query.get('to'),'2026-10-02');assert.equal(query.get('account_id'),account);
 assert(!request.url.includes('SYNTHETIC_TEST_TOKEN'));
 const cards=w.document.querySelectorAll('.performanceCohort');assert.equal(cards.length,2);
 assert.match(cards[0].textContent,new RegExp(hashA));assert.doesNotMatch(cards[0].textContent,new RegExp(hashB));assert.match(cards[1].textContent,new RegExp(hashB));
 const metric=(card,label)=>[...card.querySelectorAll('.reportMetrics > div')].find(n=>n.querySelector('span').textContent===label);
 assert.equal(metric(cards[0],'費用込み純損益').querySelector('strong').textContent,'未算出');
 assert.match(metric(cards[0],'勝率').textContent,/66.7%.*3件/);assert.match(metric(cards[0],'勝ち \/ 負け \/ 引分け').textContent,/未記録.*損益既知の部分：2勝・1敗・0引分け/);
 assert.equal(metric(cards[1],'勝率').querySelector('strong').textContent,'未算出');
 assert.match(cards[0].textContent,/0で評価.*選択した期間の外/);assert.match(cards[0].textContent,/含み損益\$12.00.*勝率・決済純損益から除外/);
 assert.match(cards[0].textContent,/観測記録エラー未記録件/);assert.match(cards[0].textContent,/スコア比較記録エラー0件/);assert.match(cards[0].textContent,/口座累計で、選択した期間の外も含みます/);
 assert.match(cards[0].textContent,/データ・履歴が不足2.*20.0%.*10観測/);
 assert.match(cards[0].textContent,/購入候補・見送り候補の観測は未記録/);assert.match(cards[0].textContent,/100点3.*66.7%/);
 assert.match(cards[0].textContent,/VIXY.*VIX指数そのものではありません/);assert.match(cards[0].textContent,/因果効果は推定できません/);
 assert.equal(w.document.querySelector('#performanceReport img'),null);
 assert.equal(element('cash').textContent,cashBefore);assert.equal(element('history').textContent,historyBefore);assert.equal(element('performanceExport').disabled,false);
 cards[0].querySelector('button').click();await settle();const exitRequest=calls.find(c=>c.url.includes('exit-study-v2?'));
 const exitQuery=new URL(exitRequest.url).searchParams;assert.equal(exitQuery.get('account'),account);assert.equal(exitQuery.get('config_hash'),hashA);assert.equal(exitQuery.get('from'),'2026-09-29');assert.equal(exitQuery.get('to'),'2026-10-02');assert.equal(exitRequest.options.method,undefined);
 assert.match(cards[0].textContent,/期間・固定設定を限定した比較/);
 assert(!calls.some(c=>c.options.method==='POST'||c.url.endsWith('/tick')||c.url.endsWith('/command')));
 assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);

 element('performanceConfig').value=hashB;element('performanceConfig').dispatchEvent(new w.Event('change'));
 assert.equal(element('performanceReport').textContent,'');assert.equal(element('performanceExport').disabled,true);
 element('performanceLoad').click();await settle();assert.equal(new URL(calls.at(-1).url).searchParams.get('config_hash'),hashB);
 let resolveOld;performanceReply=()=>new Promise(resolve=>{resolveOld=resolve;});element('performanceLoad').click();
 element('performanceFrom').value='2026-10-01';element('performanceFrom').dispatchEvent(new w.Event('change'));
 resolveOld({ok:true,status:200,json:async()=>structuredClone(report)});await settle();assert.equal(element('performanceReport').textContent,'','old filter response cannot populate new period');
 performanceReply=async()=>({ok:false,status:401,json:async()=>{throw Error('must not parse unauthorized report');}});
 element('performanceLoad').click();await settle();assert.match(element('performanceStatus').textContent,/認証.*未確認/);
 assert.equal(element('performanceReport').textContent,'');assert.equal(element('performanceLoad').disabled,true);assert.equal(element('performanceExport').disabled,true);assert.equal(element('cash').textContent,'--');
 assert(!w.document.body.textContent.includes('SYNTHETIC_TEST_TOKEN'));
 assert.deepEqual(scriptErrors,[],'full authenticated flow has no browser script errors');
 console.log('PASS: performance authenticated GET, inclusive ET filters, config separation, missing versus zero, known-net denominators, conservative DD, unrealized separation, score/VIXY evidence, filtered paired exit read, no state writes, filter-race rejection and 401 clearing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
