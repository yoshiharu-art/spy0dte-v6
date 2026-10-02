'use strict';
let paperPerformanceSnapshot=null,paperPerformanceBusy=false,paperPerformanceEpoch=0;
const performanceInputs=['performanceFrom','performanceTo','performanceAccount','performanceConfig'];
const performanceNumber=v=>typeof v==='number'&&Number.isFinite(v);
const performanceUSD=v=>performanceNumber(v)?'$'+v.toFixed(2):'未算出';
const performancePct=v=>performanceNumber(v)?(v*100).toFixed(1)+'%':'未算出';
const performanceSeconds=v=>performanceNumber(v)?v.toFixed(2)+'秒':'未記録';
const performanceCategory={conditions:'相場条件未達',data_missing:'必要なデータ・履歴が不足',data_stale:'データ鮮度の条件未達',contract_acquisition:'購入方向の契約候補が不足',spread_liquidity:'売買価格差・板数量・契約条件未達',risk_time_position:'資金・損失・時刻・保有の制限',internal_error:'取得・内部処理の異常'};
const performanceNotes={INSUFFICIENT:'標本不足',REQUIRES_OUT_OF_SAMPLE_EVALUATION:'別期間での評価が必要',PAPER_RESULTS_NOT_VERIFIED_LIVE_PROFITABILITY:'PAPERの成績です。実注文での収益性は未確認です。',SHARED_SIGNALS_ACROSS_ACCOUNTS_ARE_NOT_INDEPENDENT_SAMPLES:'複数口座で共有したシグナルを独立した標本として合算しません。',INTRABAR_PATH_UNKNOWN:'観測と観測の間の値動きは不明です。',TRADE_LEDGER_UNAVAILABLE:'取引台帳が未取得です。',ENTRY_PERIOD_EVIDENCE_MISSING:'購入日の証拠が不足する取引があります。', 'NET_EVIDENCE_MISSING; TOTAL_NET_UNAVAILABLE':'純損益が欠落する取引があるため、全体の純損益は未算出です。',COSTS_MISSING_OR_ASSUMED:'費用が未記録、または仮定値です。','CONFIG_HASH_UNRECORDED; CONFIGURATION_COMPARABILITY_UNKNOWN':'固定設定ハッシュが未記録です。異なる設定との比較可能性は未確認です。',DATE_FILTER_USES_ENTRY_MARKET_DAY:'日付は購入日の米東部営業日です。','DATE_FILTER_USES_ENTRY_MARKET_DAY; LATE_CLOSURES_REMAIN_WITH_ENTRY_COHORT':'日付は購入日の米東部営業日です。後日の決済も購入日の集計に含みます。',FULL_MARKED_DRAWDOWN_IS_LIFETIME_AND_SEPARATE_FROM_FILTERED_CLOSED_DRAWDOWN:'口座全体の観測DDは累計値です。期間内の決済損益DDと分けます。', 'MISSING_OLD_EVIDENCE_IS_UNAVAILABLE; NO_HISTORY_BACKFILL_OR_COUNTERFACTUAL_FILLS':'過去に欠落した証拠は未取得のままです。価格経路や仮想約定を補完しません。', 'CHRONOLOGICAL_CLOSED_NET; SAME_TIMESTAMP_AGGREGATED; INITIAL_PEAK_NET_ZERO':'決済時刻順の純損益を累計。同時刻の決済は合算し、開始時の累計損益0を高値の起点にします。', 'CURRENT_ACCOUNT_CONFIG_LIFETIME; INCLUDES_OBSERVED_OPEN_MARKS; OUTSIDE_DATE_FILTER':'現在の固定設定の累計。観測した含み損益を含み、選択した期間の外も対象です。'};
performanceNotes['CURRENT_ACCOUNT_CONFIG_LIFETIME; OBSERVED_MARKS_AND_CONSERVATIVE_ZERO_ON_MISSING_QUOTES; OUTSIDE_DATE_FILTER']='現在の固定設定の累計。保有評価を含み、有効な気配がないときは保守的に0で評価します。選択した期間の外も対象です。';
performanceNotes['RECORDED_RUNNING_HIGH_WATER_EQUITY_PERCENT; MISSING_QUOTES_CAN_VALUE_POSITION_AT_ZERO; INTRABAR_PATH_UNKNOWN']='記録した仮想資産の最高値からの下落率。有効な気配がない保有は0で評価する場合があります。観測間の価格経路は不明です。';
const performanceNote=value=>performanceNotes[value]||value||'未記録';
function performanceParagraph(target,text,cls=''){const p=document.createElement('p');p.textContent=text;if(cls)p.className=cls;target.append(p);return p;}
function performanceTable(target,headers,rows){
 const wrap=document.createElement('div'),table=document.createElement('table'),head=document.createElement('thead'),body=document.createElement('tbody'),hr=document.createElement('tr');wrap.className='tableWrap';
 for(const label of headers){const th=document.createElement('th');th.textContent=label;th.scope='col';hr.append(th);}head.append(hr);
 for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);}
 table.append(head,body);wrap.append(table);target.append(wrap);
}
function performanceDetail(target,label){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=label;details.append(summary);target.append(details);return details;}
function performanceCoverage(c){return c?count(c.known)+' / '+count(c.total)+'件（欠落 '+count(c.missing)+'件、記録率 '+performancePct(c.fraction)+'）':'未記録';}
function performanceControls(){
 const connected=paperConnected&&!paperAuthRequired;
 el('performanceLoad').disabled=!connected||paperPerformanceBusy;
 el('performanceExport').disabled=!connected||paperPerformanceBusy||!paperPerformanceSnapshot;
 for(const id of performanceInputs)el(id).disabled=!connected||paperPerformanceBusy;
}
function clearPerformanceReport(message='条件が変わりました。保存記録で成績を更新してください。'){
 paperPerformanceEpoch++;paperPerformanceSnapshot=null;el('performanceReport').replaceChildren();el('performanceStatus').textContent=message;performanceControls();
}
function performanceChoices(id,rows,placeholder){
 const select=el(id),selected=select.value;select.replaceChildren();
 const all=document.createElement('option');all.value='';all.textContent=placeholder;select.append(all);
 for(const [value,label] of rows){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
 if(rows.some(([value])=>value===selected))select.value=selected;
}
function syncPerformanceConfigs(){
 const account=el('performanceAccount').value,choices=new Map();
 for(const [id,a] of Object.entries(paperSnapshot?.accounts||{}))if(!account||id===account){if(a.config_hash)choices.set(a.config_hash,a.config_hash);}
 for(const c of paperPerformanceSnapshot?.cohorts||[])if(!account||c.account_id===account){if(c.config_hash)choices.set(c.config_hash,c.config_hash);}
 if(el('performanceConfig').value)choices.set(el('performanceConfig').value,el('performanceConfig').value);
 performanceChoices('performanceConfig',[...choices],'全設定（ハッシュ別に表示）');
}
function syncPerformanceAccounts(s){
 performanceChoices('performanceAccount',Object.keys(s?.accounts||{}).map(id=>[id,accountLabel(id)]),'全口座（別々に表示）');syncPerformanceConfigs();performanceControls();
}
function performanceMetric(target,label,value,note=''){
 const cell=document.createElement('div'),name=document.createElement('span'),metric=document.createElement('strong');name.textContent=label;metric.textContent=value;cell.append(name,metric);
 if(note){const small=document.createElement('small');small.textContent=note;cell.append(small);}target.append(cell);
}
function showPerformanceFunnel(target,f,coverage){
 const details=performanceDetail(target,'観測・見送り・購入指示・約定の分母');
 const cov=coverage||f?.coverage||{};
 performanceParagraph(details,'保存されている営業日 '+(cov.retained_from||cov.retention?.first_retained_market_date||'未記録')+' ～ '+(cov.retained_to||cov.retention?.last_retained_market_date||'未記録')+'。最大45営業日の保存済み観測を使い、選択期間のすべての分・営業日を観測したことは保証しません。','reportNotice');
 if(!f){performanceParagraph(details,'この期間・設定での観測集計は未記録です。過去の件数をゼロとして補完しません。');return;}
 const counts=f.counts||{},stages={candidate_detection:'購入方向の候補を検出',strategy_evaluation:'戦略条件を評価',contract_acquisition:'契約候補を取得',fresh_quote:'鮮度条件内の気配',paper_signal:'PAPER購入指示'};
 performanceParagraph(details,'対象観測 '+count(f.eligible_observations)+'回 / 全記録観測 '+count(f.total_observations)+'回 / 集計版 '+(f.version||'未記録')+'。決済取引件数とは別です。');
 performanceParagraph(details,'観測範囲 '+when(f.observed_since)+' ～ '+when(f.last_observed_at)+'。保有中・開始前・市場時間外・購入締切後の '+count(f.excluded_observations)+'観測は購入機会の分母から除外します。');
 const denominator=f.eligible_observations;
 const fraction=n=>Number.isSafeInteger(n)&&Number.isSafeInteger(denominator)&&denominator>0?n/denominator:null;
 performanceTable(details,['観測した段階','充足した観測','未評価・不明','対象観測に対する割合','分母'],Object.entries(stages).map(([key,label])=>[label,count(counts[key]),count(f.stage_unknown?.[key]),performancePct(fraction(counts[key])),count(denominator)+'観測']));
 performanceParagraph(details,'段階は同じ対象観測から個別に数えます。候補→契約→約定を必ず順に通過したという推定ではありません。');
 const signals=counts.paper_signal,fillRate=Number.isSafeInteger(signals)&&signals>0&&Number.isSafeInteger(counts.paper_fill)?counts.paper_fill/signals:null;
 performanceParagraph(details,'購入指示 '+count(signals)+'件 / PAPER購入約定 '+count(counts.paper_fill)+'件 / 未約定終了 '+count(counts.unfilled)+'件。購入約定率 '+performancePct(fillRate)+'（分母：購入指示 '+count(signals)+'件）。待機中の指示は約定・未約定終了のどちらにもまだ含みません。');
 performanceTable(details,['判定区分','観測数','対象観測に対する割合','分母'],Object.entries(f.categories||{}).map(([key,n])=>[performanceCategory[key]||key,count(n),performancePct(f.category_rates?.[key]),count(denominator)+'観測']));
 if(Object.keys(f.reasons||{}).length)performanceTable(details,['主な理由','記録数'],Object.entries(f.reasons).map(([reason,n])=>[reasonText(reason),count(n)]));
 if(f.coverage)performanceParagraph(details,'この集計は新しい保存記録からの集計です。以前の欠落記録は補完しません。');
 if(Object.keys(f.excluded_reasons||{}).length)performanceTable(details,['分母から除外した理由（重複あり）','観測数'],Object.entries(f.excluded_reasons).map(([reason,n])=>[reasonText(reason),count(n)]));
}
function showPerformanceExecution(target,execution){
 const details=performanceDetail(target,'取得・判断・約定の実測遅延');
 const names={source_to_received:'判断に使った気配の元時刻→受信',received_to_decision:'受信→売買判断',decision_to_fill:'売買判断→PAPER約定',decision_to_ready_after:'判断→設定された待機期限',ready_after_to_fill:'待機期限→PAPER約定',fill_source_to_received:'約定に使った気配の元時刻→受信',fill_received_to_fill:'約定気配の受信→PAPER約定',fill_to_commit_input:'PAPER約定→保存入力時刻'};
 const rows=[];
 for(const [side,label] of [['entry','購入'],['exit','決済']])for(const [stage,name] of Object.entries(names)){
  const m=execution?.[side]?.[stage];rows.push([label+' '+name,count(m?.samples)+' / '+count(m?.total_rows),performanceSeconds(m?.mean_seconds),performanceSeconds(m?.p50_seconds),performanceSeconds(m?.p95_seconds),performanceSeconds(m?.max_seconds),count(m?.missing),count(m?.invalid_timestamps),count(m?.invalid_chronology),performancePct(m?.coverage)]);
 }
 performanceTable(details,['区間','実測 / 対象記録','平均','中央値','95%点','最大','時刻欠落','時刻不正','時系列不正','記録率'],rows);
 performanceParagraph(details,'購入は保存済み決済取引と現在の保有・購入待ち、決済は決済済み取引が対象です。区間ごとの対象記録数を分母にし、欠落・不正な時刻を0秒で補完しません。保存入力時刻は永続保存の完了確認とは別です。');
}
function showPerformanceScore(target,study){
 const details=performanceDetail(target,'スコア帯・VIXY有無の保存済み比較');
 performanceParagraph(details,'スコアは方向条件の一致数です。80点は勝率80%を意味しません。VIXYはボラティリティ先物ETFの代理指標で、VIX指数そのものではありません。');
 if(!study){performanceParagraph(details,'候補のスコア・VIXY比較は未記録です。旧取引に現在のスコアを当てはめません。見送った候補の将来損益も未確認です。');return;}
 const t=study.totals||{},paired=t.paired_observations;
 if(study.totals==null)performanceParagraph(details,'この期間の購入候補・見送り候補の観測は未記録です。未観測を0件として集計しません。','reportNotice');
 const coverage=study.coverage||{};
 performanceParagraph(details,'候補観測の保存範囲 '+(coverage.retained_first_date||'未記録')+' ～ '+(coverage.retained_last_date||'未記録')+' / 保存上限 '+count(coverage.retained_cohort_limit)+'営業日・設定の組合せ / 保存範囲から除外済み '+count(coverage.dropped_cohorts)+'組。選択期間の欠落日は件数不明です。','muted');
 const ratio=n=>Number.isSafeInteger(n)&&Number.isSafeInteger(paired)&&paired>0?n/paired:null;
 performanceParagraph(details,'比較版 '+(study.version||'未記録')+' / 両案の購入閾値 '+count(study.threshold)+'点 / 保有なしの対象観測 '+count(t.observations)+'回 / 同じ契約・実行条件で比較可能 '+count(paired)+'回');
 performanceTable(details,['同じ契約での比較案','購入候補条件を満たす観測','割合','共通の分母'],[['実際に観測したVIXY項目を含む80点条件',count(t.as_observed_would_buy),performancePct(ratio(t.as_observed_would_buy)),count(paired)+'観測'],['VIXYの採点項目を除いた80点条件',count(t.without_vixy_would_buy),performancePct(ratio(t.without_vixy_would_buy)),count(paired)+'観測']]);
 performanceParagraph(details,'この表は購入候補判断を比較します。口座の資金・損失・保有による購入制限は別に判定するため、実際の購入指示・約定とは別の件数です。');
 performanceParagraph(details,'VIXYを含む場合だけ購入候補になった '+count(t.vixy_adds_buy)+'観測 / 両案で候補 '+count(t.unchanged_buy)+'観測 / 通常版で見送った '+count(t.baseline_rejected_observations)+'観測。見送り候補の将来価格・損益は未確認です。');
 const observationRows=[];
 for(const c of study.cohorts||[])for(const [score,n] of Object.entries(c.score_band_observations||{}))observationRows.push([c.market_date||'未記録',score+'点',count(n),count(c.score_band_rejected_observations?.[score]),count(c.observations)+'観測']);
 if(observationRows.length)performanceTable(details,['営業日','通常版の方向スコア','候補を含む観測','通常版の見送り観測','観測の分母'],observationRows);
 const metrics=(key,m)=>[key,count(m.samples),m.samples>0?performancePct(m.win_rate):'未算出',m.samples>0?performanceUSD(m.net):'未算出',performanceUSD(m.average_net),performanceUSD(m.average_profit),performanceUSD(m.average_loss),performanceUSD(m.max_realized_drawdown_usd)];
 if(Object.keys(study.score_bands||{}).length){performanceParagraph(details,'以下は実際に決済した取引の保存済み購入スコアです。上の通常版候補の観測スコアと分けます。');performanceTable(details,['実購入のスコア帯','決済件数・勝率の分母','勝率','費用込み純損益','平均純損益','平均利益','平均損失','決済損益DD'],Object.entries(study.score_bands).map(([key,m])=>metrics(key==='NOT_USED'?'独立版：点数を使用せず':key==='UNKNOWN'?'未記録':key+'点',m)));}
 const vixyNames={SUPPORTS_ENTRY:'購入方向の採点条件を充足',DOES_NOT_SUPPORT_ENTRY:'購入方向の採点条件未達',MISSING:'値または元時刻が未取得',STALE:'元データが古い',FUTURE:'元時刻が未来',UNKNOWN:'記録不足'};
 if(Object.keys(study.vixy_groups||{}).length)performanceTable(details,['購入時のVIXY証拠','決済件数・勝率の分母','勝率','費用込み純損益','平均純損益','平均利益','平均損失','決済損益DD'],Object.entries(study.vixy_groups).map(([key,m])=>metrics(vixyNames[key]||key,m)));
 if(study.variants_actual_trade_associations){performanceParagraph(details,'次の表は実際の購入と同じ決済結果に対応する部分集合です。見送り価格の補完や、資金拘束・次の購入機会を含む仮想口座の比較は行っていません。');performanceTable(details,['実際の取引と対応する候補案','決済件数・勝率の分母','勝率','費用込み純損益','平均純損益','平均利益','平均損失','決済損益DD'],Object.entries(study.variants_actual_trade_associations).map(([key,m])=>metrics(key==='AS_OBSERVED'?'観測どおりの80点候補':key==='WITHOUT_VIXY_80'?'VIXY採点を除いた80点候補':key,m)));}
 performanceParagraph(details,'購入時の比較証拠が欠落する決済 '+count(study.missing_entry_evidence_trades)+'件 / 対象の実際の決済 '+count(study.selected_actual_trades)+'件。選ばれた取引の比較からVIXYの利益への因果効果は推定できません。決済損益DDは口座全体のDDとは別です。');
 if(study.limitations)for(const note of study.limitations)performanceParagraph(details,note);
}
function performancePairedExit(target,c,filters){
 const details=performanceDetail(target,'同じ期間・固定設定のExit比較2');
 performanceParagraph(details,'同じ購入から出口だけを比べます。経路が完全に観測できた組と、候補個別の不完全な記録を分けます。');
 const button=document.createElement('button'),status=document.createElement('p'),results=document.createElement('div');button.textContent='この期間・設定のExit比較2を読む';button.disabled=!c.config_hash;status.textContent=c.config_hash?'保存済み記録を読み込めます。候補の自動採用はOFFです。':'固定設定ハッシュが未記録のため、同じ設定の比較を特定できません。';status.setAttribute('role','status');details.append(button,status,results);
 let busy=false;
 button.addEventListener('click',async()=>{
  if(busy||!paperConnected||!c.config_hash)return;busy=true;button.disabled=true;const epoch=paperPerformanceEpoch;
  const query=new URLSearchParams({account:c.account_id,config_hash:c.config_hash});if(filters.from_date)query.set('from',filters.from_date);if(filters.to_date)query.set('to',filters.to_date);
  status.textContent='同じ期間・設定の保存済み比較を読み込み中…';
  try{const data=await request('exit-study-v2?'+query);if(epoch!==paperPerformanceEpoch||!paperConnected)return;showExitStudy(data,'V2',{root:results,status});}
  catch(e){if(e.stalePaperRequest||epoch!==paperPerformanceEpoch)return;status.textContent=e.message;}
  finally{busy=false;button.disabled=!paperConnected;}
 });
}
function showPerformance(data){
 const target=el('performanceReport');target.replaceChildren();
 const filters=data.filters||{};
 performanceParagraph(target,'購入日（米東部） '+(filters.from_date||'記録開始')+' ～ '+(filters.to_date||'最新')+' / 集計作成 '+when(data.generated_at)+' / 元記録の更新 '+when(data.updated_at)+' / 集計版 '+(data.version||'未記録'));
 if(data.coverage)performanceParagraph(target,'購入日が未記録の取引 '+count(data.coverage.unknown_entry_period_records)+'件 / 固定設定ハッシュが未記録の取引 '+count(data.coverage.unknown_config_records)+'件。購入日不明の取引は、日付を指定した期間には振り分けません。','muted');
 if(!Array.isArray(data.cohorts)||!data.cohorts.length){performanceParagraph(target,'指定した期間・口座・固定設定に対応する保存記録がありません。損益がゼロだったとは判断しません。','reportNotice');}
 for(const c of data.cohorts||[]){
  const card=document.createElement('article');card.className='performanceCohort';const title=document.createElement('h3');title.textContent=accountLabel(c.account_id);card.append(title);
  performanceParagraph(card,'戦略 '+(strategyLabels[c.strategy]||c.strategy||'未記録')+' / 固定設定 '+(c.config_hash||'未記録'),'reportHash');
  const m=c.closed||{},o=c.open||{},dd=c.drawdown||{},metrics=document.createElement('div');metrics.className='reportMetrics';
  performanceMetric(metrics,'決済済み / 未決済',count(m.count)+' / '+count(o.count),'購入待ち '+count(o.pending_entry_count)+'件・決済待ち '+count(o.pending_exit_count)+'件・未解決 '+count(o.unresolved_count)+'件');
  performanceMetric(metrics,'勝ち / 負け / 引分け',count(m.wins)+' / '+count(m.losses)+' / '+count(m.draws),'費用込み純損益で分類。損益既知の部分：'+count(m.known_wins)+'勝・'+count(m.known_losses)+'敗・'+count(m.known_draws)+'引分け');
  performanceMetric(metrics,'勝率',performancePct(m.win_rate),'分母：損益記録のある決済 '+count(m.win_rate_denominator)+'件');
  performanceMetric(metrics,'費用込み純損益',performanceUSD(m.net_usd),'純損益の記録 '+performanceCoverage(m.net_coverage));
  performanceMetric(metrics,'平均利益 / 平均損失',performanceUSD(m.average_win_usd)+' / '+performanceUSD(m.average_loss_usd),'分母：純損益が既知の勝ち '+count(m.known_wins)+'件 / 負け '+count(m.known_losses)+'件');
  performanceMetric(metrics,'1決済あたりの平均純損益',performanceUSD(m.average_net_usd),'分母：損益記録のある決済 '+count(m.win_rate_denominator)+'件。期待利益の予測ではありません。');
  performanceMetric(metrics,'利益係数（PF）',performanceNumber(m.profit_factor)?m.profit_factor.toFixed(2):m.profit_factor_status==='NO_LOSSES'?'損失なし・未定義':'未算出','費用込みの利益合計 ÷ 損失合計の絶対値');
  performanceMetric(metrics,'損益分岐の勝率',performancePct(m.breakeven_win_rate),'平均損失の絶対値 ÷（平均利益＋平均損失の絶対値 '+performanceUSD(m.breakeven_denominator_usd)+'）。引分けを除外。片方が未記録なら未算出。');
  performanceMetric(metrics,'決済純損益からの最大DD',performanceUSD(dd.realized_closed_usd)+' / '+(performanceNumber(dd.realized_closed_pct)?dd.realized_closed_pct.toFixed(2)+'%':'未算出'),'DD%の分母：この固定設定の記録済み開始資金 '+performanceUSD(dd.initial_capital_usd)+'。未決済の値動きは除外。');
  performanceMetric(metrics,'決済費用',performanceUSD(m.fees_usd),'費用記録 '+performanceCoverage(m.fee_coverage));card.append(metrics);
  performanceParagraph(card,'標本の状態 '+performanceNote(c.sample?.status)+' / 取引日 '+count(m.trading_days)+'日。少ない標本では収益性を確定できません。','reportNotice');
  for(const note of c.sample?.cautions||[])performanceParagraph(card,performanceNote(note),'reportNotice');
  const quality=performanceDetail(card,'欠落記録・含み損益・ドローダウンの計算方法');
  const list=document.createElement('dl');lineList(list,[['純損益記録',performanceCoverage(m.net_coverage)],['既知の部分だけの純損益',performanceUSD(m.known_net_usd)+'（欠落がある場合は全体の純損益と区別）'],['費用記録',performanceCoverage(m.fee_coverage)],['含み損益',performanceUSD(o.unrealized_usd)+'（勝率・決済純損益から除外）'],['含み損益の評価時刻',when(o.mark_at)],['DDの計算方法',performanceNote(dd.method)],['DDの開始資金',performanceUSD(dd.initial_capital_usd)],['口座全体の観測DD',performanceNumber(dd.full_marked_pct)?dd.full_marked_pct.toFixed(2)+'%':'未記録'],['口座全体DDの対象範囲',performanceNote(dd.full_marked_scope)],['口座全体DDの計算方法',performanceNote(dd.full_marked_method)]]);quality.append(list);
  if(c.missing){const missing=document.createElement('dl');lineList(missing,[['取引台帳',c.missing.ledger_available===true?'取得済み':c.missing.ledger_available===false?'未取得':'未確認'],['保有状態の記録',c.missing.position_evidence_available===true?'取得済み':c.missing.position_evidence_available===false?'未取得':'未確認'],['損益の欠落',count(c.missing.net)+'件'],['費用の欠落',count(c.missing.fees)+'件'],['決済時刻の欠落',count(c.missing.closed_time)+'件'],['固定設定ハッシュの欠落',count(c.missing.config_hash)+'件'],['段階別観測の記録',c.missing.entry_stage_funnel==='FORWARD_RECORDED'?'新しい保存記録から集計':c.missing.entry_stage_funnel==='UNRECORDED'?'未記録':'未確認'],['現口座累計の観測記録エラー',count(c.missing.entry_telemetry_errors)+'件'],['観測記録エラーの最終時刻',when(c.missing.last_entry_telemetry_error_at)],['現口座累計のスコア比較記録エラー',count(c.missing.score_study_errors)+'件']]);quality.append(missing);performanceParagraph(quality,'記録エラー数は現在の固定設定の口座累計で、選択した期間の外も含みます。過去の設定・期間ごとの失敗数には振り分けず、未記録を0件に置き換えません。');}
  showPerformanceFunnel(card,c.entry_funnel,c.entry_funnel_coverage);showPerformanceExecution(card,c.execution);showPerformanceScore(card,c.score_study);
  showExitOutcomeEvidence(card,'実際のPAPER決済',c.exit_outcomes,'この期間・固定設定の公式PAPER記録');performancePairedExit(card,c,filters);
  if(c.cumulative?.length){const timeline=performanceDetail(card,'決済順の記録済み純損益');performanceTable(timeline,['決済時刻','純損益','累計純損益','決済だけの仮想資産'],c.cumulative.map(p=>[when(p.closed_at),performanceUSD(p.net_usd),performanceUSD(p.cumulative_net_usd),performanceUSD(p.equity_usd)]));}
  target.append(card);
 }
 for(const note of data.limitations||[])performanceParagraph(target,performanceNote(note),'muted');
}
async function loadPerformance(){
 if(!paperConnected||paperAuthRequired||paperPerformanceBusy)return;
 const from=el('performanceFrom').value,to=el('performanceTo').value;
 if((from&&!/^\d{4}-\d{2}-\d{2}$/.test(from))||(to&&!/^\d{4}-\d{2}-\d{2}$/.test(to))||(from&&to&&from>to)){el('performanceStatus').textContent='開始日と終了日の範囲を確認してください。';return;}
 const query=new URLSearchParams();if(from)query.set('from',from);if(to)query.set('to',to);
 if(el('performanceAccount').value)query.set('account_id',el('performanceAccount').value);
 if(el('performanceConfig').value)query.set('config_hash',el('performanceConfig').value);
 const epoch=++paperPerformanceEpoch;paperPerformanceSnapshot=null;paperPerformanceBusy=true;el('performanceReport').replaceChildren();el('performanceStatus').textContent='保存済みの期間別成績を読み込み中…';performanceControls();
 try{const data=await request('performance'+(query.size?'?'+query:''));if(epoch!==paperPerformanceEpoch||!paperConnected)return;paperPerformanceSnapshot=data;showPerformance(data);syncPerformanceConfigs();el('performanceStatus').textContent='保存記録の成績を取得しました。購入条件・資金・損失制限は変更していません。';}
 catch(e){if(e.stalePaperRequest||epoch!==paperPerformanceEpoch)return;el('performanceStatus').textContent=e.message;}
 finally{paperPerformanceBusy=false;performanceControls();}
}
for(const id of performanceInputs)el(id).addEventListener('change',()=>{clearPerformanceReport();if(id==='performanceAccount')syncPerformanceConfigs();});
el('performanceLoad').addEventListener('click',loadPerformance);
el('performanceExport').addEventListener('click',()=>{
 if(!paperPerformanceSnapshot||!paperConnected)return;
 const url=URL.createObjectURL(new Blob([JSON.stringify(paperPerformanceSnapshot,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='paper-performance.json';a.click();URL.revokeObjectURL(url);
});
window.addEventListener('pagehide',()=>{clearPerformanceReport('画面を再接続して成績を読み込んでください。');});
// Default dates use trading-calendar dates in US Eastern time, not the browser zone.
const reportToday=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
el('performanceTo').value=reportToday;el('performanceFrom').value=new Date(Date.parse(reportToday+'T12:00:00Z')-29*86400000).toISOString().slice(0,10);performanceControls();
