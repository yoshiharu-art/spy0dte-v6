/* Public news monitor: DOM text only, source times, no order submission. */
(()=>{
 'use strict';
 const categories={EMPLOYMENT:'雇用統計',CPI:'消費者物価',PPI:'生産者物価',GDP:'GDP',PCE:'個人消費',JOLTS:'求人',EMPLOYMENT_COST:'雇用コスト',PRODUCTIVITY:'生産性',IMPORT_EXPORT:'輸出入物価',FOMC_STATEMENT:'FOMC',FOMC_MINUTES:'FOMC議事録',FOMC_PRESS_CONFERENCE:'FRB会見',GEOPOLITICS:'地政学',SYSTEMIC_CRISIS:'金融危機',MARKET_CONTEXT:'市場関連',OTHER:'一般'};
 const names={BLS:'BLS直接',FRED_BLS:'米統計予定（セントルイス連銀）',BEA:'BEA予定',BEA_NEWS:'BEA発表',FED_NEWS:'FRB発表',FED_SPEECHES:'FRB講演',FED_TESTIMONY:'FRB証言',FED_SCHEDULE:'FRB予定',BBC_WORLD:'BBC世界',BBC_BUSINESS:'BBC経済',GUARDIAN_WORLD:'Guardian世界',GUARDIAN_BUSINESS:'Guardian経済',BLS_EMPLOYMENT:'BLS雇用',BLS_CPI:'BLS物価',BLS_PPI:'BLS生産者物価',BREAKING:'Marketaux（再発行待ち）'};
 const stamp=at=>{const d=new Date(at);return Number.isFinite(d.getTime())?d.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false})+' 日本時間':'未取得';};
 const text=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value;};
 const el=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n;};
 function link(url,title){
   const a=el('a',title);a.style.color='var(--blue)';
   try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password){a.href=u.href;a.target='_blank';a.rel='noopener noreferrer';}}
   catch(_){}
   return a;
 }
 let lastRenderKey='',root;
 function ensure(){
   if(root)return;
   const card=document.getElementById('newsCard');if(!card)return;
   root=el('div');root.style.marginTop='12px';root.style.fontSize='12px';root.style.lineHeight='1.7';
   root.append(el('div','公開配信は遅延・抜けがあります。未確認を「ニュースなし」に置き換えません。','small warn'));
   const comparison=el('div');comparison.id='newsComparisonResult';comparison.style.margin='10px 0';root.append(comparison);
   const schedule=el('div');schedule.id='newsUpcoming';root.append(schedule);
   const headlines=el('details');headlines.append(el('summary','取得した見出し（直近24時間）'));
   const list=el('div');list.id='newsHeadlines';headlines.append(list);root.append(headlines);
   const details=el('details');details.style.marginTop='10px';details.append(el('summary','配信元と更新状態'));
   const sources=el('div');sources.id='newsSources';details.append(sources);root.append(details);
   const footer=el('div',undefined,'small');footer.style.marginTop='10px';
   footer.append(link('https://spy0dte-live-backend-v2.vercel.app/api/news_history','直近の自動監視履歴を見る'));
   root.append(footer);card.append(root);
 }
 function render(m,comparison){
   ensure();if(!root)return;
   const expired=!m?.guard?.validUntil||Date.parse(m.guard.validUntil)<=Date.now()||Date.parse(m.guard.checkedAt)>Date.now()+5000;
   const g=expired?{title:'ニュース状態を更新中・期限切れ',lock:true,availability:'UNAVAILABLE'}:m.guard;
   text('newsLevel',g.lock?'新規購入 停止':'警戒・速報は一部監視');
   text('newsEvent',g.title);text('newsPhase',g.phase||'更新待ち');
   text('newsSource',m?'自動収集 '+stamp(m.checkedAt):'取得待ち');
   text('newsCountdown',g.minutes==null?'--':(g.minutes>=0?'T−':'T＋')+Math.ceil(Math.abs(g.minutes))+'分');
   text('newsLockText',g.lock?'重要ニュース・取得不足により購入待機':'公開RSSによる監視。ニュース込みのBUY許可は出しません。');
   document.getElementById('newsCard').className='card news-card '+(g.level==='HIGH'?'high':'medium');
   document.getElementById('newsLevel').className='news-level '+(g.lock?'bad':'warn');
   document.getElementById('newsLockText').className='news-lock '+(g.lock?'bad':'warn');
   const cmp=applyComparison({decision:comparison?.baseDecision||'未判定',reasons:[]},comparison,new Date().toISOString(),0);
   text('newsComparisonResult',comparison?'価格条件：'+comparison.baseDecision+' → ニュース考慮：'+cmp.decision+'（自動仮想口座は従来条件）':'ニュース考慮判定：価格データ待ち');
   const key=JSON.stringify([m?.checkedAt,expired]);if(lastRenderKey===key)return;lastRenderKey=key;
   const upcoming=document.getElementById('newsUpcoming');upcoming.replaceChildren(el('strong','次の重要発表'));
   const schedule=(m?.upcoming||[]).slice(0,5);
   if(!schedule.length)upcoming.append(el('div','予定の取得待ち・14日以内の対象なし','small warn'));
   for(const e of schedule){const item=el('div');item.style.margin='5px 0';item.append(el('div',stamp(e.at)+' · '+(categories[e.category]||e.category)));item.append(link(e.url,e.title));if(e.source==='FRED_BLS')item.append(el('span',' ［連銀経由］','small'));upcoming.append(item);}
   const head=document.getElementById('newsHeadlines');head.replaceChildren();
   for(const e of (m?.headlines||[]).slice(0,12)){const item=el('div');item.style.margin='9px 0';item.append(el('div',stamp(e.published_at||e.at)+' · '+(names[e.source]||e.source)+' · '+(categories[e.category]||e.category),'small'));item.append(link(e.url,e.title));head.append(item);}
   if(!head.childElementCount)head.append(el('div','直近24時間の取得済み見出しなし（配信状態は下で確認）','small'));
   const sources=document.getElementById('newsSources');sources.replaceChildren();
   for(const [name,h] of Object.entries(m?.sources||{})){const line=el('div');line.style.margin='5px 0';line.append(el('span',(h.fresh?'● ':'△ ')+(names[name]||name)+'：'+(h.fresh?'取得済み':h.status==='NOT_CONFIGURED'?'未接続':'未取得・期限切れ'),h.fresh?'good':'warn'));line.append(el('div','最終成功 '+stamp(h.lastSuccessAt)+(h.errorCode?' / '+h.errorCode:''),'small'));sources.append(line);}
   if(m?.scheduleSource==='FRED_BLS')sources.prepend(el('div','BLS直接取得の代わりに、セントルイス連銀の日程を使用しています。','small warn'));
 }
 function applyComparison(base,comparison,serverTime,elapsed=0){
   const result={...base,reasons:[...(base.reasons||[])]};
   if(!['CALL BUY','PUT BUY','WATCH'].includes(base.decision))return result;
   const valid=Date.parse(comparison?.validUntil),server=Date.parse(serverTime);
   if(!comparison||comparison.baseDecision!==base.decision||!Number.isFinite(valid)||!Number.isFinite(server)||!Number.isFinite(elapsed)||elapsed<0||server+elapsed*1000>=valid){result.decision='NO TRADE';result.reasons.push('ニュース考慮判定の取得待ち・期限切れ');return result;}
   if(!['CALL BUY','PUT BUY','WATCH','NO TRADE','DATA ERROR'].includes(comparison.decision)||comparison.decision.endsWith(' BUY')&&comparison.decision!==base.decision){result.decision='NO TRADE';result.reasons.push('ニュース判定の整合性未確認');return result;}
   result.decision=comparison.decision;result.reasons=[...(comparison.reasons||[])];return result;
 }
 window.NewsUI={render,applyComparison};
})();
