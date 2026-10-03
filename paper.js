'use strict';
const PAPER_API='https://spy0dte-live-backend-v2.vercel.app/api/paper/';
let paperToken='',paperSnapshot=null,paperTimer=null,paperBusy=false,paperConnected=false,paperAuthRequired=false;
let paperConnecting=false,paperSession=0;
const el=id=>document.getElementById(id);
const usd=c=>typeof c!=='number'||!Number.isFinite(c)?'未取得':new Intl.NumberFormat('ja-JP',{style:'currency',currency:'USD'}).format(c/100);
const percent=n=>typeof n!=='number'||!Number.isFinite(n)?'未取得':(100*n).toFixed(1)+'%';
const when=s=>s?new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})+' JST':'未取得';
const duration=s=>s==null?'未確認':Math.max(0,s/60).toFixed(1)+'分';
const count=n=>Number.isSafeInteger(n)&&n>=0?String(n):'未記録';
const dollars=n=>typeof n!=='number'||!Number.isFinite(n)?'未取得':'$'+n.toFixed(2);
const strategyLabels={V64_BASELINE_1:'通常版',V64_TIME_1:'時間版',V65_TREND_RETEST_1:'追加インジ1（当日から計算）',V65_TREND_RETEST_2:'追加インジ2（厳格条件の比較用）',V65_BALANCED_3:'追加インジ3（バランス検証）',V66_CORE_TREND_1:'独立判定版V66'};
function accountLabel(key){const [strategy,kind]=String(key).split(':');return (strategyLabels[strategy]||strategy)+' · '+(kind||'条件未取得');}
const MAIN_ACCOUNT_IDS=['V64_BASELINE_1:STANDARD','V66_CORE_TREND_1:STANDARD'];
let paperViewedSecondaryAccount=null;
const winRate=m=>m?.trades===0?'未算出（決済なし）':m?.win_rate==null?'未取得':percent(m.win_rate);
const mixedConfiguration=report=>report?.configuration?.scope==='MIXED_OR_UNRECORDED_CONFIG_REFERENCE_ONLY';
function accountGroup(a,id=a?.account_id){return a?.account_management?.group||(MAIN_ACCOUNT_IDS.includes(id)?'MAIN':String(id).endsWith(':STRESS')?'AUXILIARY':'RETIRED');}
function accountHasWork(a){return !!a?.position||!!a?.pending_order||!!a?.pending_entry||!!a?.pending_exit||['IN_PENDING','OUT_PENDING'].includes(a?.state);}
function positionRecovery(a,s=paperSnapshot){
 const r=a?.position_recovery,p=a?.position,end=p?.inClock?.fillWindowEnd||r?.fill_window_end_at;
 const deadline=Date.parse(end),server=Date.parse(s?.server_time||a?.clock?.utc);
 // The original saved fill window is authoritative. Never use today's window
 // or the device clock to reopen an expired contract or invent an expiration.
 const expired=!!p&&(p.unresolved===true||(!!p.inAt&&Number.isFinite(deadline)&&Number.isFinite(server)&&server>=deadline));
 const resolved=!p&&r?.status==='RESOLVED_DURABLE_EXIT_VERIFIED'&&r.resolution_kind==='SAVED_PAPER_OUT'&&r.entry_protected===false;
 if(!expired&&!resolved&&!['EXPIRED_UNRECONCILED','RESOLVED_DURABLE_EXIT_VERIFIED'].includes(r?.status))return null;
 const saved=resolved&&Array.isArray(a?.history)?a.history.filter(t=>t.trade_id===r.trade_id):[];
 const debit=p?p.debit_cents:resolved?(saved.length===1?saved[0].debit_cents:null):r?.unsettled_debit_cents;
 return {status:resolved?'RESOLVED_DURABLE_EXIT_VERIFIED':'EXPIRED_UNRECONCILED',entry_protected:!resolved,
  trade_id:p?.trade_id||r?.trade_id,fill_window_end_at:end,unsettled_debit_cents:Number.isSafeInteger(debit)&&debit>0?debit:null,
  missing_evidence:resolved?[]:Array.isArray(r?.missing_evidence)&&r.missing_evidence.length?r.missing_evidence:['POSITION_RECOVERY_EVIDENCE_UNAVAILABLE'],
  next_actions:resolved?[]:Array.isArray(r?.next_actions)&&r.next_actions.length?r.next_actions:['VERIFY_COMPLETE_STATE_AND_JOURNAL','SUPPLY_DURABLE_COMPLETE_EXIT_RECORD'],
  last_reconciled_at:r?.last_reconciled_at,source:r?.status==='EXPIRED_UNRECONCILED'||resolved?'認証付きサーバーstatus':'保存済み保有・原約定期限による保護表示（照合証拠は未取得）'};
}
function selectedPositionProtected(){return positionRecovery(paperSnapshot?.accounts?.[el('account').value])?.entry_protected===true;}
const recoveryEvidence={DURABLE_EXIT_FILL_RECORD_MISSING:'原取引に対応する保存確認済みOUT約定記録が不足',DURABLE_OUT_REQUIRES_LEDGER_RECONCILIATION:'保存済みOUTと正式台帳の反映照合が未完了',STATE_JOURNAL_FILL_RECONCILIATION_MISMATCH:'stateとjournalのIN／OUT照合が不一致',POSITION_RECOVERY_EVIDENCE_UNAVAILABLE:'全state・全journalと復旧証拠の照合結果は未取得'};
const recoveryActions={VERIFY_COMPLETE_STATE_AND_JOURNAL:'原取引IDで現在の全state・全journalを照合',SUPPLY_DURABLE_COMPLETE_EXIT_RECORD:'原契約・売却時刻・価格・数量・費用・保存確認がそろったOUT記録を確認し、既存の照合経路で反映'};
function recoveryRows(r){
 return [['状態',r.entry_protected?'期限超過・照合待ち':'保存済みPAPER売却約定の照合済み'],['原取引ID',r.trade_id||'未取得'],['原契約の約定期限',when(r.fill_window_end_at)],
  [r.entry_protected?'未確定資金（原購入debit）':'原購入debit（履歴に保持）',usd(r.unsettled_debit_cents)],
  ['売却・清算・評価の区別',r.entry_protected?'売却約定・満期清算は未確定。保存値の推定評価と正式損益を区別':'保存済みPAPER OUTの証拠による照合。満期清算や推定価格による決済ではありません'],
  ['不足している証拠',r.entry_protected?r.missing_evidence.map(code=>recoveryEvidence[code]||'未取得（'+code+'）').join('／'):'保存済みOUTと正式台帳の一致を確認済み'],
  ['次の操作',r.entry_protected?r.next_actions.map(code=>recoveryActions[code]||'照合手順未取得（'+code+'）').join('／'):'保存済み履歴・残高を確認。手動停止・リスク停止・休止設定は別途保持'],
  ['購入・手動決済',r.entry_protected?'新規購入保護中。手動exitでは解消不可。期限切れ契約を通常売却へ戻しません':'期限超過照合による保護のみ解消。新規購入の停止設定は自動で解除しません'],
  ['照合日時',when(r.last_reconciled_at)],['最初に売却できなかった原因','未確定（この照合状態だけでは原因を証明できません）'],['表示の根拠',r.source]];
}
function showPositionRecoveries(s){
 const target=el('expiredPositions'),rows=Object.entries(s.accounts||{}).map(([id,a])=>({id,r:positionRecovery(a,s)})).filter(row=>row.r);
 target.replaceChildren();el('expiredPositionsPanel').hidden=rows.length===0;
 const pending=rows.filter(row=>row.r.entry_protected).length;
 el('expiredPositionsSummary').textContent='期限超過・照合待ち '+pending+'口座／保存済みOUT照合済み '+(rows.length-pending)+'口座。原購入額は口座別に保持し、合算しません。';
 for(const {id,r} of rows){const card=document.createElement('article'),title=document.createElement('h3'),list=document.createElement('dl'),button=document.createElement('button');card.className='accountSummary';title.textContent=accountLabel(id);lineList(list,recoveryRows(r));button.textContent='この口座の保有・履歴を見る';button.addEventListener('click',()=>selectPaperAccount(id));card.append(title,list,button);target.append(card);}
}
function accountEntryState(a,s=paperSnapshot){
 if(positionRecovery(a,s)?.entry_protected)return '新規購入保護中（期限超過の証拠照合待ち）';
 if(a?.risk_halted||a?.daily_halted)return 'リスク停止中（停止設定を保持）';
 if(a?.entries_enabled===true)return a.account_management?.entry_retired?'要確認：休止設定と新規購入許可が不一致':'新規購入判定の対象（時間・鮮度・リスク制限を適用）';
 return a?.entries_enabled===false?'新規購入停止中':'新規購入の許可状態は未取得';
}
function accountManagementRows(a,s=paperSnapshot){
 const m=a?.account_management,r=positionRecovery(a,s);
 return [['口座ID',a.account_id],['新規購入',accountEntryState(a,s)],['口座整理',m?(m.entry_retired?'新規購入を休止済み':'主比較として保持'):'未整理（保存された整理設定は未取得）'],['停止理由',m?.reason?reasonText(m.reason):a.entries_enabled===false?reasonText(a.last_reason):'停止の記録なし'],['累積・当日のリスク停止',a.risk_halted===true||a.daily_halted===true?'停止中':a.risk_halted===false&&a.daily_halted===false?'停止なし':'未取得'],['最終稼働日時',when(m?.last_active_at)],['新規購入の休止日時',when(m?.stopped_at)],['未処理注文の照合日時',when(m?.pending_reconciled_at)],['保有・処理待ち',r?.entry_protected?'期限超過・照合待ち／手動exitでは解消不可':r?'保存済みPAPER OUTを証拠で照合済み':accountHasWork(a)?(statusNames[a.state]||a.state||'確認中')+'／既存の出口管理を継続':'保有・処理待ちなし'],...(r?.entry_protected?[['未確定資金（原購入debit）',usd(r.unsettled_debit_cents)],['保存済み新規購入設定',a.entries_enabled===true?'許可設定を保持（照合保護が優先）':a.entries_enabled===false?'停止設定を保持':'未取得']]:[]),['整理設定の保存元',m?'認証付きサーバーstatus':'未取得']];
}
function selectPaperAccount(id){
 if(!paperSnapshot?.accounts?.[id])return;
 paperViewedSecondaryAccount=MAIN_ACCOUNT_IDS.includes(id)?null:id;syncAccounts(paperSnapshot.accounts);el('account').value=id;
 if(typeof el('account').dispatchEvent==='function')el('account').dispatchEvent(new Event('change'));else show(paperSnapshot);
}
function showAccountOrganization(s){
 const buckets={MAIN:el('mainAccounts'),RETIRED:el('retiredAccounts'),AUXILIARY:el('auxiliaryAccounts')};
 for(const target of Object.values(buckets))target.replaceChildren();
 for(const [id,a] of Object.entries(s.accounts||{})){
  const group=accountGroup(a,id),target=buckets[group]||buckets.RETIRED,card=document.createElement('article'),title=document.createElement('h3'),list=document.createElement('dl'),button=document.createElement('button');
  card.className='accountSummary';title.textContent=accountLabel(id);lineList(list,accountManagementRows({...a,account_id:id},s));button.textContent='この口座の状態・履歴を見る';button.addEventListener('click',()=>selectPaperAccount(id));card.append(title,list,button);target.append(card);
 }
 for(const id of MAIN_ACCOUNT_IDS)if(!s.accounts?.[id]){const p=document.createElement('p');p.className='warning';p.textContent=accountLabel(id)+'：既存口座を未取得。新しい口座は追加していません。';buckets.MAIN.append(p);}
 for(const [group,panel] of [['RETIRED','retiredAccountsPanel'],['AUXILIARY','auxiliaryAccountsPanel']]){
  const rows=Object.entries(s.accounts||{}).filter(([id,a])=>accountGroup(a,id)===group),pending=rows.filter(([,a])=>accountHasWork(a)).length,expired=rows.filter(([,a])=>positionRecovery(a,s)?.entry_protected).length;
  if(pending>0||expired>0)el(panel).open=true;el(group==='RETIRED'?'retiredAccountsCount':'auxiliaryAccountsCount').textContent=rows.length+'口座'+(pending?'／保有・処理待ち '+pending+'口座':'')+(expired?'／期限超過・照合待ち '+expired+'口座':pending?'（既存の出口管理を継続）':'');
 }
 const organization=s.accountOrganization;
 el('organizationStatus').textContent=organization?.persisted===true?'認証付きサーバーの保存済み整理設定を表示／整理日時 '+when(organization.activated_at):'未整理：認証付きの現在の口座状態を表示。整理設定の保存は未確認です。';
}
let paperDiagnostics=null;
let tradePreflightBusy=false;
let tradeAccountChoices=[];
const statusNames={FLAT:'見送り',IN_PENDING:'仮想IN待ち',OPEN:'保有継続',OUT_PENDING:'決済待ち',CLOSED:'決済済み'};
const reasons={OUTSIDE_MARKET_HOURS:'市場時間外のため取得・新規購入を休止',TIME_ENTRY_LOCK:'新規購入の時間外（保有管理は継続）',MARKET_CALENDAR_UNAVAILABLE:'取引カレンダーの確認待ち',ENTRY_STOPPED:'新規IN停止中',LOSS_LIMIT:'損失上限に到達',REALTIME_UNVERIFIED:'リアルタイム権限・遅延を確認できません',HALT_STATUS_UNVERIFIED:'市場停止状態を確認できません',CONTRACT_METADATA_MISSING:'契約ID・倍率が未取得',STALE_QUOTE:'気配が古いため待機',STALE_RECEIPT:'受信データが古いため待機',OUTSIDE_FILL_WINDOW:'市場時間外',DATA_MODE_MISMATCH:'有効な実相場データがありません',DATA_UNAVAILABLE:'相場データ未取得',FIXED_CONTRACT_MISMATCH:'保有契約と気配が一致しません',ASK_SIZE_MISSING_OR_EMPTY:'売り板数量が未取得または不足',BID_SIZE_MISSING_OR_EMPTY:'買い板数量が未取得または不足',CAPITAL_LIMIT:'仮想資金の購入上限超過',FORCE_EXIT:'強制終了時刻',HARD_STOP:'損失率上限',THESIS_BREAK:'売買根拠の崩れ',PROFIT_TRAIL:'RUNNER利益保護',OPPOSITE_SIGNAL:'反対方向シグナル',NO_PROGRESS:'伸びず勢いも低下',TIME_DECAY:'保有時間・勢い・利益条件',NO_VALID_FILL_BEFORE_CLOSE:'取引終了まで決済できず未解決',MANUAL_EXIT:'利用者の仮想決済要求',TIME_SCORE_OR_SPREAD:'残り時間に対するスコア・スプレッド条件未達',SIGNAL_ACCEPTED:'購入候補を受付。新しい気配を待っています',NOT_STARTED:'仮想売買は未開始'};
Object.assign(reasons,{ACCOUNT_CONSOLIDATION:'主比較を通常版・独立判定版V66に整理したため新規購入を休止',AUXILIARY_ENTRIES_STOPPED:'STRESSは補助検証として保持し、新規購入を休止',EXISTING_ENTRY_STOP:'整理前からの新規購入停止を保持'});
async function request(path,body){
 const requestToken=paperToken,session=paperSession;
 const current=()=>{if(requestToken!==paperToken||session!==paperSession)throw Object.assign(Error('接続が切り替わったため以前の応答を破棄しました。'),{stalePaperRequest:true});};
 const options={cache:'no-store',headers:{Authorization:'Bearer '+requestToken},signal:AbortSignal.timeout(55000)};
 if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
 let r,data;
 try{r=await fetch(PAPER_API+path,options);}catch(e){current();throw paperConnectionError(e);}
 current();
 if(r.status===401){showAuthRequired();throw Error('管理用認証が必要です。再接続してください。');}
 if(r.status===403)throw Error('アクセスが拒否されました。管理用認証の権限を確認してください。');
 try{data=await r.json();}catch(e){current();if(e.name==='TimeoutError'||e.name==='AbortError')throw paperConnectionError(e);throw Error('サーバー応答を読み取れず、残高・成績を確認できません。');}
 current();
 if(!data||typeof data!=='object'||Array.isArray(data))throw Error('サーバー応答の形式が不正なため、残高・成績を確認できません。');
 if(!r.ok||data?.ok===false)throw Error(r.status===409?'別の判定処理中です。時間をおいて再接続してください。':data?.error==='PAPER_STORE_UNAVAILABLE'?'保存先に接続できないため、残高・成績を取得できません。保存先の復旧後に再接続してください。':data?.error==='PAPER_REQUEST_OR_STATE_INVALID'?'開始設定・保存許諾・口座状態を確認してください':'仮想売買API未接続または処理失敗');
 return data;
}
function paperConnectionError(error){
 return Error(error?.name==='TimeoutError'||error?.name==='AbortError'?'通信が時間切れになり、残高・成績を確認できません。通信状態を確認して再接続してください。':'サーバーと通信できず、残高・成績を確認できません。通信状態を確認して再接続してください。');
}
function showPaperUnavailable(message,authRequired=false){
 paperAuthRequired=authRequired;paperConnected=false;clearTimeout(paperTimer);if(authRequired)paperToken='';
 paperSnapshot=null;paperDiagnostics=null;exitStudySnapshot=null;exitStudyAccount=null;exitStudyV2Snapshot=null;exitStudyV2Account=null;
 for(const id of ['operations','position','positionRecoveryStatus','expiredPositions','dataQuality','comparison','groups','exitStudy','exitStudyV2','mainAccounts','retiredAccounts','auxiliaryAccounts','accountLifecycle'])el(id).replaceChildren();
 el('expiredPositionsPanel').hidden=true;el('positionRecoveryStatus').hidden=true;el('expiredPositionsSummary').textContent='照合状態は未取得です。';
 el('retiredAccountsPanel').open=false;el('auxiliaryAccountsPanel').open=false;
 el('organizationStatus').textContent='口座整理の保存状態は未取得です。';el('retiredAccountsCount').textContent='未取得';el('auxiliaryAccountsCount').textContent='未取得';
 paperViewedSecondaryAccount=null;el('account').replaceChildren();
 for(const id of ['equity','cash','daily','realized','unrealized','fees','dd','uptime'])el(id).textContent='--';
 const unknown={runtime:'管理用認証が必要：PAPER状態は未確認',runtimeDetail:'実注文OFF / 認証付きの稼働状態・口座記録を取得できません。',
  dataMode:'認証付きPAPER状態は未取得',decision:'PAPER状態未確認',reason:'購入・保有・履歴は未確認です。管理用認証で再接続してください。',
  updated:'最終実行 未確認',qualityAt:'判定記録は未確認です。',contract:'保有状態は未確認です。',stats:'取引件数・損益は未確認です。',
  history:'取引履歴は未確認です。',diagnostics:'見送り理由は未確認です。',decisionAnalysis:'購入判断の記録は未確認です。',
  indicatorAnalysis:'追加インジの判定記録は未確認です。',entryFunnel:'観測・購入指示・約定の件数は未確認です。',executionQuality:'約定の記録は未確認です。',unresolved:'未解決の保有状態は未確認です。',
  exitReview:'決済記録は未確認です。',exitStudyStatus:'Exit比較は未確認です。',exitStudyV2Status:'Exit比較2は未確認です。',config:'口座設定は未確認です。'};
 if(!authRequired){unknown.runtime='取得失敗：PAPER状態は未確認';unknown.runtimeDetail=message;unknown.reason=message;}
 for(const [id,text] of Object.entries(unknown))el(id).textContent=text;
 for(const id of ['start','pause','exit','json','csv','journal','review','diagnose','exitStudyLoad','exitStudyExport','exitStudyV2Load','exitStudyV2Export','tradePreflight'])el(id).disabled=true;
 showTradeAccountChoices([]);el('tradePreflightResult').textContent='';el('tradePreflightStatus').textContent=message;
 if(typeof clearPerformanceReport==='function')clearPerformanceReport(authRequired?'管理用認証が必要：期間別の成績は未確認です。':message);
 if(typeof clearOrganizationBackups==='function')clearOrganizationBackups();
 if(typeof organizationControls==='function')organizationControls();
}
function showAuthRequired(){showPaperUnavailable('管理用認証が必要です。再接続してください。',true);}
function lineList(target,rows){target.replaceChildren();for(const [k,v] of rows){const a=document.createElement('dt'),b=document.createElement('dd');a.textContent=k;b.textContent=v;target.append(a,b);}}
function show(s){
 paperSnapshot=s;syncAccounts(s.accounts);const a=s.accounts[el('account').value];if(!a)throw Error('仮想口座が見つかりません');
 const recovery=positionRecovery(a,s);
 showAccountOrganization(s);showPositionRecoveries(s);lineList(el('accountLifecycle'),accountManagementRows(a,s));
 el('positionRecoveryStatus').hidden=!recovery;lineList(el('positionRecoveryStatus'),recovery?recoveryRows(recovery):[]);
 const op=s.operations||{};const runtimeNames={SCHEDULED_WAIT:'次回の定期実行待ち',STARTING:'定期実行の開始待ち',WAITING:'サーバー起動待ち',STOPPED:'停止：実行記録が届いていません',DELAYED:'遅延：実行間隔が開いています',NEEDS_ATTENTION:'要対応：実行エラー',MARKET_CLOSED:'市場時間外',PAUSED:'新規IN停止中・保有なし',RUNNING:'サーバーの実行を受信中'};
 el('news').textContent=s.newsLabel;el('runtime').textContent=runtimeNames[op.status]||'稼働状態の確認待ち';
 el('runtimeDetail').textContent='実注文OFF / 自動PAPERの目標間隔 '+s.evaluation_seconds+'秒 / スマホ終了後の継続検証：'+(s.unattendedVerified?'確認済み':'未完了');
 lineList(el('operations'),[['最終処理成功',when(op.last_execution_success_at)],['最終相場受信',when(op.last_market_received_at)],['最終保存成功の記録時刻',when(op.last_save_at)],['実測の直近間隔',op.last_interval_seconds==null?'未測定':op.last_interval_seconds.toFixed(1)+'秒'],['観測範囲の最大間隔',op.max_interval_seconds==null?'未測定':op.max_interval_seconds.toFixed(1)+'秒'],['累計取得失敗回数',op.total_failures??'未取得'],['状態・停止理由',({NEXT_SCHEDULED_RUN:'予定どおりの休止',LAST_SCHEDULED_RUN_MISSING:'最後の予定実行を確認できません',POSITION_REMAINS_OUTSIDE_SCHEDULE:'実行時間外に未決済の保有があります',OUTSIDE_MARKET_HOURS:'市場時間外',EXTERNAL_RUN_RECEIVED:'定期実行を受信'})[op.reason]||op.reason||'未確認'],['次の予定実行',when(op.schedule?.next_expected_at)]]);
 el('dataMode').textContent=s.data_mode==='LIVE'?'実相場を使うPAPER口座（気配の有効性は各判定で確認）':'テストデータ専用';
 el('decision').textContent=recovery?.entry_protected?'期限超過・照合待ち':statusNames[a.state]||a.state;el('reason').textContent=recovery?.entry_protected?'原契約の通常売却処理は終了しています。保存済み証拠と台帳の照合待ちです。新規購入保護中、手動exitでは解消不可。':(!a.position&&a.clock?.marketOpen===false)?'市場時間外。新しい価格の取得と購入判定を休止しています。':reasonText(a.last_reason);
 const q=a.last_data_quality; const inactive=q?.observationExpected===false||(a.clock?.marketOpen===false&&!a.position);
 el('qualityAt').textContent=inactive?'取得対象外の時間です。時刻未取得を通信障害として扱いません。':q?'判定時点の記録：'+when(q.checkedAt)+'（現在の気配ではありません）':'次のサーバー判定後に表示します。';
 const qualityNames={MISSING_SOURCE_TIME:'時刻未取得',INVALID_SOURCE_TIME:'時刻不正',FUTURE_SOURCE_TIME:'未来時刻',STALE_SOURCE_TIME:'古いデータ',FRESH:'鮮度条件内',NOT_REQUIRED:'指標OFF'};
 lineList(el('dataQuality'),inactive?[]:q?[['リアルタイム資格',q.realtimeState==='VERIFIED'?'確認済み':'未確認'],['取引停止状態',q.haltState==='NOT_HALTED'?'停止なし確認済み':q.haltState==='HALTED'?'取引停止中':'未確認'],...Object.values(q.fields||{}).map(f=>[f.label,(qualityNames[f.status]||f.status)+(f.ageSeconds==null?'':' / '+Number(f.ageSeconds).toFixed(1)+'秒前・上限'+f.maxAgeSeconds+'秒')])]:[]);
 el('updated').textContent='最終実行 '+when(s.last_run)+' / 実行遅延 '+(op.status==='SCHEDULED_WAIT'?'予定休止中':s.execution_lag_seconds==null?'未確認':Number(s.execution_lag_seconds).toFixed(1)+'秒');
 for(const [id,key] of Object.entries({equity:'equity_cents',cash:'cash_cents',daily:'day_pnl_cents',realized:'realized_cents',unrealized:'unrealized_cents',fees:'fees_cents'}))el(id).textContent=usd(a[key]);
 el('dd').textContent=typeof a.max_drawdown_pct==='number'?a.max_drawdown_pct.toFixed(2)+'%':'未取得';el('uptime').textContent=percent(s.observed_uptime);
 const p=a.position;el('contract').textContent=p?p.contract.optionSymbol+' / '+p.contract.expiration+' / '+p.contract.side+' / Strike '+p.contract.strike:'現在の保有なし';
 lineList(el('position'),p?[['仮想IN価格',p.inPrice==null?'IN待ち':'$'+p.inPrice.toFixed(4)],recovery?.entry_protected?['保存値の推定評価（売却約定ではない）',typeof p.markPrice==='number'&&Number.isFinite(p.markPrice)?'$'+p.markPrice.toFixed(4):'未取得']:['現在の決済評価',p.markFresh?'$'+p.markPrice.toFixed(4):'有効気配なし（リスク評価0）'],['IN時刻',when(p.inAt)],['保有時間',duration(a.clock.holdingSec)],...(recovery?.entry_protected?[['原契約の約定期限',when(recovery.fill_window_end_at)]]:[['契約の最終取引まで',duration(a.clock.contractRemainingSec)],['戦略の強制OUTまで',duration(a.clock.forceRemainingSec)]]),['観測した最大含み益',p.mfe_pct==null?'--':p.mfe_pct.toFixed(1)+'%'],['観測した最大含み損',p.mae_pct==null?'--':p.mae_pct.toFixed(1)+'%']]:[]);
 el('comparison').replaceChildren();for(const id of MAIN_ACCOUNT_IDS){const b=s.accounts[id];if(!b)continue;const tr=document.createElement('tr'),m=b.report.summary,mixed=mixedConfiguration(b.report),check='設定別で確認';for(const v of [accountLabel(id)+(b.report.configuration?'':'（設定範囲未確認）'),count(m.trades),mixed?check:winRate(m),mixed?check:dollars(m.net),dollars(m.fees),mixed?check:dollars(m.average_profit),mixed?check:dollars(m.average_loss),typeof b.max_drawdown_pct==='number'?b.max_drawdown_pct.toFixed(2)+'%':'未取得',count(b.unresolved_count)]){const td=document.createElement('td');td.textContent=v;tr.append(td);}el('comparison').append(tr);}
 showEntryFunnel(a.entry_funnel);
 showDecisionAnalysis(a.last_decision_analysis);
 showIndicatorAnalysis(a.last_indicator_analysis,s.indicatorComparison?.historyReadiness,a.clock?.marketOpen,a.core_entry_sampling||a.indicator_sampling);
 if(!recovery?.entry_protected&&a.state==='FLAT'&&a.clock?.marketOpen===false)el('decision').textContent='市場時間外・予定休止';
 if(!recovery?.entry_protected&&a.state==='FLAT'&&a.clock?.marketOpen&&a.last_indicator_analysis?.decisionClass==='SESSION_WARMUP')el('decision').textContent='寄付き後の形状確認待ち';
 if(!recovery?.entry_protected&&a.state==='FLAT'&&a.entries_enabled&&a.clock?.marketOpen&&['SYSTEM_NOT_READY','DATA_ERROR'].includes(a.last_indicator_analysis?.decisionClass))el('decision').textContent=a.last_indicator_analysis.decisionClass==='DATA_ERROR'?'データ異常':'SYSTEM NOT READY：データ準備不足';
 const eq=a.report.execution_quality;
 const seconds=v=>v==null?'未記録':Number(v).toFixed(1)+'秒';
 const delay=(label,d)=>label+'：平均 '+seconds(d?.mean_seconds)+' / 中央値 '+seconds(d?.p50_seconds)+' / 95%点 '+seconds(d?.p95_seconds)+' / 最大 '+seconds(d?.max_seconds)+'（実測 '+count(d?.samples)+'件）';
 el('executionQuality').textContent=eq?delay('仮想INの判定→約定',eq.entry)+' / '+delay('仮想OUTの判定→約定',eq.exit)+' / 保有中の観測最大間隔 '+seconds(eq.max_observation_gap_seconds)+'。観測間の値動きは不明です。':'約定までの実測時間：記録待ち';
 const m=a.report.summary,mixed=mixedConfiguration(a.report),configuration=a.report.configuration;
 el('stats').textContent=mixed?'固定設定が混在、または未記録の取引があります。勝率・純損益・平均利益・平均損失・PFは設定別で確認してください。 / 決済 '+count(m.trades)+'件 / 累計決済費用 '+dollars(m.fees)+' / 記録済み設定 '+((configuration.recorded_hashes||[]).join(', ')||'なし')+' / 固定設定未記録 '+count(configuration.unrecorded_trades)+'件':(configuration?'':'固定設定の比較範囲は未確認（旧応答） / ')+m.status+' / '+m.trading_days+'取引日 / 決済 '+count(m.trades)+'件 / 勝率 '+winRate(m)+' / 費用込み純損益 '+dollars(m.net)+' / 決済費用 '+dollars(m.fees)+' / 平均純損益 '+dollars(m.average_net)+' / 平均利益 '+dollars(m.average_profit)+' / 平均損失 '+dollars(m.average_loss)+' / PF '+(m.profit_factor==null?(m.profit_factor_status==='NO_LOSSES'?'損失なし（未定義）':'未算出（記録不足）'):m.profit_factor.toFixed(2))+' / 最大連敗 '+m.max_losing_streak+' / 稼働中のデータ不足率 '+percent(a.report.missing_rate)+'（新集計 '+count(a.report.quality_observations)+'回）'+' / 未約定率 '+percent(a.report.unfilled_rate);
 const groupRecords=mixed?{config_hash:a.report.groups.config_hash||{}}:a.report.groups;
 el('groups').replaceChildren();for(const [kind,buckets] of Object.entries(groupRecords)){const h=document.createElement('h3');h.textContent=({config_hash:'固定設定のハッシュ',time_band:'時間帯',remaining:'残り時間',holding:'保有時間',side:'CALL / PUT',out_reason:'OUT理由',strategy:'戦略版',day:'日次',week:'週次',decision_version:'購入判定の版',entry_code:'購入時のコード版',price_support:'価格条件の一致数',vol_support:'ボラティリティ条件の一致数',indicator_version:'追加インジの戦略版'})[kind]||kind;el('groups').append(h);for(const [name,v] of Object.entries(buckets)){const row=document.createElement('p');row.textContent=name==='UNRECORDED_CONFIG'?'固定設定未記録：'+count(v.trades)+'件。成績評価は設定を特定してから確認します。':name+'：'+v.trades+'件 / $'+v.net.toFixed(2)+' / '+v.status;el('groups').append(row);}}
 el('unresolved').textContent='未解決 '+count(a.report.unresolved_count)+'件 / 全損＋決済費用の保守推定 '+dollars(a.report.unresolved_conservative_loss_usd)+'。推定評価は売却約定・満期清算・確定損益ではありません。'+(recovery?.entry_protected?' 未確定資金（原購入debit） '+usd(recovery.unsettled_debit_cents)+'を保持し、証拠の照合まで未決済のまま残します。':' 正式損益とは分けて表示します。');
 el('history').replaceChildren();for(const t of [...a.history].reverse()){const div=document.createElement('div');div.className='trade';div.textContent=t.contract.side+' '+t.contract.strike+' / 純損益 '+usd(t.net_cents)+' / 費用 '+usd(t.fees_cents)+' / '+reasonText(t.outReason)+'\n'+when(t.inAt)+' → '+when(t.outAt)+' / 仮想約定 / 購入理由 '+entryBasisText(t.entryIndicators?.entryBasis)+' / 保存確認 '+(t.persisted_at?when(t.persisted_at):'個別約定の保存時刻は未記録');el('history').append(div);}if(!a.history.length)el('history').textContent='決済履歴はまだありません';
 el('entryWindow').textContent='新規購入は通常取引終了の60分前で停止。約定期限内の保有分は既存の売却判断を継続します。期限超過分は通常売却へ戻さず、証拠の照合待ちとして保護します。'+(a.clock?.entryEndsAt?' 当日の購入締切：'+when(a.clock.entryEndsAt):'');
 el('config').textContent=JSON.stringify({現在の新規購入制限:s.entry_constraints,記録開始時の固定戦略設定:a.policy,ニュース判定方針:s.newsDecisionPolicy,予定イベント判定:a.last_paper_news_risk,設定注記:'新規購入は固定戦略より厳しい60分前の制限を適用。過去の設定・残高・履歴は保持。',コード:s.code_commit,データ区分:s.data_mode,ニュース:s.newsMode,費用:'未確認・仮定値',自動最適化:'無効',事後EXIT比較:'EXIT_PLUS5M_V1：保存済み気配のみ・正式損益と分離'},null,2);
 showDiagnostics();
 for(const id of ['start','pause','exit','json','csv','journal','review','diagnose','exitStudyLoad','exitStudyV2Load'])el(id).disabled=false;
 el('start').disabled=s.accountOrganization?.persisted!==true||!MAIN_ACCOUNT_IDS.includes(el('account').value)||recovery?.entry_protected===true;
 el('exit').disabled=recovery?.entry_protected===true;
 el('tradePreflight').disabled=tradePreflightBusy;
 if(typeof syncPerformanceAccounts==='function')syncPerformanceAccounts(s);
 if(typeof organizationControls==='function')organizationControls();
}
async function refresh(){
 const s=await request('status');show(s);
 const h=s.indicatorComparison?.historyReadiness;
 // Only the explicit admin maintenance route can fill history. It never ticks
 // the PAPER engine; the server enforces RTH guards and the shared retry clock.
 if(h?.missingDates?.length&&s.indicatorComparison?.registeredAccounts?.length&&
    !(typeof organizationBusy!=='undefined'&&organizationBusy)&&
    !Object.values(s.accounts||{}).some(a=>a.clock?.marketOpen)&&
    (!h.recovery?.nextAttemptAt||Date.parse(h.recovery.nextAttemptAt)<=Date.now())){
  try{show(await request('indicator-history-recovery',{}));}
  catch(e){if(e.stalePaperRequest)throw e;el('message').textContent='履歴の自動補完：'+e.message+'。次回更新で再確認します。';return false;}
 }
 return true;
}
async function poll(){if(!paperConnected||paperBusy||(typeof organizationBusy!=='undefined'&&organizationBusy))return;const requestToken=paperToken,session=paperSession;paperBusy=true;try{await refresh();}catch(e){if(e.stalePaperRequest)return;el('message').textContent=e.message;if(!paperAuthRequired)showPaperUnavailable(e.message);}finally{paperBusy=false;if(paperConnected&&requestToken===paperToken&&session===paperSession)paperTimer=setTimeout(poll,60000);}}
async function command(c){
 if(typeof organizationBusy!=='undefined'&&organizationBusy){el('message').textContent='口座整理と前後照合の完了後に操作できます。';return;}
 const selected=el('account').value;
 if(['start','exit'].includes(c)&&selectedPositionProtected()){el('message').textContent='期限超過・照合待ちのため新規購入を保護しています。手動exitでは解消できません。原取引と保存済みOUT証拠を既存の照合経路で確認してください。';return;}
 if(c==='start'&&(paperSnapshot?.accountOrganization?.persisted!==true||!MAIN_ACCOUNT_IDS.includes(selected))){el('message').textContent='保存済みの口座整理を確認してから、選択中の主比較口座を開始できます。';return;}
 try{show(await request('command',{command:c,account_id:c==='exit'||c==='start'?selected:'ALL',request_id:crypto.randomUUID()}));el('message').textContent=c==='start'?'選択口座の開始設定を保存しました。実際の稼働はサーバー実行の記録で確認してください。':'操作を保存しました。次のサーバー実行で保有管理を続けます。';}catch(e){if(e.stalePaperRequest)return;el('message').textContent=e.message;}
}
async function journalDownload(){
  const raw=[];let start=0,end=null;
  while(true){
    const data=await request('export?format=journal&raw=1&start='+start+(end===null?'':'&end='+end));
    if(!Array.isArray(data.raw_events)||!Number.isSafeInteger(data.snapshot_end)||data.snapshot_end<start||
       (end!==null&&data.snapshot_end!==end))throw new Error('判定ログの完全性を確認できません。バックエンドの更新を確認してください。');
    end=data.snapshot_end;
    const stop=start+data.raw_events.length;
    if(data.raw_events.some(x=>typeof x!=='string')||stop>end||
       (data.next_start===null?stop!==end:!Number.isSafeInteger(data.next_start)||data.next_start!==stop||stop<=start||stop>=end)){
      throw new Error('判定ログのページが欠損しています。再取得してください。');
    }
    // Keep server-stored numeric literals: JSON.parse/stringify breaks event hashes.
    raw.push(...data.raw_events);
    if(data.next_start===null)break;
    start=data.next_start;
  }
  return {filename:'paper-journal.json',content:'{"filename":"paper-journal.json","snapshot_end":'+end+',"events":['+raw.join(',')+']}'};
}
async function download(format){
  try{
    const data=format==='journal'?await journalDownload():await request('export?format='+format);
    const content=format==='csv'||format==='journal'?data.content:JSON.stringify(data,null,2);
    const b=new Blob([content],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'});
    const url=URL.createObjectURL(b),a=document.createElement('a');
    a.href=url;a.download=data.filename;a.click();URL.revokeObjectURL(url);
  }catch(e){if(e.stalePaperRequest)return;el('message').textContent=e.message;}
}
el('connect').addEventListener('click',async()=>{
 if(paperConnecting||(typeof organizationBusy!=='undefined'&&organizationBusy))return;
 paperConnecting=true;const session=++paperSession;
 paperToken=el('token').value||paperToken;el('token').value='';
 const loading='管理用認証と保存済み口座を確認中…';
 showPaperUnavailable(loading);el('runtime').textContent=loading;el('message').textContent=loading;
 el('connect').disabled=true;el('token').disabled=true;
 try{
  const ready=await refresh();if(session!==paperSession||paperAuthRequired||!paperSnapshot)return;paperConnected=true;
  if(typeof syncPerformanceAccounts==='function')syncPerformanceAccounts(paperSnapshot);
  if(typeof clearPerformanceReport==='function')clearPerformanceReport('保存済み口座を取得しました。「保存記録で成績を更新」で期間別の成績を確認できます。');
  paperTimer=setTimeout(poll,60000);
  if(ready)el('message').textContent='保存済みの状態を読み込みました。画面の閲覧では売買判定を起動しません。';
  el('tradePreflightStatus').textContent='接続診断を実行できます。';
 }catch(e){
  if(e.stalePaperRequest||session!==paperSession)return;
  if(!paperAuthRequired)showPaperUnavailable(e.message);
  el('message').textContent=e.message;
 }finally{
  if(session===paperSession){paperConnecting=false;el('connect').disabled=false;el('token').disabled=false;if(typeof organizationControls==='function')organizationControls();}
 }
});
async function reviewExits(){
 try{const data=await request('exit-review');const target=el('exitReview');target.replaceChildren();
 const note=document.createElement('p');note.textContent='EXIT_PLUS5M_V1 / 検証不足 / 読取 '+data.coverage.journal_events_read+'ログ / 対象外の古い決済 '+data.trades_omitted+'件'+(data.coverage.older_events_may_be_omitted?' / 古い観測は読取範囲外の可能性あり':'');target.append(note);
 const names={WAITING:'観測時刻の到来待ち',MISSING_OBSERVATION:'観測不足',OUTSIDE_SESSION:'取引時間外',CONFIG_MISMATCH:'設定不一致',OBSERVED_RETROSPECTIVE:'事後試算（約定ではありません）'};
 for(const row of data.rows){const p=document.createElement('p');p.textContent=row.account_id+' / '+row.trade_id+' / '+(names[row.status]||row.status)+' / 正式 '+usd(row.official_net_cents)+' / 5分後試算 '+usd(row.hypothetical_net_cents)+' / 差 '+usd(row.difference_cents)+' / 観測 '+when(row.observed_at);target.append(p);}
 if(!data.rows.length){const p=document.createElement('p');p.textContent='比較対象の決済履歴はまだありません';target.append(p);}
 }catch(e){if(e.stalePaperRequest)return;el('exitReview').textContent=e.message;}
}
el('review').addEventListener('click',reviewExits);
el('account').addEventListener('change',()=>{if(MAIN_ACCOUNT_IDS.includes(el('account').value))paperViewedSecondaryAccount=null;if(paperSnapshot)show(paperSnapshot);});
for(const [id,c] of [['start','start'],['pause','pause'],['exit','exit']])el(id).addEventListener('click',()=>command(c));
for(const id of ['json','csv','journal'])el(id).addEventListener('click',()=>download(id));
window.addEventListener('pagehide',()=>{paperSession++;paperConnecting=false;paperConnected=false;clearTimeout(paperTimer);paperToken='';});
fetch(PAPER_API+'health',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(s=>{if(paperSnapshot||paperToken||paperAuthRequired)return;el('runtime').textContent='公開ヘルスを確認済み・PAPER状態は未確認';el('runtimeDetail').textContent=s.adminConfigured?'稼働状態・残高・取引件数は管理用認証後に確認できます。':'管理認証のサーバー設定が必要です。口座の稼働状態は未確認です。';}).catch(()=>{if(paperSnapshot||paperToken||paperAuthRequired)return;el('runtime').textContent='公開ヘルスを取得できません・PAPER状態は未確認';el('runtimeDetail').textContent='バックエンドの公開状態と管理用認証を確認してください。';});

function showDiagnostics(){
 const target=el('diagnostics');if(!paperDiagnostics)return;
 target.replaceChildren();const d=paperDiagnostics,account=d.accounts?.[el('account').value];
 const note=document.createElement('p');note.textContent='集計期間 '+when(d.coverage.start_at)+' ～ '+when(d.coverage.end_at)+' / '+d.coverage.events_read+'ログ'+(d.coverage.older_events_may_be_omitted?'（古い記録は集計範囲外の可能性あり）':'');target.append(note);
 if(!account){const p=document.createElement('p');p.textContent='対象の判定記録がまだありません';target.append(p);return;}
 const latest=account.latest_recorded_commit,whole=account.observed_window;
 const p=document.createElement('p');p.textContent='直近の記録版：判定 '+latest.decisions+'回 / 見送り '+latest.skips+'回。時間外・開始前は除外しています。';target.append(p);
 const counts=Object.entries(latest.reasons||{});for(const [reason,count] of counts){const row=document.createElement('p');row.textContent=reasonText(reason)+'：'+count+'回';target.append(row);}
 const h=document.createElement('h3');h.textContent='同時に不足していたデータ（重複あり）';target.append(h);
 const labels={spyPriceAt:'SPY最終約定',spyQuoteAt:'SPY気配',optionQuoteAt:'オプション気配',barAt:'1分足',volPriceAt:'VIXY最終約定'};
 const barReasons={MINUTE_GAP_OR_DUPLICATE:'1分足の欠落・重複',SESSION_START_MISSING:'寄付きからの足が不足',INVALID_OHLCV:'足の価格・出来高が不正',ZERO_SESSION_VOLUME:'当日出来高がゼロ',INSUFFICIENT_MINUTE_BARS:'1分足の本数不足',INVALID:'1分足が不正'};
 const states={STALE_SOURCE_TIME:'古い',MISSING_SOURCE_TIME:'時刻なし',FUTURE_SOURCE_TIME:'未来時刻',INVALID_SOURCE_TIME:'時刻不正'};
 for(const [code,count] of Object.entries(latest.data_blockers||{})){const [field,state]=code.split(':');const row=document.createElement('p');row.textContent=(field==='BARS'?(barReasons[state]||'1分足：'+state):labels[field]?labels[field]+'：'+(states[state]||state):reasons[code]||code)+' / '+count+'回';target.append(row);}
 const timing=latest.acquisition_timing;if(timing?.samples){const row=document.createElement('p');row.textContent='取得処理時間：平均 '+Number(timing.mean_ms).toFixed(0)+'ms / 最大 '+Number(timing.max_ms).toFixed(0)+'ms / '+timing.samples+'回。元データの古さとは別の測定です。';target.append(row);}
 const tail=document.createElement('p');tail.textContent='記録範囲全体：対象 '+whole.decisions+'回 / データ条件未達 '+percent(whole.data_blocked_rate)+'。各口座の件数は合算しません。';target.append(tail);
}
el('diagnose').addEventListener('click',async()=>{const button=el('diagnose');button.disabled=true;el('diagnostics').textContent='保存済みログを集計中…';try{paperDiagnostics=await request('diagnostics');showDiagnostics();}catch(e){if(e.stalePaperRequest)return;el('diagnostics').textContent=e.message;}finally{button.disabled=!paperConnected;}});

function showDecisionAnalysis(a){
 const target=el('decisionAnalysis');target.replaceChildren();
 const row=text=>{const p=document.createElement('p');p.textContent=text;target.append(p);};
 if(!a){row('この版での判定記録はまだありません');return;}
 row('判定時点 '+when(a.observedAt)+'（現在の気配ではありません）');
 row(a.priceSupport==null?'判断材料：データ不足':(a.side||'--')+'への一致：価格 '+a.priceSupport+'/4 / ボラティリティ '+(a.volatilitySupport==null?'未確認':a.volatilitySupport+'/1'));
 row('20分の一方向への進み具合：'+(a.efficiency20m==null?'観測不足':(a.efficiency20m*100).toFixed(1)+'%（低い値は往復・横ばい）'));
 if(!a.costs?.length){row('費用回収価格：この判定時点では有効な気配なし');return;}
 for(const c of a.costs)row((c.case==='STRESS'?'不利な費用条件':'通常の費用条件')+'・1枚：購入総額 '+usd(c.entryDebitCents)+' / 同じ気配で売却 '+usd(c.unchangedQuoteNetCents)+' / 損益ゼロに必要な売却Bid $'+Number(c.breakEvenBid).toFixed(4)+' / 片道費用 '+usd(c.feePerSideCents)+'・滑り $'+Number(c.slippagePerSide).toFixed(2));
}

function showEntryFunnel(f){
 const target=el('entryFunnel');target.replaceChildren();
 const row=text=>{const p=document.createElement('p');p.textContent=text;target.append(p);};
 if(!f){row('観測・購入指示・約定の新集計は未記録です。過去の件数をゼロとして補完しません。');return;}
 const rate=(numerator,denominator)=>Number.isSafeInteger(numerator)&&numerator>=0&&Number.isSafeInteger(denominator)&&denominator>0?percent(numerator/denominator):'未算出';
 row('集計版 '+(f.version||'未記録')+' / 対象営業日 '+(f.market_date||'未記録')+' / 開始 '+when(f.observed_since)+'。この開始時刻より前の取引とは合算しません。');
 row('購入可能時間・保有なしの1分観測 '+count(f.eligible_observations)+'回 / 有効データ '+count(f.valid_data_observations)+'回（分母：対象観測 '+count(f.eligible_observations)+'回、'+rate(f.valid_data_observations,f.eligible_observations)+'） / 保有なし・有効データ '+count(f.valid_flat_observations)+'回');
 row('購入指示 '+count(f.signals)+'件（分母：保有なし・有効データ '+count(f.valid_flat_observations)+'回、'+rate(f.signals,f.valid_flat_observations)+'） / PAPER購入約定 '+count(f.fills)+'件（分母：購入指示 '+count(f.signals)+'件、'+rate(f.fills,f.signals)+'） / 未約定終了 '+count(f.unfilled)+'件（同じ分母、'+rate(f.unfilled,f.signals)+'）');
 row('重複を除いた5分足×方向の候補 '+count(f.unique_5m_direction_opportunities)+'枠。同じ価格の反復観測、購入指示、約定、決済取引は別の件数です。');
 const names={SYSTEM_NOT_READY:'データ準備不足',DATA_ERROR:'データ・取得異常',SESSION_WARMUP:'必要な当日形状の準備待ち',NO_TRADE:'相場条件未達',SIGNAL_READY:'購入条件通過',RISK_LIMIT:'資金・損失制限',STRATEGY_REJECTION:'相場・戦略条件未達'};
 for(const [kind,n] of Object.entries(f.categories||{}))row((names[kind]||kind)+'：'+count(n)+'回');
 for(const [reason,n] of Object.entries(f.reasons||{}))row('見送り理由 '+reasonText(reason)+'：'+count(n)+'回');
}

function entryBasisText(value){
 return ({BASELINE_BUY_PLUS_CORE_TREND_AND_COST_RISK:'通常版80点BUY＋主要トレンド・値幅・費用込み試算',CLOSED_5M_CORE_TREND_AND_COST_RISK:'確定5分足の主要トレンド・値幅・費用込み試算から独立判定'})[value]||value||'旧記録：書き出しで条件の版を確認';
}

async function runTradePreflight(){
 if(!paperConnected||!paperToken||tradePreflightBusy)return;
 const button=el('tradePreflight'),status=el('tradePreflightStatus'),result=el('tradePreflightResult'),token=paperToken;
 const selectedType=el('tradeAccountType').value;
 if(tradeAccountChoices.length>1&&!selectedType){status.textContent='確認する口座を上の欄から選んでください。';return;}
 tradePreflightBusy=true;button.disabled=true;status.textContent='Webull口座の読み取り接続を診断中…';result.textContent='';
 el('tradeAccountType').disabled=true;
 try{
  const suffix=selectedType?'?account_type='+encodeURIComponent(selectedType):'';
  const response=await fetch(PAPER_API+'trade-preflight'+suffix,{method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(55000)});
  if(token!==paperToken||!paperConnected)return;
  if(!response.ok){
   let errorCode='';try{errorCode=(await response.json())?.error;}catch{}
   if(token!==paperToken||!paperConnected)return;
   status.textContent=response.status===401?'管理用認証が切れています。再接続してください。':errorCode==='TRADE_PREFLIGHT_COOLDOWN'?'診断の間隔を空ける必要があります。前回の診断から60秒たってから、もう一度押してください。':'診断を取得できませんでした（HTTP '+response.status+'）。';return;
  }
  const data=await response.json();
  if(token!==paperToken||!paperConnected)return;
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_DIAGNOSTIC');
  result.textContent=JSON.stringify(data,null,2);
  showTradeAccountChoices(data.accountChoices,selectedType);
  const blockers=Array.isArray(data.blockers)?data.blockers:[];
  if(blockers.includes('ACCOUNT_SELECTION_REQUIRED'))status.textContent='口座一覧への接続に成功しました。上の欄で確認する口座を選び、もう一度「口座接続を診断」を押してください。';
  else if(blockers.includes('ACCOUNT_SELECTION_AMBIGUOUS'))status.textContent='同じ種類の口座が複数あるため、特定できません。口座を確認してから設定が必要です。';
  else if(blockers.includes('ACCOUNT_TYPE_NOT_FOUND')||blockers.includes('CONFIGURED_ACCOUNT_TYPE_MISMATCH'))status.textContent='選んだ種類と確認できる口座が一致しません。口座の選択を確認してください。';
  else if(data.balancePositionsOrdersValidated===true)status.textContent='選択した口座の残高・保有・未約定注文の読み取り確認に成功しました。実注文の可否は未確認です。';
  else status.textContent='診断結果を受信しました。一部の確認が完了していません。「診断の詳細」で理由を確認できます。実注文の可否は未確認です。';
 }catch{
  if(token===paperToken&&paperConnected)status.textContent='診断結果を取得できませんでした。通信状態を確認し、必要なら再実行してください。';
 }finally{tradePreflightBusy=false;button.disabled=!paperConnected;el('tradeAccountType').disabled=!paperConnected||!tradeAccountChoices.length;}
}
el('tradePreflight').addEventListener('click',runTradePreflight);

function showTradeAccountChoices(rows,selectedType=''){
 const select=el('tradeAccountType');select.replaceChildren();
 tradeAccountChoices=Array.isArray(rows)?rows.filter(r=>r&&/^[A-Z_]{1,32}$/.test(r.accountType)&&Number.isInteger(r.count)&&r.count>0&&r.count<=20):[];
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=tradeAccountChoices.length?'確認する口座を選んでください':'診断を押すと口座の種類を取得します';select.append(placeholder);
 const labels={CASH:'現物口座（CASH）',MARGIN:'信用口座（MARGIN）'};
 for(const row of tradeAccountChoices){const option=document.createElement('option');option.value=row.accountType;option.textContent=(labels[row.accountType]||row.accountType)+' / '+row.count+'口座'+(row.count>1?'（同種の口座が複数あるため選択できません）':'');option.disabled=row.count!==1;select.append(option);}
 if(tradeAccountChoices.some(r=>r.accountType===selectedType&&r.count===1))select.value=selectedType;
 select.disabled=!paperConnected||tradePreflightBusy||!tradeAccountChoices.length;
}
el('connect').addEventListener('click',()=>showTradeAccountChoices([]));


function syncAccounts(accounts){
 const select=el('account'),selected=select.value;
 const keys=Object.keys(accounts||{}),main=MAIN_ACCOUNT_IDS.filter(id=>keys.includes(id));
 const extra=paperViewedSecondaryAccount&&keys.includes(paperViewedSecondaryAccount)?paperViewedSecondaryAccount:null;
 const choices=main.length?[...main,...(extra&&!main.includes(extra)?[extra]:[])]:keys;
 const known=Array.from(select.options).map(o=>o.value);
 if(known.length===choices.length&&known.every((k,i)=>k===choices[i])){if(!choices.includes(selected))select.value=choices[0]||'';return;}
 select.replaceChildren();
 for(const key of choices){const option=document.createElement('option');option.value=key;option.textContent=accountLabel(key)+(MAIN_ACCOUNT_IDS.includes(key)?'':'（状態・過去履歴を確認中）');select.append(option);}
 select.value=choices.includes(selected)?selected:choices[0]||'';
}
function reasonText(value){
 const parts=String(value||'').replace(/^INDICATOR: /,'');
 if(parts.includes(' / ')||parts.includes(', '))return parts.split(/ \/ |, /).map(reasonText).join(' / ');
 const observedNames={CONFIRMED_STAGE50_FLOOR:'段階的保護水準に到達し、異なる確定足で根拠悪化を確認',CONFIRMED_NO_PROGRESS:'15分伸びず、異なる確定足で根拠悪化を確認',CONFIRMED_THESIS_BREAK:'異なる確定足で売買根拠の崩れを確認',UNRECORDED:'理由が未記録',POSITION_ALREADY_OPEN:'保有中のため新規購入判定から除外',ENTRY_INTENT_PENDING:'購入指示の約定待ちのため新規購入判定から除外',MANAGEMENT_ONLY:'保有管理のみの実行',BAR_TIME_MISSING:'確定足の時刻が未取得',BAR_STALE:'確定足が鮮度上限を超過',SPYPRICEAT_MISSING:'SPY価格の元時刻が未取得',SPYQUOTEAT_MISSING:'SPY気配の元時刻が未取得',OPTIONQUOTEAT_MISSING:'オプション気配の元時刻が未取得',RECEIVEDAT_MISSING:'気配の受信時刻が未取得',SPYPRICEAT_STALE:'SPY価格が判定時点の鮮度上限を超過',SPYQUOTEAT_STALE:'SPY気配が判定時点の鮮度上限を超過',OPTIONQUOTEAT_STALE:'オプション気配が判定時点の鮮度上限を超過',RECEIVEDAT_STALE:'受信から判断までに鮮度上限を超過',MARKET_DATA_UNAVAILABLE:'相場データの取得に失敗',API_429:'提供元の取得頻度制限',WEBULL_AUTH_FAILED:'提供元の認証に失敗',WEBULL_AUTH_BUSY:'提供元の認証処理中',MARKET_REFRESH_WAIT:'相場データの更新処理待ち',MARKET_COORDINATOR_UNAVAILABLE:'相場取得の調整処理が未接続',BACKOFF:'取得失敗後の再試行待ち',UNCLASSIFIED_REJECTION:'見送り区分を特定できません',SCHEDULED_EVENT_LOCK:'予定イベントのため新規購入停止',SCHEDULED_EVENT_WATCH:'予定イベント前後の警戒時間'};
 if(observedNames[parts])return observedNames[parts];
 const executionNames={CORE_DIRECTION_CONTRACT_UNAVAILABLE:'独立版が選んだ方向の実際の契約候補が未取得',CORE_CANDIDATES_UNAVAILABLE:'CALL・PUTの実際の契約候補がどちらも未取得',BUY_READY:'購入条件を充足（約定とは別）',API_ERROR:'相場APIの取得・接続異常',MARKET_CLOSED:'市場時間外',CALENDAR_UNVERIFIED:'取引カレンダーが未確認',ENTRY_TIME_EXPIRED:'市場終了60分前を過ぎたため新規購入停止',ENTRY_TIME_LOCK:'新規購入の時間外',CONTRACT_DATA_ERROR:'0DTE契約の情報が不足・不一致',NO_LIQUID_CONTRACT:'有効な気配・板数量・契約条件が不足',TRADABILITY_UNVERIFIED:'取引可能状態が未確認',SPY_PRICE_STALE:'SPY最終約定が判定時点の鮮度上限を超過',SPY_QUOTE_STALE:'SPY気配が判定時点の鮮度上限を超過',PRICE_DATA_MISSING:'SPY価格が未取得',SPREAD_TOO_WIDE:'売買価格差が条件上限を超過',BAR_DATA_MISSING:'購入判断に必要な確定足が不足',VOL_DATA_MISSING:'ボラティリティ指標が未取得・古い',OPEN_DATA_MISSING:'当日の始値が未取得',DATA_BLOCK:'購入判断に必要なデータが不足',VALID_NO_EDGE:'データ正常・相場条件未達',DIRECTION_SCORE_BELOW_80:'通常版の方向スコアが80点未満',DIRECTION_CHANGED:'購入方向と取得した契約の方向が不一致',DELTA_UNAVAILABLE:'デルタが未取得',DELTA_INVALID:'デルタの値・方向が不正',DELTA_OUTSIDE_POLICY:'時間帯ごとのデルタ条件未達',LOTTERY_PRICE:'オプション価格が購入下限未満',VWAP_CHASE_LIMIT:'VWAPからの乖離が追いかけ上限を超過',VWAP_DATA_MISSING:'VWAPが未取得',BAR_DATA_MISSING_OR_STALE:'購入判断に必要な足が不足・古い',INDICATORS_UNAVAILABLE:'トレンド指標が未準備'};
 if(executionNames[parts])return executionNames[parts];
 if(String(value||'').replace(/^INDICATOR: /,'')==='OPTION_QUOTE_STALE')return 'オプション気配が判定時点の鮮度上限を超えたため待機';
 if(String(value||'').replace(/^INDICATOR: /,'')==='OPTION_BASE_REWARD_INSUFFICIENT')return '通常の費用込み試算で利益幅が損失幅に届きません';
 if(String(value||'').replace(/^INDICATOR: /,'')==='SETUP_WINDOW_WARMUP')return '寄付き後45分の節目・押し戻り形状を確認中';
 if(String(value||'').replace(/^INDICATOR: /,'')==='TREND_SEED_UNAVAILABLE')return 'EMA・ATRの準備に必要な前営業日の確定足が不足';
 if(String(value||'').includes('PREVIOUS_SESSION_LEVELS_UNAVAILABLE'))return String(value).replace('PREVIOUS_SESSION_LEVELS_UNAVAILABLE','前営業日の高値・安値が未取得');
 const names={RVOL_HISTORY_WARMUP:'同じ時間帯の出来高履歴を準備中',EMA_ATR_WARMUP:'確定した5分足を蓄積中',TREND_NOT_ALIGNED:'方向・傾きの一致待ち',ATR_CHASE_LIMIT:'直近の値幅に対して上昇・下落を追いかけすぎ',BREAKOUT_RETEST_NOT_CONFIRMED:'節目突破後の押し戻り・再開を確認できません',BREAKOUT_VOLUME_TOO_LOW:'節目突破時の出来高条件未達',STRUCTURE_RISK_OUTSIDE_ATR_BAND:'撤退地点までの値幅が条件外',INSUFFICIENT_PRICE_REWARD_RISK:'目標までの値幅に対して損失幅が大きい',OPTION_SCENARIOS_UNAVAILABLE:'オプション価格の試算ができません',OPTION_COST_TIME_IV_REWARD_INSUFFICIENT:'時間減価・IV低下・費用を含む試算が条件未達',STRUCTURE_BREAK:'追加版の撤退価格に到達',ATR_TRAIL:'ATRに応じた利益保護',MAX_HOLD:'追加版の保有時間上限',SETUP_ALREADY_TRADED:'同じ節目突破では取引済み',NO_PROGRESS:'保有後に必要な値動きが出ていません',CLOSED_BARS_STALE:'確定した足が古いため待機',SESSION_OPEN_MISSING:'寄付きからの足が不足',CORE_DIRECTION_UNAVAILABLE:'主要トレンドからCALL・PUTの方向が決まりません',CORE_DIRECTION_AMBIGUOUS:'CALL・PUTの方向条件が競合しています',DIRECTION_OR_SPOT_UNAVAILABLE:'方向またはSPY価格が未取得',OPTION_CONTRACT_UNAVAILABLE:'判定方向のオプション契約候補が未取得',CONTRACT_SIDE_MISMATCH:'購入方向と契約のCALL・PUTが一致しません',ENTRY_CANCELLED_OR_EXPIRED:'購入候補の条件消失・停止・待機期限切れ',PROCESSING_DELAY_OR_NO_NEW_QUOTE:'処理待機中、または判断後の新しい気配が未取得',VIRTUAL_FILL_ASK_PLUS_SLIP:'有効なAskと仮定の滑りでPAPER購入約定',INDICATOR_PASS:'追加条件を充足',NO_BASELINE_BUY:'通常版の購入条件未達',NO_CLOSED_BARS:'確定した足が未取得',RVOL_HISTORY_FETCH_FAILED:'出来高履歴の取得に失敗',TREND_SEED_FETCH_FAILED:'EMA・ATR用の前営業日履歴の取得に失敗'};
 const key=String(value||'').replace(/^INDICATOR: /,'');return names[key]||reasons[value]||value||'記録待ち';
}
function showIndicatorAnalysis(a,history,marketOpen,sampling){
 const target=el('indicatorAnalysis');target.replaceChildren();
 const row=text=>{const p=document.createElement('p');p.textContent=text;target.append(p);};
 const num=n=>n==null?'未取得':Number(n).toFixed(3);
 const independent=a?.strategy==='V66_CORE_TREND_1';
 if(sampling){
  row('検証データ '+sampling.session+'：判定 '+count(sampling.observations)+'回'+(independent?'':' / 確定5分足×方向 '+count(sampling.unique5mWindows)+'枠'));
  if(independent){
   row('参考の基準版BUY '+count(sampling.baselineBuyObservations)+'回 / 独立条件通過 '+count(sampling.independentBuyObservations)+'回・重複を除く '+count(sampling.uniqueBuyWindows)+'枠（約定件数ではありません）');
   row('通常版がBUYにしなかった追加候補 '+count(sampling.additionalBuyObservations)+'回。実際の約定・決済損益は別の件数で確認します。');
   row('通常版80点BUYは比較用に記録します。独立版の購入条件には重ねません。');
  }else row('基準版BUY '+sampling.baselineBuyObservations+'回 / 基準版と追加条件の同時通過 '+sampling.combinedSignalObservations+'回・重複を除く '+sampling.uniqueCombinedSignalWindows+'枠（約定件数ではありません）');
  row('見送りも保存します。同じ相場を繰り返し観測した回数を、独立した取引件数として扱いません。');
  const names={coreTrend:'VWAP・EMAの方向',trendSupport:'傾きの補助確認',chase:'ATRの追いかけ制限',priceRewardRisk:'SPYの利益損失幅',baseOptionRewardRisk:'通常の費用込み試算',retest:'押し戻り確認',breakoutVolume:'突破時の出来高',allFiveTrend:'従来の方向5条件',ivStressRewardRisk:'IV低下の厳格試算'};
  for(const kind of ['requiredChecks','studyChecks'])for(const [key,c] of Object.entries(sampling[kind]||{}))row((kind==='requiredChecks'?'必須：':'比較用：')+(names[key]||key)+' / 通過 '+c.passCount+'・未達 '+c.failCount+'・未評価 '+c.unavailableCount);
 }
 if(history){
  const recovery=history.recovery||{},prev=history.previousDay||{};
  row('保存履歴の最新状態：'+(history.comparisonReadiness==='READY'?'利用可能':'SYSTEM NOT READY')+' / 対象営業日 '+(history.targetSession||'未確認'));
  row('RVOL比較用の完全な営業日 '+(history.completedHistoricalSessions??'未確認')+'日 / 必要 '+(history.requiredSamples??5)+'日 / 最も少ない時間帯 '+(history.minimumSlotSamples??'未確認')+'日');
  row('不足営業日：'+((history.requiredMissingDates||[]).join(', ')||'なし')+' / 補充状態 '+(recovery.status||'未実行'));
  row('前営業日 '+(prev.date||'未確認')+' / 高値 '+num(prev.high)+' / 安値 '+num(prev.low));
  row('履歴取得の最終成功 '+when(recovery.lastSuccessAt)+' / 次回試行 '+when(recovery.nextAttemptAt));
  if(recovery.lastError)row('取得失敗：'+recovery.lastError+' / '+(recovery.errorKind==='CONFIGURATION'?'接続・設定の確認が必要':'一時障害または取得データ不足'));
 }
 if(marketOpen===false){
  row('現在は市場時間外・予定休止です。追加インジの準備不足や相場条件による見送りとは区別します。');
  if(!a?.features?.barCloseAt){row('市場中の判定記録は次の定期実行後に表示します。');return;}
  row('以下は保存済みの市場中の判定です（現在の売買シグナルではありません）。');
 }
 if(!a){row('選択中の口座には追加版の判定記録がありません。口座欄に追加インジ版があれば選択してください。');return;}
 if(a.strategy==='V65_BALANCED_3')row('バランス検証版：基準版80点以上＋主要トレンド・値幅・通常の費用込み試算が必須。押し戻り、出来高、IV低下試算は比較用に記録します。撤退幅はATR1倍。収益性は未検証です。');
 if(independent)row('独立トレンド版1：VWAP・EMAからCALL・PUTの方向を選び、追いかけ制限・利益損失幅・通常の費用込み試算を確認。基準版の80点BUYとは独立したPAPER口座です。既存版と資金・履歴を分けて比較し、収益性は未検証です。');
 if(a.entryBasis)row('購入判定の根拠：'+entryBasisText(a.entryBasis));
 const f=a.features||{},r=a.studyLabels?.matched?.rvol||f.breakoutRvol||{};
 if(a.decisionClass)row('追加インジの判定区分：'+(({SESSION_WARMUP:'寄付き後の形状確認待ち（予定された待機）',SYSTEM_NOT_READY:'SYSTEM NOT READY：データ準備不足',DATA_ERROR:'DATA ERROR：計算・入力エラー',NO_TRADE:'NO TRADE：データ正常・相場条件未達',SIGNAL_READY:'追加条件を充足'})[a.decisionClass]||a.decisionClass));
 if(f.warmupUntil)row('形状を判定できる最短時刻 '+when(f.warmupUntil)+'。データ・売買条件の通過は別途必要です。');
 if(f.trendSeed)row('EMA・ATRの準備：前営業日 '+f.trendSeed.date+' の確定5分足 '+f.trendSeed.bars+'本を使用。VWAP・寄り付き高安・押し戻りは当日のみ。');
 row('判定時点 '+when(a.observedAt)+' / '+(a.status==='PASS'?(independent?'独立版の購入条件を充足（約定とは別）':'追加条件を充足（約定とは別）'):(a.reasons||[]).map(reasonText).join(' / ')));
 row('確定5分足 '+(f.closed5mCount??0)+'本 / 最終足の確定 '+when(f.barCloseAt));
 row('VWAP '+num(f.vwap)+' / EMA9 '+num(f.ema9)+' / EMA21 '+num(f.ema21)+' / ATR14 '+num(f.atr14));
 row((a.strategy==='V65_BALANCED_3'&&!a.studyLabels?.matched?'参考5分足の相対出来高 ':'節目突破時の相対出来高 ')+(r.value==null?'未準備':num(r.value)+'倍')+' / 比較履歴 '+(r.samples??'未確認')+'営業日・必要 '+(r.requiredSamples??5)+'営業日 / 米東部 '+(r.slotET||'未確認')+' の同一5分枠');
 row('寄り後15分の高値 '+num(f.openingHigh)+' / 安値 '+num(f.openingLow)+' / 前日高安 '+(f.previousDay?.status==='READY'?num(f.previousDay.high)+' / '+num(f.previousDay.low):'完全な前日データなし'));
 if(a.plan)row('SPYの撤退価格 '+num(a.plan.invalidation)+' / 比較用の目標 '+num(a.plan.target)+' / 値幅の利益損失比 '+num(a.plan.priceRewardRisk));
 const scenarioNames={TARGET:'目標到達',TARGET_IV_DOWN:'目標到達・IV低下',STOP:'撤退価格到達',FLAT:'横ばい'};
 for(const c of a.scenarios?.cases||[])row((scenarioNames[c.name]||c.name)+' / '+c.holdMinutes+'分後 / 費用込み試算 '+usd(c.netCents));
 if(a.scenarios)row('試算は価格予測・期待利益ではありません。IV、将来の売買価格差、約定条件は実相場で確認します。');
}

let exitStudySnapshot=null,exitStudyAccount=null,exitStudyV2Snapshot=null,exitStudyV2Account=null;
function showExitStudy(data,suffix='',view={}){
 const root=view.root||el('exitStudy'+suffix);root.replaceChildren();
 const number=v=>v==null?'--':Number(v).toFixed(2);
 const dollars=v=>v==null?'--':'$'+Number(v).toFixed(2);
 const paragraph=text=>{const p=document.createElement('p');p.textContent=text;root.append(p);};
 const table=(headers,rows)=>{const wrap=document.createElement('div');wrap.className='tableWrap';const t=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody'),hr=document.createElement('tr');for(const h of headers){const th=document.createElement('th');th.textContent=h;hr.append(th);}head.append(hr);for(const row of rows){const tr=document.createElement('tr');for(const v of row){const td=document.createElement('td');td.textContent=v;tr.append(td);}body.append(tr);}t.append(head,body);wrap.append(t);root.append(wrap);};
 (view.status||el('exitStudy'+suffix+'Status')).textContent='検証不足 / 記録中 '+(data.active?.length??0)+'件 / 全口座の追跡完了 '+(data.completed_total??0)+'件 / 記録エラー '+(data.errors??0)+'件。自動採用はしません。';
 if(suffix==='V2')paragraph((data.spec?.version||'EXIT_STUDY_2')+' / 固定条件ハッシュ '+(data.study_hash||'未記録')+'。旧Exit比較と別の観測・成績です。');
 if(suffix==='V2'&&data.period)paragraph('購入日（米東部・両端を含む） '+(data.period.from_date||'記録開始')+' ～ '+(data.period.to_date||'最新')+' / 購入日不明で除外 '+count(data.period.unknown_date_excluded)+'件 / 保存範囲 '+(data.history_scope==='RECENT_COMPLETED_CHECKPOINT'?'直近の保存済み完了記録':data.history_scope==='PROVIDED_ROWS'?'読み込んだ記録':'未記録'));
 if(suffix==='V2'&&data.portfolio_scope==='UNAVAILABLE_FOR_FILTERED_PERIOD')paragraph('期間・固定設定を限定した比較では、口座全体の試算を混ぜません。');
 if(!Object.keys(data.groups||{}).length)paragraph('比較できる完了取引はまだありません。');
 for(const [group,g] of Object.entries(data.groups||{})){
  paragraph(group.split('|')[0]+' / 同一条件の完全観測 '+g.paired_complete+'件 / 観測不足 '+g.partial+'件');
  table(['Exit案','件数','勝率','平均利益','平均損失','PF','期待値','実現損益DD','平均保有','MFE回収率','+50→損失','早すぎたExit',suffix==='V2'?'費用込み純損益':'+50決済との差'],Object.entries(g.candidates||{}).map(([k,m])=>[k+' '+m.label,m.samples,percent(m.win_rate),dollars(m.average_profit),dollars(m.average_loss),number(m.profit_factor),dollars(m.expectancy),dollars(m.max_realized_drawdown_usd),duration(m.average_hold_seconds),percent(m.mfe_capture_ratio),m.reached50_then_loss,m.early_exit_then_additional25pp,dollars(suffix==='V2'?m.net:m.delta_vs_plus50_exit_usd)]));
  paragraph('上表は同じ取引群だけの比較です。実現損益DDは口座全体のDDではありません。MFE回収率は費用後確定損益÷費用前の最大含み益。');
  if(suffix==='V2'){
   if(g.cohort)paragraph('固定設定 '+(g.cohort.config_hash||'未記録')+' / データ '+(g.cohort.data_mode||'未記録')+' / 購入コード '+(g.cohort.entry_code_commit||'未記録')+'。固定設定・費用条件・保存版が同じ取引だけを比較します。');
   for(const [key,m] of Object.entries(g.candidates||{}))showExitOutcomeEvidence(root,key+' '+m.label,m.exit_outcomes,'完全観測の同じ購入から比較');
   const partial=document.createElement('details'),summary=document.createElement('summary');summary.textContent='候補ごとの観測済み決済（観測不足を含む・完全比較とは別）';partial.append(summary);root.append(partial);
   for(const [key,m] of Object.entries(g.observed_only||{}))showExitOutcomeEvidence(partial,key,m.exit_outcomes,'候補個別の観測済み決済・経路の欠落を含む');
  }
 }
 for(const [group,book] of Object.entries(data.portfolios||{})){
  paragraph(group.split('|')[0]+' / 1枚運用の口座試算（現行版のIN機会のみ）');
  table(['Exit案','決済','勝率','平均利益','平均損失','PF','期待値','保守最大DD','観測最大DD','重複見送り','資金・損失制限','気配欠損'],Object.entries(book).map(([k,m])=>[k,m.trades,percent(m.win_rate),dollars(m.average_profit),dollars(m.average_loss),number(m.profit_factor),dollars(m.expectancy),number(m.max_drawdown_pct)+'%',number(m.observed_max_drawdown_pct)+'%',m.skipped_overlap,m.skipped_risk,m.missing_marks]));
 }
 for(const text of data.limitations||[])paragraph(text);
 const details=document.createElement('details'),title=document.createElement('summary');title.textContent='各取引の到達時刻・押し戻し・SPY構造・候補OUTを確認';details.append(title);
 const pre=document.createElement('pre');pre.textContent=JSON.stringify({記録中:data.active||[],完了:data.rows||[]},null,2);details.append(pre);root.append(details);
}
function showExitOutcomeEvidence(target,label,m,scope){
 const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=label+'：損切り・利益の押し戻し・欠落証拠';details.append(summary);target.append(details);
 const p=text=>{const row=document.createElement('p');row.textContent=text;details.append(row);};
 if(!m){p('この候補の新しい決済診断は未記録です。');return;}
 const value=n=>typeof n==='number'&&Number.isFinite(n),usdValue=n=>value(n)?'$'+n.toFixed(2):'未算出',pctValue=n=>value(n)?n.toFixed(1)+'%':'未記録',pp=n=>value(n)?n.toFixed(1)+'ポイント':'未記録',fraction=n=>value(n)?(n*100).toFixed(1)+'%':'未算出';
 const reach=m.hard_stop_reached||{},hard=m.hard_stop_reason||{},path=m.mfe_mae||{},fifty=m.reached50_then_net_loss||{},giveback=m.giveback||{},past=m.past_hard_stop||{};
 p(scope+' / 決済 '+count(m.filled_samples)+'件 / 純損益既知 '+count(m.net_known)+'件・欠落 '+count(m.net_unknown)+'件');
 const list=document.createElement('dl');lineList(list,[['損切り水準到達率（観測MAE）',fraction(reach.fraction)+' / 到達 '+count(reach.count)+'件・分母 '+count(reach.assessed_samples)+'件 / MAE不明 '+count(reach.unknown_mae)+'件・固定損切り条件不明 '+count(reach.unknown_policy)+'件'],['HARD_STOP理由による決済率',fraction(m.hard_stop_rate)+' / '+count(m.hard_stop_count)+'件・分母：決済理由既知 '+count(m.reason_known)+'件 / 理由欠落 '+count(m.reason_unknown)+'件'],['平均損失',usdValue(m.mean_loss_usd)+' / 分母：純損失 '+count(m.loss_samples)+'件'],['HARD_STOP決済の平均純損益',usdValue(hard.mean_net_usd)+' / 分母：損益既知 '+count(hard.net_known)+'件・欠落 '+count(hard.net_unknown)+'件'],['HARD_STOP決済の平均純損失',usdValue(hard.mean_loss_usd)+' / 分母：純損失 '+count(hard.loss_samples)+'件'],['最大含み益（候補保有中）','平均 '+pctValue(path.mean_mfe_pct)+' / 最大 '+pctValue(path.max_mfe_pct)+' / 記録 '+count(path.mfe_known)+'件・欠落 '+count(path.mfe_unknown)+'件'],['最大含み損（候補保有中）','平均 '+pctValue(path.mean_mae_pct)+' / 最小 '+pctValue(path.min_mae_pct)+' / 記録 '+count(path.mae_known)+'件・欠落 '+count(path.mae_unknown)+'件'],['+50%到達後に費用込み損失',count(fifty.count)+'件 / '+fraction(fifty.fraction)+' / 分母：+50到達・純損益既知 '+count(fifty.net_known)+'件 / 到達 '+count(fifty.reached50_samples)+'件・純損益欠落 '+count(fifty.net_unknown)+'件'],['利益ピークからの押し戻し','平均 '+pp(giveback.mean_pp)+' / 最大 '+pp(giveback.max_pp)+' / 分母：MFEと決済価格既知 '+count(giveback.samples)+'件'],['損切り条件より悪い決済価格',count(past.price_below_count)+'件 / 分母：価格・条件既知 '+count(past.price_assessment_known)+'件'],['損切り条件より悪い費用込み損益',count(past.net_below_count)+'件 / 分母：純損益・条件既知 '+count(past.net_assessment_known)+'件']]);details.append(list);
 p('MFE・MAEは各候補の保有中に観測できた価格経路です。観測間の値動きや、売却後に取れたはずの利益を補完しません。押し戻しは最大含み益率と決済時の費用前損益率の差です。');
 const names={QUOTE_GAP_IN_EXIT_PATH:'決済までの観測に気配欠損・大きい間隔',DELAYED_FILL_OBSERVED:'判断から約定までの時間経過を記録',FEES_CROSSED_THRESHOLD:'費用の控除で損益が損切り条件を超過',SLIPPAGE_CROSSED_THRESHOLD:'気配と仮定の約定価格の差で損切り条件を超過'};
 for(const [code,n] of Object.entries(past.cause_observations||{}))p((names[code]||code)+'：'+count(n)+'件');
 p('損切り条件を超えた取引の要因未確認 '+count(past.unknown_cause_count)+'件 / 条件自体が未記録 '+count(past.threshold_unknown)+'件。上の観測状況は重複し、損失への因果関係の証明ではありません。');
 const reasons=document.createElement('dl');lineList(reasons,Object.entries(m.exit_reasons||{}).map(([reason,r])=>[reasonText(reason),count(r.count)+'件 / 既知部分の純損益 '+usdValue(r.net_usd)+' / 純損益既知 '+count(r.net_known)+'件・欠落 '+count(r.net_unknown)+'件']));details.append(reasons);
}
el('exitStudyLoad').addEventListener('click',async()=>{
 const button=el('exitStudyLoad'),account=el('account').value;button.disabled=true;el('exitStudyStatus').textContent='保存されたExit比較を読み込み中…';
 try{const data=await request('exit-study?account='+encodeURIComponent(account));if(el('account').value!==account)return;exitStudySnapshot=data;exitStudyAccount=account;showExitStudy(data);el('exitStudyExport').disabled=false;}
 catch(e){if(e.stalePaperRequest)return;el('exitStudyStatus').textContent=e.message;}
 finally{button.disabled=!paperConnected;}
});
el('account').addEventListener('change',()=>{exitStudySnapshot=null;exitStudyAccount=null;el('exitStudy').replaceChildren();el('exitStudyExport').disabled=true;el('exitStudyStatus').textContent='選択口座が変わりました。「Exit比較を更新」で読み込んでください。';});
el('exitStudyExport').addEventListener('click',()=>{
 if(!exitStudySnapshot||exitStudyAccount!==el('account').value)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify(exitStudySnapshot,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='paper-exit-study.json';a.click();URL.revokeObjectURL(url);
});
el('exitStudyV2Load').addEventListener('click',async()=>{
 const button=el('exitStudyV2Load'),account=el('account').value;button.disabled=true;el('exitStudyV2Status').textContent='保存されたExit比較2を読み込み中…';
 try{const data=await request('exit-study-v2?account='+encodeURIComponent(account));if(el('account').value!==account)return;exitStudyV2Snapshot=data;exitStudyV2Account=account;showExitStudy(data,'V2');el('exitStudyV2Export').disabled=false;}
 catch(e){if(e.stalePaperRequest)return;el('exitStudyV2Status').textContent=e.message;}
 finally{button.disabled=!paperConnected;}
});
el('account').addEventListener('change',()=>{exitStudyV2Snapshot=null;exitStudyV2Account=null;el('exitStudyV2').replaceChildren();el('exitStudyV2Export').disabled=true;el('exitStudyV2Status').textContent='選択口座が変わりました。「Exit比較2を更新」で読み込んでください。';});
el('exitStudyV2Export').addEventListener('click',()=>{
 if(!exitStudyV2Snapshot||exitStudyV2Account!==el('account').value)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify(exitStudyV2Snapshot,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='paper-exit-study-v2.json';a.click();URL.revokeObjectURL(url);
});
