'use strict';
// Execute the production HTML/scripts with synthetic authenticated responses.
// These checks never connect to a broker, run the PAPER engine or mutate state.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const baseline='V64_BASELINE_1:STANDARD',core='V66_CORE_TREND_1:STANDARD',retired='V64_TIME_1:STANDARD';
const boundary='2026-10-02T17:00:00Z',hash='a'.repeat(64);
const state=JSON.parse(fs.readFileSync('testdata/paper-synthetic-state.json','utf8'));
const template=structuredClone(state.accounts[baseline]);state.accounts={};
for(const strategy of ['V64_BASELINE_1','V64_TIME_1','V65_TREND_RETEST_1','V65_TREND_RETEST_2','V65_BALANCED_3','V66_CORE_TREND_1'])for(const kind of ['STANDARD','STRESS']){
 const id=strategy+':'+kind,a=structuredClone(template),main=[baseline,core].includes(id);
 a.account_id=id;a.config_hash=hash;a.entries_enabled=id===core;a.last_reason=id===baseline?'ENTRY_STOPPED':a.last_reason;
 a.account_management={version:'paper-account-organization-1',group:main?'MAIN':kind==='STRESS'?'AUXILIARY':'RETIRED',entry_retired:!main,
  reason:main?(id===baseline?'EXISTING_ENTRY_STOP':null):kind==='STRESS'?'AUXILIARY_ENTRIES_STOPPED':'ACCOUNT_CONSOLIDATION',
  stopped_at:main?null:boundary,last_active_at:'2026-10-02T16:55:00Z',pending_reconciled_at:boundary,settings_change_at:boundary};
 state.accounts[id]=a;
}
state.accountOrganization={version:'paper-account-organization-1',persisted:true,activated_at:boundary,main_accounts:[baseline,core]};
const initial=JSON.stringify(state),requests=[],errors=[];
const dom=new JSDOM(fs.readFileSync('paper.html','utf8'),{url:'https://example.test/paper.html',runScripts:'outside-only'}),w=dom.window,context=dom.getInternalVMContext();
w.AbortSignal={timeout:()=>undefined};w.setTimeout=()=>1;w.clearTimeout=()=>{};
w.fetch=async(url,options={})=>{requests.push({url,options});return {ok:true,status:200,json:async()=>url.endsWith('/health')?{adminConfigured:true}:structuredClone(state)};};
w.addEventListener('error',e=>errors.push(e.error||e.message));
for(const script of w.document.querySelectorAll('script[src]'))vm.runInContext(fs.readFileSync(new URL(script.src).pathname.slice(1),'utf8'),context);
vm.runInContext('globalThis.__show=show;globalThis.__showPerformance=showPerformance;globalThis.__authRequired=showAuthRequired;',context);
const el=id=>w.document.getElementById(id),settle=()=>new Promise(setImmediate);
const metric=(card,label)=>[...card.querySelectorAll('.reportMetrics > div')].find(n=>n.querySelector('span').textContent===label);
const closed=(n,net)=>({count:n,win_rate:n===0?0:null,win_rate_denominator:n,net_usd:net,average_win_usd:null,average_loss_usd:null,fees_usd:0});
const cohort=(id,phase,n,net)=>({cohort_id:id+':'+phase,account_id:id,strategy:id.split(':')[0],config_hash:hash,organization_phase:phase,organization_activated_at:boundary,
 closed:closed(n,net),open:{count:0,pending_entry_count:0,pending_exit_count:0,unresolved_count:0},drawdown:{realized_closed_usd:net==null?null:0,realized_closed_pct:net==null?null:0},sample:{status:'INSUFFICIENT'},entry_funnel:null,cumulative:[]});
(async()=>{
 await settle();el('token').value='SYNTHETIC_AUTH';el('connect').click();await settle();
 assert.deepEqual([...el('account').options].map(o=>o.value),[baseline,core]);
 assert.equal(el('mainAccounts').querySelectorAll('article').length,2);
 assert.equal(el('comparison').querySelectorAll('tr').length,2);
 assert.equal(el('retiredAccounts').querySelectorAll('article').length,4);
 assert.equal(el('auxiliaryAccounts').querySelectorAll('article').length,6);
 assert.equal(el('retiredAccountsPanel').open,false);assert.equal(el('auxiliaryAccountsPanel').open,false);
 assert.match(el('mainAccounts').querySelector('article').textContent,/通常版.*新規購入停止中/,'retained baseline does not silently resume its existing manual stop');
 assert.match(el('organizationStatus').textContent,/保存済み整理設定.*整理日時/);
 assert.match(el('retiredAccounts').textContent,/停止理由.*主比較を通常版.*最終稼働日時.*JST.*照合日時.*JST/);
 assert.equal(JSON.stringify(state),initial,'rendering keeps every history, balance, risk flag and policy unchanged');
 assert(requests.every(r=>r.options.method===undefined),'opening the screen only reads status and health');

 el('retiredAccounts').querySelector('button').click();
 assert.equal(el('account').value,retired);assert.equal(el('account').options.length,3);
 assert.match(el('accountLifecycle').textContent,/V64_TIME_1:STANDARD.*新規購入停止中/);
 assert.equal(el('json').disabled,false,'archived history remains exportable');
 el('account').value=baseline;el('account').dispatchEvent(new w.Event('change'));
 assert.equal(el('account').options.length,2,'returning to main comparison hides the explicit historical selection');

 const held=structuredClone(state);held.accounts[retired].state='OUT_PENDING';held.accounts[retired].position=structuredClone(template.history[0]);
 el('retiredAccountsPanel').open=false;w.__show(held);
 assert.equal(el('retiredAccountsPanel').open,true);assert.match(el('retiredAccountsCount').textContent,/保有・処理待ち 1口座/);
 assert.match(el('retiredAccounts').textContent,/決済待ち.*既存の出口管理を継続/);
 assert.equal(held.accounts[retired].position.outReason,template.history[0].outReason,'existing exit evidence is preserved');
 const pending=structuredClone(state);pending.accounts['V66_CORE_TREND_1:STRESS'].state='IN_PENDING';
 el('auxiliaryAccountsPanel').open=false;w.__show(pending);assert.equal(el('auxiliaryAccountsPanel').open,true,'pending reconciliation remains visible even without a held position');

 const legacy=structuredClone(state);delete legacy.accountOrganization;delete legacy.accounts[baseline].account_management;
 w.__show(legacy);assert.match(el('mainAccounts').textContent,/未整理.*整理設定は未取得/);assert.match(el('organizationStatus').textContent,/保存は未確認/);
 const malicious=structuredClone(state);malicious.accounts[retired].account_management.reason='<img src=x onerror=alert(1)>';
 w.__show(malicious);assert.equal(w.document.querySelector('#retiredAccounts img'),null);
 const risk=structuredClone(state);risk.accounts[core].risk_halted=true;w.__show(risk);
 assert.match(el('mainAccounts').textContent,/リスク停止中.*停止設定を保持/);

 w.__show(state);
 const report={filters:{from_date:'2026-09-29',to_date:'2026-10-02',account_id:null},account_organization:{activated_at:boundary},
  cohorts:[cohort(baseline,'BEFORE',1,null),cohort(baseline,'AFTER',1,5),cohort(core,'AFTER',0,0),cohort(retired,'BEFORE',1,-7),cohort('V66_CORE_TREND_1:STRESS','BEFORE',1,-9)]};
 const reportBefore=JSON.stringify(report);w.__showPerformance(report);
 const comparison=el('performanceReport').querySelector('table'),rows=[...comparison.querySelectorAll('tbody tr')];
 assert.equal(rows.length,3);assert(rows.every(r=>/通常版|独立判定版V66/.test(r.cells[0].textContent)));
 assert.equal(rows[0].cells[2].textContent,'口座整理前');assert.equal(rows[1].cells[2].textContent,'口座整理後');
 assert.equal(rows[0].cells[7].textContent,'未取得');assert.equal(rows[0].cells[8].textContent,'未取得');assert.equal(rows[0].cells[9].textContent,'未取得');
 assert.equal(rows[2].cells[3].textContent,'0');assert.equal(rows[2].cells[4].textContent,'未算出');assert.equal(rows[2].cells[7].textContent,'$0.00');
 const details=[...el('performanceReport').children].filter(n=>n.tagName==='DETAILS');assert.equal(details.length,2);assert(details.every(d=>!d.open));
 const cards=[...el('performanceReport').querySelectorAll('.performanceCohort')];assert.equal(cards.length,5,'secondary account histories are kept separately inside collapsible groups');
 assert.equal(metric(cards[2],'勝率').querySelector('strong').textContent,'未算出');assert.equal(JSON.stringify(report),reportBefore);
 assert.equal(JSON.stringify(state),initial);assert(!requests.some(r=>r.options.method==='POST'||/tick|command|exit\?/.test(r.url)));
 assert.deepEqual(errors,[]);assert.equal(w.localStorage.length,0);assert.equal(w.sessionStorage.length,0);
 w.__authRequired();for(const id of ['mainAccounts','retiredAccounts','auxiliaryAccounts','comparison','accountLifecycle','performanceReport'])assert.equal(el(id).textContent,'');
 assert.equal(el('account').options.length,0);assert.equal(el('retiredAccountsPanel').open,false);assert.equal(el('auxiliaryAccountsPanel').open,false);
 console.log('PASS: two-main account layout, persisted server lifecycle versus existing stops, collapsed history/STRESS, visible held/pending work, legacy source unknown, safe historical selection, period/config/organization phases, missing versus zero and auth clearing without state writes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
