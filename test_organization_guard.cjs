'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const main=['V64_BASELINE_1:STANDARD','V66_CORE_TREND_1:STANDARD'],retired='V64_TIME_1:STANDARD';
const account={trades:[{trade_id:'saved',net_cents:125}],cash_cents:1000125,realized_cents:125,fees_cents:200,policy:{initial_cents:1000000},config_hash:'frozen',risk_halted:false,daily_halted:false,state:'FLAT',position:null,unfilled:0,entries_enabled:true};
const before={data_mode:'LIVE',revision:9,accounts:Object.fromEntries([...main,retired].map(id=>[id,structuredClone(account)]))};
before.accounts[main[0]].entries_enabled=false;before.accounts[main[1]].risk_halted=true;
const after=structuredClone(before);after.revision++;
after.account_organization={version:'paper-account-organization-1',main_accounts:main,activated_at:'2026-10-02T22:00:00Z'};
for(const [id,a] of Object.entries(after.accounts)){if(id===retired)a.entries_enabled=false;a.account_management={group:id===retired?'RETIRED':'MAIN'};}
const status={accounts:after.accounts,mode:'PAPER',autoTrade:false,orderSubmissionEnabled:false,accountOrganization:{...after.account_organization,persisted:true}};
function harness(failure){
 const nodes=new Map(),requests=[];
 const el=id=>{if(!nodes.has(id))nodes.set(id,{disabled:true,textContent:'',addEventListener(){}});return nodes.get(id);};
 const ctx=vm.createContext({el,MAIN_ACCOUNT_IDS:main,JSON,Date,Number,Object,Array,Error,URL,Blob,crypto,
 paperConnected:true,paperToken:'SYNTHETIC_PRIVATE_TOKEN',paperSnapshot:{accounts:before.accounts},paperTimer:null,
 clearTimeout(){},setTimeout(){return 1;},poll(){},selectedPositionProtected(){return false;},window:{addEventListener(){}},
 show(s){ctx.paperSnapshot=s;},request:async(path,body)=>{
  requests.push({path,body});
  if(path==='export?format=json')return {state:structuredClone(requests.some(r=>r.path==='command')?after:before)};
  if(path.startsWith('export?format=journal'))return {raw_events:['original-event'],snapshot_end:failure==='journal'?2:1,next_start:null};
  if(path==='health')return {stateStorage:{lossless:true,atomicPublication:true},accountOrganization:{version:failure==='health'?'old':'paper-account-organization-1'}};
  if(path==='command'){assert.equal(body.expected_revision,9);assert.equal(body.command,'consolidate');assert.equal(body.account_id,'ALL');if(failure==='command')throw Error('SAVE_UNCONFIRMED');return structuredClone(status);}
  if(path==='status')return structuredClone(status);
  throw Error('Unexpected request');
 }});
 vm.runInContext(fs.readFileSync('organize-ui.js','utf8'),ctx);
 return {ctx,el,requests,run:code=>vm.runInContext(code,ctx)};
}
(async()=>{
 const h=harness();assert.equal(h.el('organizeAccounts').disabled,false);
 await h.run('organizePaperAccounts()');
 assert.match(h.el('organizationResult').textContent,/全口座の履歴・残高.*照合しました.*未検証/);
 const backup=JSON.parse(h.run('JSON.stringify(organizationBackups)'));
 assert.equal(backup.verification.journal_prefix,'MATCHED');assert.equal(backup.verification.continuous_scheduled_saves,'UNVERIFIED');
 assert(!JSON.stringify(backup).includes('SYNTHETIC_PRIVATE_TOKEN'));
 assert.equal(h.requests.filter(r=>r.path==='command').length,1);
 assert.equal(h.el('organizeAccounts').disabled,true);assert.equal(h.el('organizationExport').disabled,false);
 await h.run('organizePaperAccounts()');assert.equal(h.requests.filter(r=>r.path==='command').length,1);
 for(const failure of ['journal','health','command']){
  const f=harness(failure);await f.run('organizePaperAccounts()');
  assert.equal(f.requests.filter(r=>r.path==='command').length,failure==='command'?1:0);
  assert.doesNotMatch(f.el('organizationResult').textContent,/照合しました/);
  if(failure==='command')assert.match(f.el('organizationResult').textContent,/自動で再送・初期化はしません/);
 }
 h.run('clearOrganizationBackups()');assert.equal(h.run('organizationBackups'),null);
 assert.equal(h.el('organizationExport').disabled,true);
 h.ctx.after=structuredClone(after);h.ctx.before=before;h.ctx.status=status;
 h.ctx.after.accounts[main[0]].cash_cents++;
 assert.throws(()=>h.run('organizationVerify(before,after,status)'),/照合が不一致/);
 h.ctx.after=structuredClone(after);h.ctx.after.accounts[main[0]].entries_enabled=true;
 assert.throws(()=>h.run('organizationVerify(before,after,status)'),/新規購入停止が不一致/);
 h.ctx.after=structuredClone(after);h.ctx.after.revision++;
 assert.throws(()=>h.run('organizationVerify(before,after,status)'),/別の保存が進みました/);
 console.log('PASS: guarded authenticated consolidation requires complete baseline/journal/version, protects retained manual and risk stops, verifies every ledger and raw journal prefix, sends once, rejects concurrent saves and missing evidence, and keeps tokens out of backups.');
})().catch(e=>{console.error(e);process.exitCode=1;});
