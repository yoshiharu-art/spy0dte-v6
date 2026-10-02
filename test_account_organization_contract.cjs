'use strict';
// Dependency-free rendering contracts. Full production HTML integration is
// separately covered by test_account_organization.cjs with JSDOM in CI.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const nodes=new Map(),requests=[];
function make(tag='div'){return {tagName:tag.toUpperCase(),textContent:'',innerHTML:'',value:'',disabled:false,open:false,children:[],options:[],
 addEventListener(){},setAttribute(){},replaceChildren(){this.children=[];this.options=[];this.textContent='';},
 append(...children){this.children.push(...children);if(this.tagName==='SELECT')this.options.push(...children);}};}
const document={getElementById(id){if(!nodes.has(id))nodes.set(id,make(id==='account'?'select':'div'));return nodes.get(id);},createElement:make};
const box=vm.createContext({Intl,URL,URLSearchParams,Date,Number,JSON,AbortSignal,crypto,document,
 setTimeout(){return 1;},clearTimeout(){},window:{addEventListener(){}},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>({adminConfigured:true})};}});
for(const file of ['paper.js','performance.js'])vm.runInContext(fs.readFileSync(file,'utf8'),box,{filename:file});
const run=s=>vm.runInContext(s,box),el=id=>document.getElementById(id),all=n=>[n,...n.children.flatMap(all)],text=n=>all(n).map(x=>x.textContent).join(' ');
const fixture=JSON.parse(fs.readFileSync('testdata/paper-synthetic-state.json','utf8')),template=structuredClone(fixture.accounts['V64_BASELINE_1:STANDARD']);
const regular='V64_BASELINE_1:STANDARD',core='V66_CORE_TREND_1:STANDARD',old='V64_TIME_1:STANDARD',at='2026-10-02T17:00:00Z';
const state=structuredClone(fixture);state.accounts={};
for(const strategy of ['V64_BASELINE_1','V64_TIME_1','V65_TREND_RETEST_1','V65_TREND_RETEST_2','V65_BALANCED_3','V66_CORE_TREND_1'])for(const kind of ['STANDARD','STRESS']){
 const id=strategy+':'+kind,a=structuredClone(template),main=[regular,core].includes(id);
 a.account_id=id;a.entries_enabled=id===core;
 a.account_management={group:main?'MAIN':kind==='STRESS'?'AUXILIARY':'RETIRED',entry_retired:!main,reason:main?'EXISTING_ENTRY_STOP':'ACCOUNT_CONSOLIDATION',
  stopped_at:main?null:at,last_active_at:at,pending_reconciled_at:at};state.accounts[id]=a;
}
state.accountOrganization={persisted:true,activated_at:at};box.state=state;
const baseline=JSON.stringify(state);run('show(state)');
assert.deepEqual(el('account').options.map(o=>o.value),[regular,core]);
assert.equal(el('mainAccounts').children.length,2);assert.equal(el('comparison').children.length,2);
assert.equal(el('retiredAccounts').children.length,4);assert.equal(el('auxiliaryAccounts').children.length,6);
assert.match(text(el('mainAccounts').children[0]),/新規購入停止中.*整理前からの新規購入停止を保持/);
assert.match(el('organizationStatus').textContent,/保存済み/);
run("selectPaperAccount('V64_TIME_1:STANDARD')");assert.equal(el('account').value,old);assert.equal(el('account').options.length,3);
assert.match(text(el('accountLifecycle')),/V64_TIME_1:STANDARD.*新規購入停止中/);
run("paperViewedSecondaryAccount=null;el('account').value='V64_BASELINE_1:STANDARD';show(state)");assert.equal(el('account').options.length,2);
const held=structuredClone(state);held.accounts[old].state='OUT_PENDING';held.accounts[old].position=structuredClone(template.history[0]);box.held=held;
run('show(held)');assert.equal(el('retiredAccountsPanel').open,true);assert.match(el('retiredAccountsCount').textContent,/1口座/);
assert.match(text(el('retiredAccounts')),/決済待ち.*既存の出口管理を継続/);
const legacy=structuredClone(state);delete legacy.accountOrganization;for(const a of Object.values(legacy.accounts))delete a.account_management;
legacy.accounts[old].entries_enabled=true;box.legacy=legacy;run('show(legacy)');
assert.match(el('organizationStatus').textContent,/未整理/);assert.match(text(el('retiredAccounts')),/新規購入判定の対象.*未整理/);
assert.doesNotMatch(text(el('retiredAccounts').children[0]),/新規購入を休止済み/);
run('show(state)');
const c=(id,phase,n,net)=>({account_id:id,strategy:id.split(':')[0],config_hash:'same-frozen-config',organization_phase:phase,organization_activated_at:at,
 closed:{count:n,win_rate:n===0?0:null,net_usd:net},open:{count:0},drawdown:{realized_closed_usd:net==null?null:0},sample:{},entry_funnel:null});
const report={filters:{from_date:'2026-09-29',to_date:'2026-10-02'},account_organization:{activated_at:at},cohorts:[c(regular,'BEFORE',1,null),c(regular,'AFTER',1,5),c(core,'AFTER',0,0),c(old,'BEFORE',1,-7),c('V66_CORE_TREND_1:STRESS','BEFORE',1,-9)]};box.report=report;
const before=JSON.stringify(report);run('showPerformance(report)');
const table=all(el('performanceReport')).find(n=>n.tagName==='TABLE'),rows=table.children.find(n=>n.tagName==='TBODY').children;
assert.equal(rows.length,3);assert.equal(rows[0].children[2].textContent,'口座整理前');assert.equal(rows[1].children[2].textContent,'口座整理後');
for(const idx of [7,8,9])assert.equal(rows[0].children[idx].textContent,'未取得');
assert.equal(rows[2].children[3].textContent,'0');assert.equal(rows[2].children[4].textContent,'未算出');assert.equal(rows[2].children[7].textContent,'$0.00');
const groups=el('performanceReport').children.filter(n=>n.tagName==='DETAILS');assert.equal(groups.length,2);assert(groups.every(g=>!g.open));
assert.equal(JSON.stringify(report),before);assert.equal(JSON.stringify(state),baseline);assert.equal(requests.length,1);
run('showAuthRequired()');for(const id of ['mainAccounts','retiredAccounts','auxiliaryAccounts','comparison','accountLifecycle','performanceReport'])assert.equal(el(id).children.length,0);
assert.equal(el('account').options.length,0);
(async()=>{
 box.commandLog=[];
 run("request=async(path,body)=>{commandLog.push(body);return state};paperToken='SYNTHETIC';paperConnected=true;paperAuthRequired=false;paperSnapshot=legacy;el('account').value='V64_BASELINE_1:STANDARD'");
 await run("command('start')");assert.equal(box.commandLog.length,0,'unorganized status cannot start any account');
 run("paperSnapshot=state;el('account').value='V66_CORE_TREND_1:STANDARD'");await run("command('start')");
 assert.equal(box.commandLog.length,1);assert.equal(box.commandLog[0].account_id,core,'explicit start only targets the selected main account');
 assert.equal(state.accounts[regular].entries_enabled,false,'other main manual stop is kept');assert.equal(JSON.stringify(state),baseline);
 console.log('PASS: dependency-free two-main lifecycle/state, existing stops, unorganized live flags, held/pending visibility, historical selection, period/config/organization phases, unknown versus zero, auth clearing and selected-main start guard.');
})().catch(error=>{console.error(error);process.exitCode=1;});
