'use strict';
const PAPER_API='https://spy0dte-live-backend-v2.vercel.app/api/paper/';
let paperToken='',paperSnapshot=null,paperTimer=null,paperBusy=false,paperConnected=false;
const el=id=>document.getElementById(id);
const usd=c=>c==null?'--':new Intl.NumberFormat('ja-JP',{style:'currency',currency:'USD'}).format(c/100);
const percent=n=>n==null?'--':(100*n).toFixed(1)+'%';
const when=s=>s?new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',hour12:false})+' JST':'未取得';
const duration=s=>s==null?'未確認':Math.max(0,s/60).toFixed(1)+'分';
let paperDiagnostics=null;
const statusNames={FLAT:'見送り',IN_PENDING:'仮想IN待ち',OPEN:'保有継続',OUT_PENDING:'決済待ち',CLOSED:'決済済み'};
const reasons={OUTSIDE_MARKET_HOURS:'市場時間外のため取得・新規購入を休止',TIME_ENTRY_LOCK:'新規購入の時間外（保有管理は継続）',MARKET_CALENDAR_UNAVAILABLE:'取引カレンダーの確認待ち',ENTRY_STOPPED:'新規IN停止中',LOSS_LIMIT:'損失上限に到達',REALTIME_UNVERIFIED:'リアルタイム権限・遅延を確認できません',HALT_STATUS_UNVERIFIED:'市場停止状態を確認できません',CONTRACT_METADATA_MISSING:'契約ID・倍率が未取得',STALE_QUOTE:'気配が古いため待機',STALE_RECEIPT:'受信データが古いため待機',OUTSIDE_FILL_WINDOW:'市場時間外',DATA_MODE_MISMATCH:'有効な実相場データがありません',DATA_UNAVAILABLE:'相場データ未取得',FIXED_CONTRACT_MISMATCH:'保有契約と気配が一致しません',ASK_SIZE_MISSING_OR_EMPTY:'売り板数量が未取得または不足',BID_SIZE_MISSING_OR_EMPTY:'買い板数量が未取得または不足',CAPITAL_LIMIT:'仮想資金の購入上限超過',FORCE_EXIT:'強制終了時刻',HARD_STOP:'損失率上限',THESIS_BREAK:'売買根拠の崩れ',PROFIT_TRAIL:'RUNNER利益保護',OPPOSITE_SIGNAL:'反対方向シグナル',NO_PROGRESS:'伸びず勢いも低下',TIME_DECAY:'保有時間・勢い・利益条件',NO_VALID_FILL_BEFORE_CLOSE:'取引終了まで決済できず未解決',MANUAL_EXIT:'利用者の仮想決済要求',TIME_SCORE_OR_SPREAD:'残り時間に対するスコア・スプレッド条件未達',SIGNAL_ACCEPTED:'購入候補を受付。新しい気配を待っています',NOT_STARTED:'仮想売買は未開始'};
async function request(path,body){
 const options={cache:'no-store',headers:{Authorization:'Bearer '+paperToken},signal:AbortSignal.timeout(55000)};
 if(body!==undefined){options.method='POST';options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
 const r=await fetch(PAPER_API+path,options);let data;
 try{data=await r.json();}catch{throw Error('仮想売買APIの公開状態を確認できません');}
 if(!r.ok||data.ok===false)throw Error(r.status===401?'管理用認証が必要です':r.status===409?'別の判定処理中です。次回更新を待ちます':data.error==='PAPER_STORE_UNAVAILABLE'?'サーバーの永続保存に接続できません':data.error==='PAPER_REQUEST_OR_STATE_INVALID'?'開始設定・保存許諾・口座状態を確認してください':'仮想売買API未接続または処理失敗');
 return data;
}
function lineList(target,rows){target.replaceChildren();for(const [k,v] of rows){const a=document.createElement('dt'),b=document.createElement('dd');a.textContent=k;b.textContent=v;target.append(a,b);}}
function show(s){
 paperSnapshot=s;const a=s.accounts[el('account').value];if(!a)throw Error('仮想口座が見つかりません');
 const op=s.operations||{};const runtimeNames={SCHEDULED_WAIT:'次回の定期実行待ち',STARTING:'定期実行の開始待ち',WAITING:'サーバー起動待ち',STOPPED:'停止：実行記録が届いていません',DELAYED:'遅延：実行間隔が開いています',NEEDS_ATTENTION:'要対応：実行エラー',MARKET_CLOSED:'市場時間外',PAUSED:'新規IN停止中・保有なし',RUNNING:'サーバーの実行を受信中'};
 el('news').textContent=s.newsLabel;el('runtime').textContent=runtimeNames[op.status]||'稼働状態の確認待ち';
 el('runtimeDetail').textContent='実注文OFF / 自動PAPERの目標間隔 '+s.evaluation_seconds+'秒 / スマホ終了後の継続検証：'+(s.unattendedVerified?'確認済み':'未完了');
 lineList(el('operations'),[['最終処理成功',when(op.last_execution_success_at)],['最終相場受信',when(op.last_market_received_at)],['最終保存成功の記録時刻',when(op.last_save_at)],['実測の直近間隔',op.last_interval_seconds==null?'未測定':op.last_interval_seconds.toFixed(1)+'秒'],['観測範囲の最大間隔',op.max_interval_seconds==null?'未測定':op.max_interval_seconds.toFixed(1)+'秒'],['累計取得失敗回数',op.total_failures??'未取得'],['状態・停止理由',({NEXT_SCHEDULED_RUN:'予定どおりの休止',LAST_SCHEDULED_RUN_MISSING:'最後の予定実行を確認できません',POSITION_REMAINS_OUTSIDE_SCHEDULE:'実行時間外に未決済の保有があります',OUTSIDE_MARKET_HOURS:'市場時間外',EXTERNAL_RUN_RECEIVED:'定期実行を受信'})[op.reason]||op.reason||'未確認'],['次の予定実行',when(op.schedule?.next_expected_at)]]);
 el('dataMode').textContent=s.data_mode==='LIVE'?'実相場を使うPAPER口座（気配の有効性は各判定で確認）':'テストデータ専用';
 el('decision').textContent=statusNames[a.state]||a.state;el('reason').textContent=(!a.position&&a.clock?.marketOpen===false)?'市場時間外。新しい価格の取得と購入判定を休止しています。':reasons[a.last_reason]||a.last_reason;
 const q=a.last_data_quality; const inactive=q?.observationExpected===false||(a.clock?.marketOpen===false&&!a.position);
 el('qualityAt').textContent=inactive?'取得対象外の時間です。時刻未取得を通信障害として扱いません。':q?'判定時点の記録：'+when(q.checkedAt)+'（現在の気配ではありません）':'次のサーバー判定後に表示します。';
 const qualityNames={MISSING_SOURCE_TIME:'時刻未取得',INVALID_SOURCE_TIME:'時刻不正',FUTURE_SOURCE_TIME:'未来時刻',STALE_SOURCE_TIME:'古いデータ',FRESH:'鮮度条件内',NOT_REQUIRED:'指標OFF'};
 lineList(el('dataQuality'),inactive?[]:q?[['リアルタイム資格',q.realtimeState==='VERIFIED'?'確認済み':'未確認'],['取引停止状態',q.haltState==='NOT_HALTED'?'停止なし確認済み':q.haltState==='HALTED'?'取引停止中':'未確認'],...Object.values(q.fields||{}).map(f=>[f.label,(qualityNames[f.status]||f.status)+(f.ageSeconds==null?'':' / '+Number(f.ageSeconds).toFixed(1)+'秒前・上限'+f.maxAgeSeconds+'秒')])]:[]);
 el('updated').textContent='最終実行 '+when(s.last_run)+' / 実行遅延 '+(op.status==='SCHEDULED_WAIT'?'予定休止中':s.execution_lag_seconds==null?'未確認':Number(s.execution_lag_seconds).toFixed(1)+'秒');
 for(const [id,key] of Object.entries({equity:'equity_cents',cash:'cash_cents',daily:'day_pnl_cents',realized:'realized_cents',unrealized:'unrealized_cents',fees:'fees_cents'}))el(id).textContent=usd(a[key]);
 el('dd').textContent=a.max_drawdown_pct.toFixed(2)+'%';el('uptime').textContent=percent(s.observed_uptime);
 const p=a.position;el('contract').textContent=p?p.contract.optionSymbol+' / '+p.contract.expiration+' / '+p.contract.side+' / Strike '+p.contract.strike:'現在の保有なし';
 lineList(el('position'),p?[['仮想IN価格',p.inPrice==null?'IN待ち':'$'+p.inPrice.toFixed(4)],['現在の決済評価',p.markFresh?'$'+p.markPrice.toFixed(4):'有効気配なし（リスク評価0）'],['IN時刻',when(p.inAt)],['保有時間',duration(a.clock.holdingSec)],['契約の最終取引まで',duration(a.clock.contractRemainingSec)],['戦略の強制OUTまで',duration(a.clock.forceRemainingSec)],['観測した最大含み益',p.mfe_pct==null?'--':p.mfe_pct.toFixed(1)+'%'],['観測した最大含み損',p.mae_pct==null?'--':p.mae_pct.toFixed(1)+'%']]:[]);
 el('comparison').replaceChildren();for(const b of Object.values(s.accounts)){const tr=document.createElement('tr');for(const v of [b.account_id,b.report.summary.trades,usd(b.realized_cents),b.max_drawdown_pct.toFixed(2)+'%',b.unresolved_count]){const td=document.createElement('td');td.textContent=v;tr.append(td);}el('comparison').append(tr);}
 showDecisionAnalysis(a.last_decision_analysis);
 const eq=a.report.execution_quality;
 const seconds=v=>v==null?'未記録':Number(v).toFixed(1)+'秒';
 el('executionQuality').textContent=eq?'仮想INの判定→約定：平均 '+seconds(eq.entry.mean_seconds)+' / 仮想OUT：平均 '+seconds(eq.exit.mean_seconds)+'・最大 '+seconds(eq.exit.max_seconds)+' / 保有中の観測最大間隔 '+seconds(eq.max_observation_gap_seconds)+'。観測間の値動きは不明です。':'約定までの実測時間：記録待ち';
 const m=a.report.summary;el('stats').textContent=m.status+' / '+m.trading_days+'取引日 / 勝率 '+percent(m.win_rate)+' / 平均純損益 '+(m.average_net==null?'--':'$'+m.average_net.toFixed(2))+' / 平均利益 '+(m.average_profit??'--')+' / 平均損失 '+(m.average_loss??'--')+' / PF '+(m.profit_factor==null?'検証不足・損失なし':m.profit_factor.toFixed(2))+' / 最大連敗 '+m.max_losing_streak+' / 稼働中のデータ不足率 '+percent(a.report.missing_rate)+'（新集計 '+(a.report.quality_observations??0)+'回）'+' / 未約定率 '+percent(a.report.unfilled_rate);
 el('groups').replaceChildren();for(const [kind,buckets] of Object.entries(a.report.groups)){const h=document.createElement('h3');h.textContent=({time_band:'時間帯',remaining:'残り時間',holding:'保有時間',side:'CALL / PUT',out_reason:'OUT理由',strategy:'戦略版',day:'日次',week:'週次',decision_version:'購入判定の版',entry_code:'購入時のコード版',price_support:'価格条件の一致数',vol_support:'ボラティリティ条件の一致数'})[kind]||kind;el('groups').append(h);for(const [name,v] of Object.entries(buckets)){const row=document.createElement('p');row.textContent=name+'：'+v.trades+'件 / $'+v.net.toFixed(2)+' / '+v.status;el('groups').append(row);}}
 el('unresolved').textContent='未解決 '+a.report.unresolved_count+'件 / 全損＋決済費用の保守評価 $'+a.report.unresolved_conservative_loss_usd.toFixed(2)+'。正式損益には未決済のまま残します。';
 el('history').replaceChildren();for(const t of [...a.history].reverse()){const div=document.createElement('div');div.className='trade';div.textContent=t.contract.side+' '+t.contract.strike+' / '+usd(t.net_cents)+' / '+(reasons[t.outReason]||t.outReason)+'\n'+when(t.inAt)+' → '+when(t.outAt)+' / 仮想約定';el('history').append(div);}if(!a.history.length)el('history').textContent='決済履歴はまだありません';
 el('entryWindow').textContent='新規購入は通常取引終了の60分前で停止。締切後も保有分の売却判断を継続します。'+(a.clock?.entryEndsAt?' 当日の購入締切：'+when(a.clock.entryEndsAt):'');
 el('config').textContent=JSON.stringify({現在の新規購入制限:s.entry_constraints,記録開始時の固定戦略設定:a.policy,設定注記:'新規購入は固定戦略より厳しい60分前の制限を適用。過去の設定・残高・履歴は保持。',コード:s.code_commit,データ区分:s.data_mode,ニュース:s.newsMode,費用:'未確認・仮定値',自動最適化:'無効',事後EXIT比較:'EXIT_PLUS5M_V1：保存済み気配のみ・正式損益と分離'},null,2);
 showDiagnostics();
 for(const id of ['start','pause','exit','json','csv','journal','review','diagnose'])el(id).disabled=false;
}
async function refresh(){show(await request('status'));}
async function poll(){if(!paperConnected||paperBusy)return;paperBusy=true;try{await refresh();}catch(e){el('message').textContent=e.message;el('runtime').textContent='要対応：稼働状態を取得できません';}finally{paperBusy=false;if(paperConnected)paperTimer=setTimeout(poll,60000);}}
async function command(c){try{show(await request('command',{command:c,account_id:c==='exit'?el('account').value:'ALL',request_id:crypto.randomUUID()}));el('message').textContent=c==='start'?'開始設定を保存しました。実際の稼働はサーバー実行の記録で確認してください。':'操作を保存しました。次のサーバー実行で保有管理を続けます。';}catch(e){el('message').textContent=e.message;}}
async function download(format){try{let data=await request('export?format='+format);if(format==='journal'){const events=[...data.events];while(data.next_start!==null){data=await request('export?format=journal&start='+data.next_start);events.push(...data.events);}data={filename:'paper-journal.json',events};}const b=new Blob([format==='csv'?data.content:JSON.stringify(data,null,2)],{type:format==='csv'?'text/csv;charset=utf-8':'application/json'});const url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=data.filename;a.click();URL.revokeObjectURL(url);}catch(e){el('message').textContent=e.message;}}
el('connect').addEventListener('click',async()=>{paperToken=el('token').value;el('token').value='';clearTimeout(paperTimer);paperConnected=false;try{await refresh();paperConnected=true;paperTimer=setTimeout(poll,60000);el('message').textContent='保存済みの状態を読み込みました。画面の閲覧では売買判定を起動しません。';}catch(e){el('message').textContent=e.message;}});
async function reviewExits(){
 try{const data=await request('exit-review');const target=el('exitReview');target.replaceChildren();
 const note=document.createElement('p');note.textContent='EXIT_PLUS5M_V1 / 検証不足 / 読取 '+data.coverage.journal_events_read+'ログ / 対象外の古い決済 '+data.trades_omitted+'件'+(data.coverage.older_events_may_be_omitted?' / 古い観測は読取範囲外の可能性あり':'');target.append(note);
 const names={WAITING:'観測時刻の到来待ち',MISSING_OBSERVATION:'観測不足',OUTSIDE_SESSION:'取引時間外',CONFIG_MISMATCH:'設定不一致',OBSERVED_RETROSPECTIVE:'事後試算（約定ではありません）'};
 for(const row of data.rows){const p=document.createElement('p');p.textContent=row.account_id+' / '+row.trade_id+' / '+(names[row.status]||row.status)+' / 正式 '+usd(row.official_net_cents)+' / 5分後試算 '+usd(row.hypothetical_net_cents)+' / 差 '+usd(row.difference_cents)+' / 観測 '+when(row.observed_at);target.append(p);}
 if(!data.rows.length){const p=document.createElement('p');p.textContent='比較対象の決済履歴はまだありません';target.append(p);}
 }catch(e){el('exitReview').textContent=e.message;}
}
el('review').addEventListener('click',reviewExits);
el('account').addEventListener('change',()=>{if(paperSnapshot)show(paperSnapshot);});
for(const [id,c] of [['start','start'],['pause','pause'],['exit','exit']])el(id).addEventListener('click',()=>command(c));
for(const id of ['json','csv','journal'])el(id).addEventListener('click',()=>download(id));
window.addEventListener('pagehide',()=>{paperConnected=false;clearTimeout(paperTimer);paperToken='';});
fetch(PAPER_API+'health',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(s=>{el('runtime').textContent=s.release=== '6.4-paper-auto-candidate-1'?'PAPER接続待ち':'PAPER版の公開確認待ち';el('runtimeDetail').textContent=s.adminConfigured?'認証後に状態を確認できます':'管理認証のサーバー設定が必要です。自動運転は未開始です。';}).catch(()=>{el('runtime').textContent='仮想売買APIは未接続';el('runtimeDetail').textContent='バックエンドの公開・認証設定が完了するまで開始できません。';});

function showDiagnostics(){
 const target=el('diagnostics');if(!paperDiagnostics)return;
 target.replaceChildren();const d=paperDiagnostics,account=d.accounts?.[el('account').value];
 const note=document.createElement('p');note.textContent='集計期間 '+when(d.coverage.start_at)+' ～ '+when(d.coverage.end_at)+' / '+d.coverage.events_read+'ログ'+(d.coverage.older_events_may_be_omitted?'（古い記録は集計範囲外の可能性あり）':'');target.append(note);
 if(!account){const p=document.createElement('p');p.textContent='対象の判定記録がまだありません';target.append(p);return;}
 const latest=account.latest_recorded_commit,whole=account.observed_window;
 const p=document.createElement('p');p.textContent='直近の記録版：判定 '+latest.decisions+'回 / 見送り '+latest.skips+'回。時間外・開始前は除外しています。';target.append(p);
 const counts=Object.entries(latest.reasons||{});for(const [reason,count] of counts){const row=document.createElement('p');row.textContent=(reasons[reason]||reason)+'：'+count+'回';target.append(row);}
 const h=document.createElement('h3');h.textContent='同時に不足していたデータ（重複あり）';target.append(h);
 const labels={spyPriceAt:'SPY最終約定',spyQuoteAt:'SPY気配',optionQuoteAt:'オプション気配',barAt:'1分足',volPriceAt:'VIXY最終約定'};
 const barReasons={MINUTE_GAP_OR_DUPLICATE:'1分足の欠落・重複',SESSION_START_MISSING:'寄付きからの足が不足',INVALID_OHLCV:'足の価格・出来高が不正',ZERO_SESSION_VOLUME:'当日出来高がゼロ',INSUFFICIENT_MINUTE_BARS:'1分足の本数不足',INVALID:'1分足が不正'};
 const states={STALE_SOURCE_TIME:'古い',MISSING_SOURCE_TIME:'時刻なし',FUTURE_SOURCE_TIME:'未来時刻',INVALID_SOURCE_TIME:'時刻不正'};
 for(const [code,count] of Object.entries(latest.data_blockers||{})){const [field,state]=code.split(':');const row=document.createElement('p');row.textContent=(field==='BARS'?(barReasons[state]||'1分足：'+state):labels[field]?labels[field]+'：'+(states[state]||state):reasons[code]||code)+' / '+count+'回';target.append(row);}
 const timing=latest.acquisition_timing;if(timing?.samples){const row=document.createElement('p');row.textContent='取得処理時間：平均 '+Number(timing.mean_ms).toFixed(0)+'ms / 最大 '+Number(timing.max_ms).toFixed(0)+'ms / '+timing.samples+'回。元データの古さとは別の測定です。';target.append(row);}
 const tail=document.createElement('p');tail.textContent='記録範囲全体：対象 '+whole.decisions+'回 / データ条件未達 '+percent(whole.data_blocked_rate)+'。4口座の件数は合算しません。';target.append(tail);
}
el('diagnose').addEventListener('click',async()=>{const button=el('diagnose');button.disabled=true;el('diagnostics').textContent='保存済みログを集計中…';try{paperDiagnostics=await request('diagnostics');showDiagnostics();}catch(e){el('diagnostics').textContent=e.message;}finally{button.disabled=false;}});

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
