const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),cp=require('node:child_process');
const html=fs.readFileSync('index.html','utf8');
function load(html){
 let script=html.match(/<script>([\s\S]*?)<\/script>/)[1];script=script.slice(0,script.lastIndexOf('render();renderLogs();'));
 const els=new Map(),opens=[];let clock=Date.parse('2026-09-24T17:00:00Z');
 class Clock extends Date{static now(){return clock}}
 const ctx=vm.createContext({structuredClone,Intl,URL,Date:Clock,Number,Math,JSON,AbortSignal,performance:{now:()=>clock},
 setInterval:()=>0,clearInterval(){},setTimeout:()=>0,clearTimeout(){},navigator:{clipboard:{writeText:async()=>{}}},
 window:{open:(...a)=>opens.push(a)},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
 document:{getElementById(id){if(!els.has(id))els.set(id,{textContent:'',innerHTML:'',disabled:false,classList:{add(){},remove(){},toggle(){}}});return els.get(id)}}});
 vm.runInContext(script,ctx);
 if(html.includes('src="./news-ui.js"')){vm.runInContext(fs.readFileSync('news-ui.js','utf8'),ctx);ctx.window.NewsUI.render=()=>{};}
 return {ctx,opens,els,tick:n=>{clock+=n},run:s=>vm.runInContext(s,ctx)};
}
const x=load(html),old=load(cp.execFileSync('git',['show','d7e26db8d861073e838ea87847c49baf260de0a6:index.html'],{encoding:'utf8'}));
// Preserve strategy formulas. Position input-validation fixes have behavioral tests below.
for(const n of ['directionChecks','deltaRange','sideScore','positionCore','profitFloor','confirmPaperExit','manualPaperExit'])assert.equal(x.ctx[n].toString(),old.ctx[n].toString(),n);
assert.equal(x.ctx.evaluateBase.toString().replace('function evaluateBase','function evaluate').replace("||news.availability==='OFF'",''),old.ctx.evaluate.toString());
assert.equal(x.run('state.spy'),undefined,'startup must not show a demo price');
assert.equal(x.run('evaluate(state).decision'),'取得中');
x.run('render(false)');
assert.equal(x.els.get('webullBtn').disabled,true,'loading must never enable a purchase');
assert.equal(x.els.get('modeBadge').textContent,'初回データ取得中');
assert.match(x.els.get('decision').className,/warn/);
x.run('state={}');
assert.equal(x.run('evaluate(state).decision'),'DATA ERROR','a real failed request remains an error');
x.run("runtimeConfig={newsMode:'OFF',autoTrade:false};");
assert.equal(x.run('getNewsRisk(state).level'),'UNKNOWN');
assert.equal(x.run('getNewsRisk(state).title'),'突発ニュース未確認');
x.run("state={...structuredClone(scenarios.buy),_mock:true};");
assert.equal(x.run('evaluate(state).decision'),'PUT BUY');
assert.equal(x.run('openWebull()'),false,'simulation cannot open a purchase link');
x.run(`state={...scenarios.buy,ok:true,dataMode:'LIVE',provider:'Webull OpenAPI',environment:'prod',newsMode:'OFF',
 realtimeVerified:true,marketHalted:false,instrumentId:'SYNTHETIC',contractMultiplier:100,multiplierSource:'SYNTHETIC',askSize:10,barsValid:true,
 serverTime:new Date(Date.now()).toISOString(),fetchedAt:new Date(Date.now()).toISOString(),
 spyPriceAt:new Date(Date.now()-100).toISOString(),spyQuoteAt:new Date(Date.now()-100).toISOString(),optionQuoteAt:new Date(Date.now()-100).toISOString(),
 barAt:new Date(Date.now()-60000).toISOString(),volPriceAt:new Date(Date.now()-20000).toISOString(),
 _receivedAt:Date.now(),_receivedMono:performance.now(),_roundTripMs:100,optionSymbol:'SPY260924P00667000',expiration:'2026-09-24',
 signal:{decision:'PUT BUY',side:'PUT',score:100,reasons:['unit fixture'],decisionAt:new Date(Date.now()).toISOString(),validUntil:new Date(Date.now()+1900).toISOString()}};`);
assert.equal(x.run('evaluate(state).decision'),'NO TRADE','missing news comparison fails closed');
// Synthetic complete permission isolates the existing price/cutoff tests. The public RSS backend never emits this BUY.
x.run("state.newsComparison={baseDecision:'PUT BUY',decision:'PUT BUY',reasons:['synthetic complete test permission'],validUntil:state.signal.validUntil}");
assert.equal(x.run('evaluate(state).decision'),'PUT BUY');
x.run('render(false)');assert.equal(x.els.get('webullBtn').disabled,false);
assert.equal(x.run('openWebull()'),true);assert.equal(x.opens.length,1);
assert.equal(x.opens[0][0],'https://www.webull.co.jp/ticker/nysearca-spy');
assert.match(x.run('contractText()'),/2026-09-24/);assert.match(x.run('contractText()'),/PUT/);
const validBuyFixture=x.run('JSON.stringify(state)');
for(const change of ["state.newsComparison=null","state.newsComparison.decision='WATCH'","state.newsComparison.decision='NO TRADE'","state.newsComparison.decision='CALL BUY'","state.newsComparison.validUntil=state.serverTime"]){
 const news=load(html);news.run("runtimeConfig={newsMode:'OFF'};state="+validBuyFixture);news.run(change);
 assert(!news.run('evaluate(state).decision').includes('BUY'),change);assert.equal(news.run('openWebull()'),false,change);
}
const missingModule=load(html);missingModule.run("runtimeConfig={newsMode:'OFF'};state="+validBuyFixture+";window.NewsUI=null");
assert.equal(missingModule.run('evaluate(state).decision'),'NO TRADE','missing module fails closed');
// Even an old server's BUY/30-minute deadline cannot bypass the 60-minute rule.
const cutoff=load(html);cutoff.run("runtimeConfig={newsMode:'OFF'};state="+x.run('JSON.stringify(state)'));
for(const [minutes,expected] of [[61,'PUT BUY'],[60,'NO TRADE'],[59,'NO TRADE']]){
 cutoff.run('state.minutesToClose='+minutes);
 assert.equal(cutoff.run('evaluate(state).decision'),expected);
 if(minutes<=60){assert.equal(cutoff.run('openWebull()'),false);cutoff.run('render(false)');assert.equal(cutoff.els.get('webullBtn').disabled,true);}
}
cutoff.run("state.minutesToClose=60.01;state.marketSession={closesAt:new Date(Date.now()+3600600).toISOString(),entryEndsAt:new Date(Date.now()+1800600).toISOString()}");
assert.equal(cutoff.run('evaluate(state).decision'),'PUT BUY');
cutoff.tick(600);assert.equal(cutoff.run('evaluate(state).decision'),'NO TRADE','fresh BUY expires at the cutoff between polls');
cutoff.run("state.minutesToClose=null;state.marketSession={}");assert.equal(cutoff.run('evaluate(state).decision'),'NO TRADE','unknown deadline fails closed');
x.tick(2000);
assert.equal(x.run('evaluate(state).decision'),'NO TRADE');
assert.equal(x.run('openWebull()'),false);assert.equal(x.opens.length,1);
x.run('render(false)');assert.equal(x.els.get('webullBtn').disabled,true);
// Expiration follows monotonic elapsed time even if the wall clock is changed.
x.run('state._receivedAt=Date.now()+100000');assert.equal(x.run('evaluate(state).decision'),'NO TRADE');
x.run("runtimeConfig={newsMode:'ON'};window.newsSnapshot=null;");assert.equal(x.run('getNewsRisk(state).lock'),true);
x.run(`position={active:true,entryTs:Date.now(),entryAsk:1,currentBid:1,peakBid:1,lowBid:1,side:'PUT',strike:667,expiration:'TODAY',thesisBreakCount:0};`);
const before=x.run('JSON.stringify(position)');x.run('render(false);render(false)');assert.equal(x.run('JSON.stringify(position)'),before);
assert(!html.slice(0,html.indexOf('<script>')).includes('>PUT BUY<'));
console.log('PASS: preserved V6.4 core/position functions; live/off/on, no dummy startup, stale expiry, Webull contract/link, mock isolation.');

// Live diagnostics use each source timestamp, not the aggregate/receipt age.
x.run("runtimeConfig={newsMode:'OFF'};state={...state,newsMode:'OFF',realtimeVerified:false,marketHalted:null,_receivedAt:Date.now(),_receivedMono:performance.now(),serverTime:new Date(Date.now()).toISOString(),volPriceAt:new Date(Date.now()-230000).toISOString(),age:0.1};render(false)");
assert.match(x.els.get('vixAge').textContent,/230/);
assert.equal(x.els.get('vixAge').textContent,'最終約定 230.1秒前');
assert.match(x.run("evaluate(state).blocks.join(' / ')"),/VIXY最終約定：230/);
assert.match(x.els.get('paperReadiness').textContent,/リアルタイム資格未確認/);
assert.match(x.els.get('paperReadiness').textContent,/取引停止状態未確認/);
x.run("state.marketSession={open:false,calendarReady:true};state.timeBand='CLOSED';state.connection='CONNECTED';render(false)");
assert.match(x.els.get('connectionStatus').textContent,/市場時間外・参考表示/);
assert(!x.run("JSON.stringify(evaluate(state).reasons)").includes('上限2秒'));
assert(!x.run("JSON.stringify(evaluate(state).reasons)").includes('Quote ≤'));
x.run("state={...state,marketSession:{open:true,calendarReady:true},timeBand:'MID',signal:{...state.signal,decision:'CALL BUY',side:'CALL',validUntil:new Date(Date.now()+10000).toISOString()},side:'CALL'}");
assert.equal(x.run('evaluate(state).decision'),'NO TRADE','bad live timestamps cannot be overridden by BUY');
assert.equal(x.run('openWebull()'),false);
console.log('PASS: per-source freshness, expired BUY blocks, closed-market reference display, PAPER prerequisites, no stale legacy quote labels.');

// Published BUY cannot bypass verified trading evidence or signed Delta.
const integrity=load(html);
const reset=()=>integrity.run("runtimeConfig={newsMode:'OFF'};state="+validBuyFixture+";position=null");
for(const change of ['realtimeVerified=false','marketHalted=null','marketHalted=true','askSize=0','contractMultiplier=null','delta=.34']){
 reset();integrity.run('state.'+change);assert(!integrity.run('evaluate(state).decision').includes('BUY'),change);
 assert.equal(integrity.run('openWebull()'),false,change);
}
function held(){reset();integrity.run("position={active:true,dataMode:'LIVE',optionSymbol:state.optionSymbol,side:'PUT',strike:667,expiration:state.expiration,entryTs:Date.now(),entryAsk:1,currentBid:.7,peakBid:.7,lowBid:.7,thesisBreakCount:0};");}
for(const bad of ['null','undefined','NaN','-1']){
 held();integrity.run('state.bid='+bad);const p=integrity.run('updatePositionFromState()');
 assert.equal(p.matched,false);assert.equal(p.decision,'QUOTE WAIT');assert.equal(p.pnl,null);
 assert.equal(integrity.run('position.currentBid'),.7,'missing Bid is never a zero-price observation');
 integrity.run('exitPosition()');assert.equal(integrity.run('position.active'),true,'cannot record a fill at an invalid price');
}
held();integrity.run("state.optionQuoteAt=new Date(Date.now()-3000).toISOString()");assert.equal(integrity.run('updatePositionFromState().matched'),false);
held();integrity.run("state._mock=true;state.bid=99;state.ask=99.1");assert.equal(integrity.run('updatePositionFromState().matched'),false,'mock scenario cannot mark a live position');
held();integrity.run("state.bid=.2;state.ask=.22;state.minutesToClose=null");assert.equal(integrity.run('updatePositionFromState().decision'),'HARD STOP','null remaining time is not zero minutes');
held();integrity.run("state.bid=0;state.ask=.02");assert.equal(integrity.run('updatePositionFromState().decision'),'HARD STOP','an observed valid zero bid is different from missing data');
held();integrity.run("state.spy=669;state.open=668;state.vwapSlope=1;state.mom5=.2;state.vixChange=-.2;updatePositionFromState();updatePositionFromState();updatePositionFromState()");
assert.equal(integrity.run('position.thesisBreakCount'),1,'one snapshot cannot count as two independent thesis breaks');
integrity.run("state.spyPriceAt=new Date(Date.now()-50).toISOString();updatePositionFromState()");assert.equal(integrity.run('position.last.decision'),'THESIS EXIT');
console.log('PASS: entry evidence/Delta gates; stale/null/mismatched/mock quotes cannot mark or close LIVE; repeated render cannot fabricate thesis confirmation.');

// Costs are reference calculations, hidden when quotes expire; closure is not a data fault.
const support=load(html);support.run("runtimeConfig={newsMode:'OFF'};state="+validBuyFixture);
support.run(`state.marketSession={open:true,calendarReady:true};state.decisionAnalysis={side:'PUT',priceSupport:4,volatilitySupport:1,efficiency20m:.2,costsStatus:'ASSUMPTION_NOT_EXPECTED_RETURN',costs:[{case:'STANDARD',entryDebitCents:7500,unchangedQuoteNetCents:-700,breakEvenBid:.77,feePerSideCents:100,slippagePerSide:.01}]};render(false)`);
assert.match(support.els.get('analysisSupport').textContent,/価格 4\/4/);
assert.match(support.els.get('analysisSupport').textContent,/20.0%/);
assert.match(support.els.get('analysisCosts').textContent,/0.7700/);
support.tick(2200);support.run('render(false)');assert.match(support.els.get('analysisCosts').textContent,/更新待ち/);
support.run("state.marketSession.open=false;state.connection='CONNECTED';state.signal.decision='DATA ERROR';render(false)");
assert.equal(support.run('evaluate(state).decision'),'NO TRADE');
assert.match(support.els.get('decision').className,/warn/);
assert.match(support.els.get('staleBanner').textContent,/市場時間外・購入判定休止/);
support.run('state.ok=false');assert.equal(support.run('evaluate(state).decision'),'DATA ERROR');
console.log('PASS: decision-support cost/overlap display, stale-cost hiding, market closure vs real connection failure.');
