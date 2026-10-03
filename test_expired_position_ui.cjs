'use strict';
// Rendering and command isolation use saved synthetic state only. No live API,
// quote, broker, tick, reconciliation mutation or browser token persistence.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const nodes=new Map(),requests=[];
function make(tag='div'){return {tagName:tag.toUpperCase(),textContent:'',value:'',disabled:false,hidden:false,open:false,children:[],options:[],
 addEventListener(){},setAttribute(){},replaceChildren(){this.children=[];this.options=[];this.textContent='';},
 append(...children){this.children.push(...children);if(this.tagName==='SELECT')this.options.push(...children);}};}
const document={getElementById(id){if(!nodes.has(id))nodes.set(id,make(id==='account'?'select':'div'));return nodes.get(id);},createElement:make};
const box=vm.createContext({Intl,URL,URLSearchParams,Date,Number,JSON,AbortSignal,crypto,document,
 setTimeout(){return 1;},clearTimeout(){},window:{addEventListener(){}},fetch:async(url,options)=>{requests.push({url,options});return {ok:true,status:200,json:async()=>({adminConfigured:true})};}});
for(const file of ['paper.js','performance.js','organize-ui.js'])vm.runInContext(fs.readFileSync(file,'utf8'),box,{filename:file});
const run=s=>vm.runInContext(s,box),el=id=>document.getElementById(id),all=n=>[n,...n.children.flatMap(all)],text=n=>all(n).map(x=>x.textContent).join(' ');
const regular='V64_BASELINE_1:STANDARD',core='V66_CORE_TREND_1:STANDARD',retired='V64_TIME_1:STANDARD';
const affected=[regular,'V64_BASELINE_1:STRESS',retired,'V64_TIME_1:STRESS'];
const state=JSON.parse(fs.readFileSync('testdata/paper-synthetic-state.json','utf8')),template=structuredClone(state.accounts[regular]);state.accounts={};
state.server_time='2026-10-03T02:14:00Z';state.accountOrganization={persisted:true,activated_at:'2026-10-02T21:00:00Z'};
for(const strategy of ['V64_BASELINE_1','V64_TIME_1','V65_TREND_RETEST_1','V65_TREND_RETEST_2','V65_BALANCED_3','V66_CORE_TREND_1'])for(const kind of ['STANDARD','STRESS']){
 const id=strategy+':'+kind,a=structuredClone(template),main=[regular,core].includes(id);
 a.account_id=id;a.entries_enabled=main;a.account_management={group:main?'MAIN':kind==='STRESS'?'AUXILIARY':'RETIRED',entry_retired:!main};
 a.clock.utc=state.server_time;a.clock.fillWindowEnd='2026-10-05T20:00:00Z';
 if(affected.includes(id)){
  a.state='OUT_PENDING';a.position=structuredClone(template.history[0]);a.position.trade_id='original-'+id;
  a.position.inAt='2026-10-02T13:57:14.299260Z';a.position.inClock.fillWindowEnd='2026-10-02T20:00:00Z';
  a.position.unresolved=true;a.position.debit_cents=27845;
  a.position_recovery={status:'EXPIRED_UNRECONCILED',resolution_kind:'UNRECONCILED',entry_protected:true,trade_id:a.position.trade_id,
   fill_window_end_at:a.position.inClock.fillWindowEnd,unsettled_debit_cents:27845,missing_evidence:['DURABLE_EXIT_FILL_RECORD_MISSING'],
   next_actions:['VERIFY_COMPLETE_STATE_AND_JOURNAL','SUPPLY_DURABLE_COMPLETE_EXIT_RECORD'],last_reconciled_at:null,cause_status:'UNCONFIRMED'};
 }
 state.accounts[id]=a;
}
box.state=state;run("paperConnected=true;paperToken='SYNTHETIC';show(state)");const original=JSON.stringify(state);
assert.equal(el('mainAccounts').children.length,2);assert.equal(el('retiredAccounts').children.length,4);assert.equal(el('auxiliaryAccounts').children.length,6);
assert.equal(el('expiredPositionsPanel').hidden,false);assert.equal(el('expiredPositions').children.length,4);
assert.match(el('expiredPositionsSummary').textContent,/照合待ち 4口座/);
for(const card of el('expiredPositions').children){assert.match(text(card),/期限超過・照合待ち.*未確定資金（原購入debit）.*278\.45.*保存確認済みOUT約定記録が不足/);assert.match(text(card),/全state・全journal.*手動exitでは解消不可.*原因.*未確定/);}
assert.equal(el('decision').textContent,'期限超過・照合待ち');assert.match(text(el('position')),/保存値の推定評価（売却約定ではない）/);
assert.doesNotMatch(text(el('mainAccounts').children[0]),/既存の出口管理を継続/);
assert.equal(el('retiredAccountsPanel').open,true);assert.equal(el('auxiliaryAccountsPanel').open,true);
assert.match(el('retiredAccountsCount').textContent,/期限超過・照合待ち 1口座/);assert.match(el('auxiliaryAccountsCount').textContent,/期限超過・照合待ち 2口座/);
assert.equal(el('start').disabled,true);assert.equal(el('exit').disabled,true);assert.equal(el('pause').disabled,false);
const mismatch=structuredClone(state);mismatch.accounts[regular].position_recovery.missing_evidence=['STATE_JOURNAL_FILL_RECONCILIATION_MISMATCH'];box.mismatch=mismatch;
run('show(mismatch)');assert.match(text(el('positionRecoveryStatus')),/stateとjournalのIN／OUT照合が不一致/);
run("el('account').value='V66_CORE_TREND_1:STANDARD';show(state)");assert.equal(el('start').disabled,false,'V66 is not globally stopped');assert.equal(el('positionRecoveryStatus').hidden,true);
assert.equal(state.accounts[regular].entries_enabled,true,'display protection never rewrites the saved entry flag');assert.equal(JSON.stringify(state),original);

// Old status still protects the original saved contract even if today's
// calendar has a later window. Missing amount/evidence is never invented.
const fallback=structuredClone(state);delete fallback.accounts[regular].position_recovery;
fallback.accounts[regular].position.unresolved=false;delete fallback.accounts[regular].position.debit_cents;
box.fallback=fallback;run("el('account').value='V64_BASELINE_1:STANDARD';show(fallback)");
assert.equal(el('decision').textContent,'期限超過・照合待ち');assert.match(text(el('positionRecoveryStatus')),/未確定資金（原購入debit） 未取得/);
assert.match(text(el('positionRecoveryStatus')),/照合結果は未取得/);assert.doesNotMatch(text(el('positionRecoveryStatus')),/278\.45/);
const noTime=structuredClone(fallback);delete noTime.server_time;delete noTime.accounts[regular].clock.utc;box.noTime=noTime;
assert.equal(run('positionRecovery(noTime.accounts["V64_BASELINE_1:STANDARD"],noTime)'),null,'device time cannot assert expiration');
const missingOrigin=structuredClone(noTime);missingOrigin.accounts[regular].position.unresolved=true;delete missingOrigin.accounts[regular].position.inAt;
delete missingOrigin.accounts[regular].position.inClock.fillWindowEnd;box.missingOrigin=missingOrigin;
assert.equal(run('positionRecovery(missingOrigin.accounts["V64_BASELINE_1:STANDARD"],missingOrigin).entry_protected'),true,'saved unresolved flag remains protected despite missing original timestamps');
const edge=structuredClone(fallback);edge.server_time=edge.accounts[regular].position.inClock.fillWindowEnd;box.edge=edge;
assert.equal(run('positionRecovery(edge.accounts["V64_BASELINE_1:STANDARD"],edge).entry_protected'),true,'saved fill-window boundary is protected');
const awaiting=structuredClone(state);awaiting.server_time='2026-10-02T19:59:00Z';awaiting.accounts[regular].position.unresolved=false;
awaiting.accounts[regular].position_recovery={status:'OUT_PENDING',entry_protected:false};box.awaiting=awaiting;
run('show(awaiting)');assert.equal(el('decision').textContent,'決済待ち');assert.equal(el('exit').disabled,false);assert.match(text(el('mainAccounts').children[0]),/既存の出口管理を継続/);

// A missing current position is insufficient proof. Only the exact server
// resolution status can classify the saved PAPER OUT as verified.
const missing=structuredClone(state);missing.accounts[regular].position=null;missing.accounts[regular].state='FLAT';box.missing=missing;
run('show(missing)');assert.equal(el('decision').textContent,'期限超過・照合待ち');assert.equal(el('exit').disabled,true);
const restored=structuredClone(missing),closed=structuredClone(state.accounts[regular].position);
closed.outAt='2026-10-02T19:46:00Z';restored.accounts[regular].history.push(closed);restored.accounts[regular].entries_enabled=false;
restored.accounts[regular].position_recovery={...restored.accounts[regular].position_recovery,status:'RESOLVED_DURABLE_EXIT_VERIFIED',resolution_kind:'SAVED_PAPER_OUT',entry_protected:false,unsettled_debit_cents:null};box.restored=restored;
run('show(restored)');assert.match(text(el('positionRecoveryStatus')),/保存済みPAPER売却約定の照合済み.*原購入debit（履歴に保持）.*278\.45/);
assert.match(text(el('positionRecoveryStatus')),/新規購入の停止設定は自動で解除しません/);assert.equal(restored.accounts[regular].entries_enabled,false);
const incomplete=structuredClone(restored);incomplete.accounts[regular].position_recovery.resolution_kind='ESTIMATE_ONLY';box.incomplete=incomplete;
assert.equal(run('positionRecovery(incomplete.accounts["V64_BASELINE_1:STANDARD"],incomplete).entry_protected'),true,'unsupported resolution cannot remove protection or be classified as saved OUT');

(async()=>{
 box.commandLog=[];run("request=async(path,body)=>{commandLog.push({path,body});return state};paperConnected=true;paperToken='SYNTHETIC';show(state)");
 await run("command('start')");await run("command('exit')");assert.equal(box.commandLog.length,0,'protected start/exit never issue a POST');
 run("el('account').value='V66_CORE_TREND_1:STANDARD';show(state)");await run("command('start')");
 assert.equal(box.commandLog.length,1);assert.equal(box.commandLog[0].body.account_id,core);assert.equal(box.commandLog[0].body.command,'start');
 assert.equal(JSON.stringify(state),original);assert.equal(requests.length,1,'rendering only allows the existing initial public health read');
 run('showAuthRequired()');assert.equal(el('expiredPositionsPanel').hidden,true);assert.equal(el('expiredPositions').children.length,0);assert.equal(el('positionRecoveryStatus').children.length,0);
 assert.equal(el('start').disabled,true);assert.equal(el('exit').disabled,true);
 console.log('PASS: four expired accounts distinctly protected with original debit/evidence, preserved 2/4/6 account groups and ledgers, server/original-window fallback and unknowns, ordinary pending exits, exact saved-OUT recovery, selected-account commands, and auth clearing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
