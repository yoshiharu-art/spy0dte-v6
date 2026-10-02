'use strict';
const PAPER_API='https://spy0dte-live-backend-v2.vercel.app/api/paper/';
let paperToken='',paperSnapshot=null,paperTimer=null,paperBusy=false,paperConnected=false,paperAuthRequired=false;
const el=id=>document.getElementById(id);
const usd=c=>c==null?'--':new Intl.NumberFormat('ja-JP',{style:'currency',currency:'USD'}).format(c/100);
const percent=n=>n==null?'--':(100*n).toFixed(1)+'%';
const when=s=>s?new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})+' JST':'未取得';
const duration=s=>s==null?'未確認':Math.max(0,s/60).toFixed(1)+'分';
const count=n=>Number.isSafeInteger(n)&&n>=0?String(n):'未記録';
const dollars=n=>n==null?'未算出':'$'+Number(n).toFixed(2);
const strategyLabels={V64_BASELINE_1:'基準版',V64_TIME_1:'時間考慮版',V65_TREND_RETEST_1:'追加インジ旧版（当日から計算）',V65_TREND_RETEST_2:'追加インジ版2（厳格条件の比較用）',V65_BALANCED_3:'追加インジ版3（バランス検証）',V66_CORE_TREND_1:'独立トレンド版1（PAPER比較）'};
function accountLabel(key){const [strategy,kind]=String(key).split(':');return (strategyLabels[strategy]||strategy)+' · '+(kind==='STRESS'?'不利な条件':'通常条件');}
const winRate=m=>!m?.trades||m.win_rate==null?'未算出（決済なし・記録不足）':percent(m.win_rate);
let paperDiagnostics=null;
let tradePreflightBusy=false;
let tradeAccountChoices=[];
const statusNames={FLAT:'見送り',IN_PENDING:'仮想IN待ち',OPEN:'保有継続',OUT_PENDING:'決済待ち',CLOSED:'決済済み'};
const reasons={OUTSIDE_MARKET_HOURS:'市場時間外のため取得・新規購入を休止',TIME_ENTRY_LOCK:'新規購入の時間外（保有管理は継続）',MARKET_CALENDAR_UNAVAILABLE:'取引カレンダーの確認待ち',ENTRY_STOPPED:'新規IN停止中',LOSS_LIMIT:'損失上限に到達',REALTIME_UNVERIFIED:'リアルタイム権限・遅延を確認できません',HALT_STATUS_UNVERIFIED:'市場停止状態を確認できません',CONTRACT_METADATA_MISSING:'契約ID・倍率が未取得',STALE_QUOTE:'気配が古いため待機',STALE_RECEIPT:'受信データが古いため待機',OUTSIDE_FILL_WINDOW:'市場時間外',DATA_MODE_MISMATCH:'有効な実相場データがありません',DATA_UNAVAILABLE:'相場データ未取得',FIXED_CONTRACT_MISMATCH:'保有契約と気配が一致しません',ASK_SIZE_MISSING_OR_EMPTY:'売り板数量が未取得または不足',BID_SIZE_MISSING_OR_EMPTY:'買い板数量が未取得または不足',CAPITAL_LIMIT:'仮想資金の購入上限超過',FORCE_EXIT:'強制終了時刻',HARD_STOP:'損失率上限',THESIS_BREAK:'売買根拠の崩れ',PROFIT_TRAIL:'RUNNER利益保護',OPPOSITE_SIGNAL:'反対方向シグナル',NO_PROGRESS:'伸びず勢いも低下',TIME_DECAY:'保有時間・勢い・利益条件',NO_VALID_FILL_BEFORE_CLOSE:'取引終了まで決済できず未解決',MANUAL_EXIT:'利用者の仮想決済要求',TIME_SCORE_OR_SPREAD:'残り時間に対するスコア・スプレッド条件未達',SIGNAL_ACCEPTED:'購入候補を受付。新しい気配を待っています',NOT_STARTED:'仮想売買は未開始'};
async function request(path,body){
 const requestToken=paperToken;
 const current=()=>{if(requestToken!==paperToken)throw Object.assign(Error('接続が切り替わったため以前の応答を破棄しました。'),{stalePaperRequest:true});};
 const options={cache:'no-store',headers:{Authorization:'Bearer '+requestToken},signal:AbortSignal.timeout(55000)};
 if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
 let r,data;
 try{r=await fetch(PAPER_API+path,options);}catch(e){current();throw e;}
 current();
 if(r.status===401){showAuthRequired();throw Error('管理用認証が必要です。再接続してください。');}
 try{data=await r.json();}catch{current();throw Error('仮想売買APIの公開状態を確認できません');}
 current();
 if(!r.ok||data.ok===false)throw Error(r.status===401?'管理用認証が必要です':r.status===409?'別の判定処理中です。次回更新を待ちます':data.error==='PAPER_STORE_UNAVAILABLE'?'サーバーの永続保存に接続できません':data.error==='PAPER_REQUEST_OR_STATE_INVALID'?'開始設定・保存許諾・口座状態を確認してください':'仮想売買API未接続または処理失敗');
 return data;
}
function showAuthRequired(){
 paperAuthRequired=true;paperConnected=false;clearTimeout(paperTimer);paperToken='';
 paperSnapshot=null;paperDiagnostics=null;exitStudySnapshot=null;exitStudyAccount=null;exitStudyV2Snapshot=null;exitStudyV2Account=null;
 for(const id of ['operations','position','dataQuality','comparison','groups','exitStudy','exitStudyV2'])el(id).replaceChildren();
 for(const id of ['equity','cash','daily','realized','unrealized','fees','dd','uptime'])el(id).textContent='--';
 const unknown={runtime:'管理用認証が必要：PAPER状態は未確認',runtimeDetail:'実注文OFF / 認証付きの稼働状態・口座記録を取得できません。',
  dataMode:'認証付きPAPER状態は未取得',decision:'PAPER状態未確認',reason:'購入・保有・履歴は未確認です。管理用認証で再接続してください。',
  updated:'最終実行 未確認',qualityAt:'判定記録は未確認です。',contract:'保有状態は未確認です。',stats:'取引件数・損益は未確認です。',
  history:'取引履歴は未確認です。',diagnostics:'見送り理由は未確認です。',decisionAnalysis:'購入判断の記録は未確認です。',
  indicatorAnalysis:'追加インジの判定記録は未確認です。',entryFunnel:'観測・購入指示・約定の件数は未確認です。',executionQuality:'約定の記録は未確認です。',unresolved:'未解決の保有状態は未確認です。',
  exitReview:'決済記録は未確認です。',exitStudyStatus:'Exit比較は未確認です。',exitStudyV2Status:'Exit比較2は未確認です。',config:'口座設定は未確認です。'};
 for(const [id,message] of Object.entries(unknown))el(id).textContent=message;
 for(const id of ['start','pause','exit','json','csv','journal','review','diagnose','exitStudyLoad','exitStudyExport','exitStudyV2Load','exitStudyV2Export','tradePreflight'])el(id).disabled=true;
 showTradeAccountChoices([]);el('tradePreflightResult').textContent='';el('tradePreflightStatus').textContent='管理用認証で再接続してください。';
}
function lineList(target,rows){target.replaceChildren();for(const [k,v] of rows){const a=document.createElement('dt'),b=document.createElement('dd');a.textContent=k;b.textContent=v;target.append(a,b);}}
function show(s){
 paperSnapshot=s;syncAccounts(s.accounts);const a=s.accounts[el('account').value];if(!a)throw Error('仮想口座が見つかりません');
 const op=s.operations||{};const runtimeNames={SCHEDULED_WAIT:'次回の定期実行待ち',STARTING:'定期実行の開始待ち',WAITING:'サーバー起動待ち',STOPPED:'停止：実行記録が届いていません',DELAYED:'遅延：実行間隔が開いています',NEEDS_ATTENTION:'要対応：実行エラー',MARKET_CLOSED:'市場時間外',PAUSED:'新規IN停止中・保有なし',RUNNING:'サーバーの実行を受信中'};
 el('news').textContent=s.newsLabel;el('runtime').textContent=runtimeNames[op.status]||'稼働状態の確認待ち';
 el('runtimeDetail').textContent='実注文OFF / 自動PAPERの目標間隔 '+s.evaluation_seconds+'秒 / スマホ終了後の継続検証：'+(s.unattendedVerified?'確認済み':'未完了');
 lineList(el('operations'),[['最終処理成功',when(op.last_execution_success_at)],['最終相場受信',when(op.last_market_received_at)],['最終保存成功の記録時刻',when(op.last_save_at)],['実測の直近間隔',op.last_interval_seconds==null?'未測定':op.last_interval_seconds.toFixed(1)+'秒'],['観測範囲の最大間隔',op.max_interval_seconds==null?'未測定':op.max_interval_seconds.toFixed(1)+'秒'],['累計取得失敗回数',op.total_failures??'未取得'],['状態・停止理由',({NEXT_SCHEDULED_RUN:'予定どおりの休止',LAST_SCHEDULED_RUN_MISSING:'最後の予定実行を確認できません',POSITION_REMAINS_OUTSIDE_SCHEDULE:'実行時間外に未決済の保有があります',OUTSIDE_MARKET_HOURS:'市場時間外',EXTERNAL_RUN_RECEIVED:'定期実行を受信'})[op.reason]||op.reason||'未確認'],['次の予定実行',when(op.schedule?.next_expected_at)]]);
 el('dataMode').textContent=s.data_mode==='LIVE'?'実相場を使うPAPER口座（気配の有効性は各判定で確認）':'テストデータ専用';
 el('decision').textContent=statusNames[a.state]||a.state;el('reason').textContent=(!a.position&&a.clock?.marketOpen===false)?'市場時間外。新しい価格の取得と購入判定を休止しています。':reasonText(a.last_reason);
 const q=a.last_data_quality; const inactive=q?.observationExpected===false||(a.clock?.marketOpen===false&&!a.position);
 el('qualityAt').textContent=inactive?'取得対象外の時間です。時刻未取得を通信障害として扱いません。':q?'判定時点の記録：'+when(q.checkedAt)+'（現在の気配ではありません）':'次のサーバー判定後に表示します。';
 const qualityNames={MISSING_SOURCE_TIME:'時刻未取得',INVALID_SOURCE_TIME:'時刻不正',FUTURE_SOURCE_TIME:'未来時刻',STALE_SOURCE_TIME:'古いデータ',FRESH:'鮮度条件内',NOT_REQUIRED:'指標OFF'};
 lineList(el('dataQuality'),inactive?[]:q?[['リアルタイム資格',q.realtimeState==='VERIFIED'?'確認済み':'未確認'],['取引停止状態',q.haltState==='NOT_HALTED'?'停止なし確認済み':q.haltState==='HALTED'?'取引停止中':'未確認'],...Object.values(q.fields||{}).map(f=>[f.label,(qualityNames[f.status]||f.status)+(f.ageSeconds==null?'':' / '+Number(f.ageSeconds).toFixed(1)+'秒前・上限'+f.maxAgeSeconds+'秒')])]:[]);
 el('updated').textContent='最終実行 '+when(s.last_run)+' / 実行遅延 '+(op.status==='SCHEDULED_WAIT'?'予定休止中':s.execution_lag_seconds==null?'未確認':Number(s.execution_lag_seconds).toFixed(1)+'秒');
 for(const [id,key] of Object.entries({equity:'equity_cents',cash:'cash_cents',daily:'day_pnl_cents',realized:'realized_cents',unrealized:'unrealized_cents',fees:'fees_cents'}))el(id).textContent=usd(a[key]);
 el('dd').textContent=a.max_drawdown_pct.toFixed(2)+'%';el('uptime').textContent=percent(s.observed_uptime);
 const p=a.position;el('contract').textContent=p?p.contract.optionSymbol+' / '+p.contract.expiration+' / '+p.contract.side+' / Strike '+p.contract.strike:'現在の保有なし';
 lineList(el('position'),p?[['仮想IN価格',p.inPrice==null?'IN待ち':'$'+p.inPrice.toFixed(4)],['現在の決済評価',p.markFresh?'$'+p.markPrice.toFixed(4):'有効気配なし（リスク評価0）'],['IN時刻',when(p.inAt)],['保有時間',duration(a.clock.holdingSec)],['契約の最終取引まで',duration(a.clock.contractRemainingSec)],['戦略の強制OUTまで',duration(a.clock.forceRemainingSec)],['観測した最大含み益',p.mfe_pct==null?'--':p.mfe_pct.toFixed(1)+'%'],['観測した最大含み損',p.mae_pct==null?'--':p.mae_pct.toFixed(1)+'%']]:[]);
 el('comparison').replaceChildren();for(const b of Object.values(s.accounts)){const tr=document.createElement('tr'),m=b.report.summary;for(const v of [accountLabel(b.account_id),count(m.trades),winRate(m),dollars(m.net),dollars(m.fees),dollars(m.average_profit),dollars(m.average_loss),b.max_drawdown_pct.toFixed(2)+'%',count(b.unresolved_count)]){const td=document.createElement('td');td.textContent=v;tr.append(td);}el('comparison').append(tr);}
 showEntryFunnel(a.entry_funnel);
 showDecisionAnalysis(a.last_decision_analysis);
 showIndicatorAnalysis(a.last_indicator_analysis,s.indicatorComparison?.historyReadiness,a.clock?.marketOpen,a.core_entry_sampling||a.indicator_sampling);
 if(a.state==='FLAT'&&a.clock?.marketOpen===false)el('decision').textContent='市場時間外・予定休止';
 if(a.state==='FLAT'&&a.clock?.marketOpen&&a.last_indicator_analysis?.decisionClass==='SESSION_WARMUP')el('decision').textContent='寄付き後の形状確認待ち';
 if(a.state==='FLAT'&&a.entries_enabled&&a.clock?.marketOpen&&['SYSTEM_NOT_READY','DATA_ERROR'].includes(a.last_indicator_analysis?.decisionClass))el('decision').textContent=a.last_indicator_analysis.decisionClass==='DATA_ERROR'?'データ異常':'SYSTEM NOT READY：データ準備不足';
 const eq=a.report.execution_quality;
 const seconds=v=>v==null?'未記録':Number(v).toFixed(1)+'秒';
 const delay=(label,d)=>label+'：平均 '+seconds(d?.mean_seconds)+' / 中央値 '+seconds(d?.p50_seconds)+' / 95%点 '+seconds(d?.p95_seconds)+' / 最大 '+seconds(d?.max_seconds)+'（実測 '+count(d?.samples)+'件）';
 el('executionQuality').textContent=eq?delay('仮想INの判定→約定',eq.entry)+' / '+delay('仮想OUTの判定→約定',eq.exit)+' / 保有中の観測最大間隔 '+seconds(eq.max_observation_gap_seconds)+'。観測間の値動きは不明です。':'約定までの実測時間：記録待ち';
 const m=a.report.summary;el('stats').textContent=m.status+' / '+m.trading_days+'取引日 / 決済 '+count(m.trades)+'件 / 勝率 '+winRate(m)+' / 費用込み純損益 '+dollars(m.net)+' / 決済費用 '+dollars(m.fees)+' / 平均純損益 '+dollars(m.average_net)+' / 平均利益 '+dollars(m.average_profit)+' / 平均損失 '+dollars(m.average_loss)+' / PF '+(m.profit_factor==null?(m.profit_factor_status==='NO_LOSSES'?'損失なし（未定義）':'未算出（記録不足）'):m.profit_factor.toFixed(2))+' / 最大連敗 '+m.max_losing_streak+' / 稼働中のデータ不足率 '+percent(a.report.missing_rate)+'（新集計 '+count(a.report.quality_observations)+'回）'+' / 未約定率 '+percent(a.report.unfilled_rate);
 el('groups').replaceChildren();for(const [kind,buckets] of Object.entries(a.report.groups)){const h=document.createElement('h3');h.textContent=({time_band:'時間帯',remaining:'残り時間',holding:'保有時間',side:'CALL / PUT',out_reason:'OUT理由',strategy:'戦略版',day:'日次',week:'週次',decision_version:'購入判定の版',entry_code:'購入時のコード版',price_support:'価格条件の一致数',vol_support:'ボラティリティ条件の一致数',indicator_version:'追加インジの戦略版'})[kind]||kind;el('groups').append(h);for(const [name,v] of Object.entries(buckets)){const row=document.createElement('p');row.textContent=name+'：'+v.trades+'件 / $'+v.net.toFixed(2)+' / '+v.status;el('groups').append(row);}}
 el('unresolved').textContent='未解決 '+a.report.unresolved_count+'件 / 全損＋決済費用の保守評価 $'+a.report.unresolved_conservative_loss_usd.toFixed(2)+'。正式損益には未決済のまま残します。';
 el('history').replaceChildren();for(const t of [...a.history].reverse()){const div=document.createElement('div');div.className='trade';div.textContent=t.contract.side+' '+t.contract.strike+' / 純損益 '+usd(t.net_cents)+' / 費用 '+usd(t.fees_cents)+' / '+reasonText(t.outReason)+'\n'+when(t.inAt)+' → '+when(t.outAt)+' / 仮想約定 / 購入理由 '+entryBasisText(t.entryIndicators?.entryBasis)+' / 保存確認 '+(t.persisted_at?when(t.persisted_at):'個別約定の保存時刻は未記録');el('history').append(div);}if(!a.history.length)el('history').textContent='決済履歴はまだありません';
 el('entryWindow').textContent='新規購入は通常取引終了の60分前で停止。締切後も保有分の売却判断を継続します。'+(a.clock?.entryEndsAt?' 当日の購入締切：'+when(a.clock.entryEndsAt):'');
 el('config').textContent=JSON.stringify({現在の新規購入制限:s.entry_constraints,記録開始時の固定戦略設定:a.policy,ニュース判定方針:s.newsDecisionPolicy,予定イベント判定:a.last_paper_news_risk,設定注記:'新規購入は固定戦略より厳しい60分前の制限を適用。過去の設定・残高・履歴は保持。',コード:s.code_commit,データ区分:s.data_mode,ニュース:s.newsMode,費用:'未確認・仮定値',自動最適化:'無効',事後EXIT比較:'EXIT_PLUS5M_V1：保存済み気配のみ・正式損益と分離'},null,2);
 showDiagnostics();
 for(const id of ['start','pause','exit','json','csv','journal','review','diagnose','exitStudyLoad','exitStudyV2Load'])el(id).disabled=false;
 el('tradePreflight').disabled=tradePreflightBusy;
}
async function refresh(){
 const s=await request('status');show(s);
 const h=s.indicatorComparison?.historyReadiness;
 // Only the explicit admin maintenance route can fill history. It never ticks
 // the PAPER engine; the server enforces RTH guards and the shared retry clock.
 if(h?.missingDates?.length&&s.indicatorComparison?.registeredAccounts?.length&&
    !Object.values(s.accounts||{}).some(a=>a.clock?.marketOpen)&&
    (!h.recovery?.nextAttemptAt||Date.parse(h.recovery.nextAttemptAt)<=Date.now())){
  try{show(await request('indicator-history-recovery',{}));}
  catch(e){if(e.stalePaperRequest)throw e;el('message').textContent='履歴の自動補完：'+e.message+'。次回更新で再確認します。';return false;}
 }
 return true;
}
async function poll(){if(!paperConnected||paperBusy)return;const requestToken=paperToken;paperBusy=true;try{await refresh();}catch(e){if(e.stalePaperRequest)return;el('message').textContent=e.message;if(!paperAuthRequired)el('runtime').textContent='要対応：稼働状態を取得できません';}finally{paperBusy=false;if(paperConnected&&requestToken===paperToken)paperTimer=setTimeout(poll,60000);}}
async function command(c){try{show(await request('command',{command:c,account_id:c==='exit'?el('account').value:'ALL',request_id:crypto.randomUUID()}));el('message').textContent=c==='start'?'開始設定を保存しました。実際の稼働はサーバー実行の記録で確認してください。':'操作を保存しました。次のサーバー実行で保有管理を続けます。';}catch(e){if(e.stalePaperRequest)return;el('message').textContent=e.message;}}
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
el('connect').addEventListener('click',async()=>{paperToken=el('token').value;paperAuthRequired=false;el('token').value='';clearTimeout(paperTimer);paperConnected=false;el('tradePreflight').disabled=true;el('tradePreflightResult').textContent='';el('tradePreflightStatus').textContent='管理用認証を確認中…';try{const ready=await refresh();paperConnected=true;paperTimer=setTimeout(poll,60000);if(ready)el('message').textContent='保存済みの状態を読み込みました。画面の閲覧では売買判定を起動しません。';el('tradePreflightStatus').textContent='接続診断を実行できます。';}catch(e){if(e.stalePaperRequest)return;el('message').textContent=e.message;el('tradePreflightStatus').textContent='管理用認証後に実行できます。';}});
async function reviewExits(){
 try{const data=await request('exit-review');const target=el('exitReview');target.replaceChildren();
 const note=document.createElement('p');note.textContent='EXIT_PLUS5M_V1 / 検証不足 / 読取 '+data.coverage.journal_events_read+'ログ / 対象外の古い決済 '+data.trades_omitted+'件'+(data.coverage.older_events_may_be_omitted?' / 古い観測は読取範囲外の可能性あり':'');target.append(note);
 const names={WAITING:'観測時刻の到来待ち',MISSING_OBSERVATION:'観測不足',OUTSIDE_SESSION:'取引時間外',CONFIG_MISMATCH:'設定不一致',OBSERVED_RETROSPECTIVE:'事後試算（約定ではありません）'};
 for(const row of data.rows){const p=document.createElement('p');p.textContent=row.account_id+' / '+row.trade_id+' / '+(names[row.status]||row.status)+' / 正式 '+usd(row.official_net_cents)+' / 5分後試算 '+usd(row.hypothetical_net_cents)+' / 差 '+usd(row.difference_cents)+' / 観測 '+when(row.observed_at);target.append(p);}
 if(!data.rows.length){const p=document.createElement('p');p.textContent='比較対象の決済履歴はまだありません';target.append(p);}
 }catch(e){if(e.stalePaperRequest)return;el('exitReview').textContent=e.message;}
}
el('review').addEventListener('click',reviewExits);
el('account').addEventListener('change',()=>{if(paperSnapshot)show(paperSnapshot);});
for(const [id,c] of [['start','start'],['pause','pause'],['exit','exit']])el(id).addEventListener('click',()=>command(c));
for(const id of ['json','csv','journal'])el(id).addEventListener('click',()=>download(id));
window.addEventListener('pagehide',()=>{paperConnected=false;clearTimeout(paperTimer);paperToken='';});
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
 const known=Array.from(select.options).map(o=>o.value),keys=Object.keys(accounts||{});
 if(known.length===keys.length&&known.every(k=>keys.includes(k)))return;
 select.replaceChildren();
 for(const key of keys){const option=document.createElement('option');option.value=key;option.textContent=accountLabel(key);select.append(option);}
 const next=keys.includes('V66_CORE_TREND_1:STANDARD')?'V66_CORE_TREND_1:STANDARD':keys.includes('V65_BALANCED_3:STANDARD')?'V65_BALANCED_3:STANDARD':'V65_TREND_RETEST_2:STANDARD';
 if(!known.includes(next)&&keys.includes(next))select.value=next;
 else if(keys.includes(selected))select.value=selected;
}
function reasonText(value){
 const parts=String(value||'').replace(/^INDICATOR: /,'');
 if(parts.includes(' / ')||parts.includes(', '))return parts.split(/ \/ |, /).map(reasonText).join(' / ');
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
function showExitStudy(data,suffix=''){
 const root=el('exitStudy'+suffix);root.replaceChildren();
 const number=v=>v==null?'--':Number(v).toFixed(2);
 const dollars=v=>v==null?'--':'$'+Number(v).toFixed(2);
 const paragraph=text=>{const p=document.createElement('p');p.textContent=text;root.append(p);};
 const table=(headers,rows)=>{const wrap=document.createElement('div');wrap.className='tableWrap';const t=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody'),hr=document.createElement('tr');for(const h of headers){const th=document.createElement('th');th.textContent=h;hr.append(th);}head.append(hr);for(const row of rows){const tr=document.createElement('tr');for(const v of row){const td=document.createElement('td');td.textContent=v;tr.append(td);}body.append(tr);}t.append(head,body);wrap.append(t);root.append(wrap);};
 el('exitStudy'+suffix+'Status').textContent='検証不足 / 記録中 '+(data.active?.length??0)+'件 / 全口座の追跡完了 '+(data.completed_total??0)+'件 / 記録エラー '+(data.errors??0)+'件。自動採用はしません。';
 if(suffix==='V2')paragraph((data.spec?.version||'EXIT_STUDY_2')+' / 固定条件ハッシュ '+(data.study_hash||'未記録')+'。旧Exit比較と別の観測・成績です。');
 if(!Object.keys(data.groups||{}).length)paragraph('比較できる完了取引はまだありません。');
 for(const [group,g] of Object.entries(data.groups||{})){
  paragraph(group.split('|')[0]+' / 同一条件の完全観測 '+g.paired_complete+'件 / 観測不足 '+g.partial+'件');
  table(['Exit案','件数','勝率','平均利益','平均損失','PF','期待値','実現損益DD','平均保有','MFE回収率','+50→損失','早すぎたExit',suffix==='V2'?'費用込み純損益':'+50決済との差'],Object.entries(g.candidates||{}).map(([k,m])=>[k+' '+m.label,m.samples,percent(m.win_rate),dollars(m.average_profit),dollars(m.average_loss),number(m.profit_factor),dollars(m.expectancy),dollars(m.max_realized_drawdown_usd),duration(m.average_hold_seconds),percent(m.mfe_capture_ratio),m.reached50_then_loss,m.early_exit_then_additional25pp,dollars(suffix==='V2'?m.net:m.delta_vs_plus50_exit_usd)]));
  paragraph('上表は同じ取引群だけの比較です。実現損益DDは口座全体のDDではありません。MFE回収率は費用後確定損益÷費用前の最大含み益。');
 }
 for(const [group,book] of Object.entries(data.portfolios||{})){
  paragraph(group.split('|')[0]+' / 1枚運用の口座試算（現行版のIN機会のみ）');
  table(['Exit案','決済','勝率','平均利益','平均損失','PF','期待値','保守最大DD','観測最大DD','重複見送り','資金・損失制限','気配欠損'],Object.entries(book).map(([k,m])=>[k,m.trades,percent(m.win_rate),dollars(m.average_profit),dollars(m.average_loss),number(m.profit_factor),dollars(m.expectancy),number(m.max_drawdown_pct)+'%',number(m.observed_max_drawdown_pct)+'%',m.skipped_overlap,m.skipped_risk,m.missing_marks]));
 }
 for(const text of data.limitations||[])paragraph(text);
 const details=document.createElement('details'),title=document.createElement('summary');title.textContent='各取引の到達時刻・押し戻し・SPY構造・候補OUTを確認';details.append(title);
 const pre=document.createElement('pre');pre.textContent=JSON.stringify({記録中:data.active||[],完了:data.rows||[]},null,2);details.append(pre);root.append(details);
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
