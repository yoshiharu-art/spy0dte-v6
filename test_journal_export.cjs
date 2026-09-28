// Synthetic export regression only; no market calls, credentials, or orders.
const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
const code=fs.readFileSync('paper.js','utf8');
const dom=new JSDOM(fs.readFileSync('paper.html','utf8'),{runScripts:'outside-only'}),w=dom.window;
w.setTimeout=()=>1;w.clearTimeout=()=>{};
w.AbortSignal={timeout:()=>undefined};
w.fetch=async()=>({ok:true,json:async()=>({adminConfigured:true})});
w.eval(code+'\nwindow.testJournal=journalDownload;window.setExportRequest=(fn)=>{request=fn;};');
const raw='{"event_hash":"synthetic","large":9007199254740993,"price":100.0,"signed":-0.0,"small":1e-09,"text":"日本語"}';
(async()=>{
 await new Promise(setImmediate);
 const calls=[];
 w.setExportRequest(async path=>{
  calls.push(path);
  return calls.length===1?{raw_events:[raw],snapshot_end:2,next_start:1}:{raw_events:[raw],snapshot_end:2,next_start:null};
 });
 const file=await w.testJournal();
 assert.equal(file.content,'{"filename":"paper-journal.json","snapshot_end":2,"events":['+raw+','+raw+']}');
 assert.deepEqual(calls,['export?format=journal&raw=1&start=0','export?format=journal&raw=1&start=1&end=2']);
 // Prove the former parse/stringify path changes stored numeric literals.
 assert.notEqual(JSON.stringify(JSON.parse(raw)),raw);
 for(const bad of [
  {events:[],next_start:null}, // old backend: explicit failure, never a damaged download
  {raw_events:[],snapshot_end:2,next_start:0},
  {raw_events:[raw],snapshot_end:2,next_start:null},
  {raw_events:[{}],snapshot_end:1,next_start:null},
  {raw_events:[raw],snapshot_end:2,next_start:2},
  {raw_events:[raw],snapshot_end:-1,next_start:null}
 ]){w.setExportRequest(async()=>bad);await assert.rejects(()=>w.testJournal());}
 let page=0;
 w.setExportRequest(async()=>++page===1?{raw_events:[raw],snapshot_end:2,next_start:1}:{raw_events:[raw],snapshot_end:3,next_start:2});
 await assert.rejects(()=>w.testJournal());assert.equal(page,2);
 w.setExportRequest(async()=>({raw_events:[],snapshot_end:0,next_start:null}));
 assert.equal(JSON.parse((await w.testJournal()).content).events.length,0);
 console.log('PASS: raw journal bytes, fixed snapshot pagination, missing/progress guards, incompatible backend, empty journal.');
 dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
