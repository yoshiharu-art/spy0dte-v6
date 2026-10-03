'use strict';
// Authentication is inherited from request(); backups never contain the token.
let organizationBusy=false,organizationBackups=null;
function organizationControls(){
 el('connect').disabled=organizationBusy;
 el('token').disabled=organizationBusy;
 el('organizeAccounts').disabled=organizationBusy||!paperConnected||!paperToken||paperSnapshot?.accountOrganization?.persisted===true;
 el('organizationExport').disabled=organizationBusy||!organizationBackups||!paperConnected;
 el('start').disabled=organizationBusy||!paperConnected||paperSnapshot?.accountOrganization?.persisted!==true||!MAIN_ACCOUNT_IDS.includes(el('account').value)||selectedPositionProtected();
 el('pause').disabled=organizationBusy||!paperConnected;
 el('exit').disabled=organizationBusy||!paperConnected||selectedPositionProtected();
}
function clearOrganizationBackups(){
 organizationBackups=null;organizationBusy=false;organizationControls();
 el('organizationResult').textContent='管理用認証後に実行できます。口座整理と台帳照合は未確認です。';
}
function organizationEqual(a,b){
 const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
}
function organizationBaseline(document){
 const state=document?.state;
 if(!state||state.data_mode!=='LIVE'||!Number.isSafeInteger(state.revision)||!state.accounts)throw Error('保存済みの本番PAPER台帳を取得できません。整理は実行していません。');
 if(MAIN_ACCOUNT_IDS.some(id=>!state.accounts[id]))throw Error('通常版またはV66の既存口座が未登録です。口座を追加せず停止しました。');
 return state;
}
function organizationVerify(before,after,status){
 if(!organizationEqual(Object.keys(before.accounts).sort(),Object.keys(after.accounts||{}).sort()))throw Error('口座IDの照合が不一致です。');
 if(after.revision!==before.revision+1)throw Error('照合中に別の保存が進みました。現在の保存台帳で再照合が必要です。');
 const marker=after.account_organization;
 if(marker?.version!=='paper-account-organization-1'||status.accountOrganization?.persisted!==true||!organizationEqual(marker.main_accounts,MAIN_ACCOUNT_IDS))throw Error('整理設定の保存を確認できません。');
 if(status.autoTrade!==false||status.orderSubmissionEnabled!==false||status.mode!=='PAPER')throw Error('PAPER限定・実注文OFFを確認できません。');
 const fields=['trades','cash_cents','realized_cents','fees_cents','policy','config_hash','risk_halted','daily_halted','day_start_cents','equity_cents','high_water_cents','value_cents','unrealized_cents','max_drawdown_pct'];
 for(const [id,old] of Object.entries(before.accounts)){
  const current=after.accounts[id],main=MAIN_ACCOUNT_IDS.includes(id);
  for(const field of fields)if(!organizationEqual(old[field],current[field]))throw Error(id+' の履歴・残高・設定の照合が不一致です。');
  if(current.entries_enabled!==(main?old.entries_enabled:false))throw Error(id+' の新規購入停止が不一致です。');
  if(old.state==='IN_PENDING'&&!main){
   if(current.position!==null||current.unfilled!==old.unfilled+1||!current.entry_intent_cancellations?.some(row=>organizationEqual(row.intent,old.position)))throw Error(id+' の未約定購入の照合が不一致です。');
  }else if(!organizationEqual(old.position,current.position)||old.state!==current.state)throw Error(id+' の保有・未処理注文の照合が不一致です。');
  if(!organizationEqual(status.accounts?.[id]?.entries_enabled,current.entries_enabled)||!organizationEqual(status.accounts?.[id]?.account_management,current.account_management))throw Error(id+' の画面と保存台帳が一致しません。');
 }
 return {account_ids:Object.keys(after.accounts),main_accounts:MAIN_ACCOUNT_IDS.slice(),
  retired_entry_count:Object.keys(after.accounts).filter(id=>!MAIN_ACCOUNT_IDS.includes(id)).length,
  state_revision:after.revision,ledger_settings_positions:'MATCHED',existing_stops:'RETAINED',
  live_market_in_out:'UNVERIFIED',continuous_scheduled_saves:'UNVERIFIED'};
}
async function organizationJournal(end=null){
 const raw=[];let start=0,snapshot=end;
 for(;;){
  const page=await request('export?format=journal&raw=1&start='+start+(snapshot===null?'':'&end='+snapshot));
  if(!Array.isArray(page.raw_events)||!page.raw_events.every(row=>typeof row==='string')||!Number.isSafeInteger(page.snapshot_end)||page.snapshot_end<start||(snapshot!==null&&snapshot!==page.snapshot_end))throw Error('保存済みログの範囲を確認できません。');
  snapshot=page.snapshot_end;raw.push(...page.raw_events);
  if(page.next_start===null){if(start+page.raw_events.length!==snapshot)throw Error('保存済みログの末尾を確認できません。');return {snapshot_end:snapshot,raw_events:raw};}
  if(!Number.isSafeInteger(page.next_start)||page.next_start!==start+page.raw_events.length||page.next_start<=start)throw Error('保存済みログの順序を確認できません。');
  start=page.next_start;
 }
}
async function organizePaperAccounts(){
 if(organizationBusy||!paperConnected||!paperToken||paperSnapshot?.accountOrganization?.persisted===true)return;
 const session=paperToken;organizationBusy=true;organizationBackups=null;organizationControls();clearTimeout(paperTimer);
 let commandSent=false;
 try{
  el('organizationResult').textContent='整理前の全口座・全履歴・保存済みログを取得中…';
  const baseline=await request('export?format=json'),before=organizationBaseline(baseline);
  if(before.account_organization)throw Error('既に整理設定があります。再接続して現在の状態を確認してください。');
  const journal=await organizationJournal();
  organizationBackups={captured_at:new Date().toISOString(),before:baseline,before_journal:journal,verification:'PENDING'};
  const health=await request('health');
  if(health.accountOrganization?.version!=='paper-account-organization-1'||health.stateStorage?.lossless!==true||health.stateStorage?.atomicPublication!==true)throw Error('保存障害修正と口座整理APIの本番反映を確認できません。整理は実行していません。');
  el('organizationResult').textContent='既存口座の新規購入停止を保存中。保有分の出口管理と主比較の既存停止を保持します…';
  commandSent=true;
  const status=await request('command',{command:'consolidate',account_id:'ALL',request_id:crypto.randomUUID(),expected_revision:before.revision});
  organizationBackups.command_status=status;
  const afterDocument=await request('export?format=json');organizationBackups.after=afterDocument;
  const verification=organizationVerify(before,afterDocument.state,status);
  const prefix=await organizationJournal(journal.snapshot_end);
  organizationBackups.after_journal_prefix=prefix;
  if(!organizationEqual(journal,prefix))throw Error('整理前の保存済みログと整理後の先頭ログが一致しません。');
  const reread=await request('status');show(reread);
  if(reread.accountOrganization?.persisted!==true||Object.keys(afterDocument.state.accounts).some(id=>reread.accounts?.[id]?.entries_enabled!==afterDocument.state.accounts[id].entries_enabled))throw Error('再読込の口座状態と保存台帳が一致しません。');
  organizationBackups.verification={...verification,journal_prefix:'MATCHED',authenticated_status_reread:'MATCHED'};
  el('organizationResult').textContent='整理設定を保存し、全口座の履歴・残高・損益・既存の停止条件・保有・未処理注文と過去ログを照合しました。実相場のIN→OUTと定期保存の継続は未検証です。確認記録を保存できます。';
 }catch(error){
  if(error.stalePaperRequest||session!==paperToken)return;
  if(organizationBackups)organizationBackups.verification={status:'UNVERIFIED',command_sent:commandSent,message:error.message};
  el('organizationResult').textContent=(commandSent?'整理の保存または前後照合は未確認です。再接続で現在の状態を確認してください。自動で再送・初期化はしません。 ':'')+error.message;
 }finally{
  if(session===paperToken){organizationBusy=false;organizationControls();if(paperConnected)paperTimer=setTimeout(poll,60000);}
 }
}
el('organizeAccounts').addEventListener('click',organizePaperAccounts);
el('organizationExport').addEventListener('click',()=>{
 if(!organizationBackups||!paperConnected)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify(organizationBackups,null,2)],{type:'application/json'}));
 const anchor=document.createElement('a');anchor.href=url;anchor.download='paper-account-organization-verification.json';anchor.click();URL.revokeObjectURL(url);
});
el('connect').addEventListener('click',clearOrganizationBackups);
window.addEventListener('pagehide',clearOrganizationBackups);
organizationControls();
