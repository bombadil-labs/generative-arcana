const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LocalMicrophone}=require('../.test-build/parlor/microphone.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({availability='available',supported=true,delay=false}={}) {
  let recognition,resolveAvailability,started=0,aborted=0,stopped=0,installed=0;
  const submitted=[];
  class Recognition {
    constructor(){recognition=this;if(supported)this.processLocally=false;}
    static async available(options){assert.deepEqual(options,{langs:['en-US'],processLocally:true});return delay?new Promise(r=>resolveAvailability=r):availability;}
    static async install(options){assert.equal(options.processLocally,true);installed++;return true;}
    start(){assert.equal(this.processLocally,true);started++;}
    stop(){stopped++;}
    abort(){aborted++;}
  }
  const mic=new LocalMicrophone(text=>submitted.push(text),()=>Recognition);
  const result=(text,final=true)=>recognition.onresult?.({results:[{isFinal:final,0:{transcript:text}}]});
  return {mic,submitted,result,get recognition(){return recognition;},get counts(){return {started,aborted,stopped,installed};},available:value=>resolveAvailability(value)};
}
test('local push-to-talk shows interim words and commits only final words after release/end',async()=>{
  const s=setup();try{
    await s.mic.press();assert.equal(s.counts.started,1);s.recognition.onstart();await s.mic.press();assert.equal(s.counts.started,1);
    s.result('a partial thought',false);assert.equal(s.mic.getSnapshot().transcript,'a partial thought');assert.deepEqual(s.submitted,[]);
    s.mic.release();assert.equal(s.counts.stopped,1);assert.equal(s.mic.getSnapshot().phase,'finishing');
    s.result('A complete thought');s.recognition.onend();assert.deepEqual(s.submitted,['A complete thought']);assert.equal(s.mic.getSnapshot().phase,'idle');assert.ok(s.counts.aborted);
  }finally{s.mic.dispose();}
});
test('release during local availability or microphone permission cannot start late recording',async()=>{
  const s=setup({delay:true});try{const pending=s.mic.press();s.mic.release();s.available('available');await pending;assert.equal(s.counts.started,0);assert.equal(s.mic.getSnapshot().phase,'idle');}finally{s.mic.dispose();}
  const p=setup();try{await p.mic.press();const late=p.recognition.onstart;p.mic.release();late();assert.ok(p.counts.aborted);assert.notEqual(p.mic.getSnapshot().phase,'listening');assert.deepEqual(p.submitted,[]);}finally{p.mic.dispose();}
});
test('cancellation/disposal discards speech and ignores late result/end callbacks',async()=>{
  for(const action of ['cancel','dispose']){const s=setup();try{await s.mic.press();s.recognition.onstart();s.result('private words');const late=s.recognition.onresult,end=s.recognition.onend;s.mic[action]();late({results:[{isFinal:true,0:{transcript:'late words'}}]});end();assert.deepEqual(s.submitted,[]);assert.equal(s.mic.getSnapshot().transcript,'');assert.ok(s.counts.aborted);}finally{s.mic.dispose();}}
});
test('denied/unavailable microphone and missing local API never use remote recognition',async()=>{
  const unsupported=setup({supported:false});try{await unsupported.mic.press();assert.equal(unsupported.counts.started,0);assert.match(unsupported.mic.getSnapshot().error,/cannot guarantee local/);}finally{unsupported.mic.dispose();}
  const absent=new LocalMicrophone(()=>assert.fail('no transcript'),()=>undefined);await absent.press();assert.match(absent.getSnapshot().error,/unavailable/);absent.dispose();
  for(const error of ['not-allowed','service-not-allowed','audio-capture','no-speech','network']){const s=setup();try{await s.mic.press();s.recognition.onerror({error});assert.equal(s.mic.getSnapshot().phase,'error');assert.ok(s.counts.aborted);assert.deepEqual(s.submitted,[]);}finally{s.mic.dispose();}}
});
test('language-pack download is explicit and never starts recording automatically',async()=>{
  const s=setup({availability:'downloadable'});try{await s.mic.press();assert.equal(s.counts.installed,0);assert.equal(s.counts.started,0);assert.equal(s.mic.getSnapshot().canInstall,true);await s.mic.install();assert.equal(s.counts.installed,1);assert.equal(s.counts.started,0);assert.equal(s.mic.getSnapshot().phase,'idle');}finally{s.mic.dispose();}
});
test('recognizer ending while held and overlong input never auto-submit or auto-restart',async()=>{
  const s=setup();try{await s.mic.press();s.recognition.onstart();s.result('words');s.recognition.onend();s.mic.release();assert.deepEqual(s.submitted,[]);assert.equal(s.counts.started,1);
    await s.mic.press();s.recognition.onstart();s.result('x'.repeat(1201));assert.equal(s.mic.getSnapshot().phase,'error');assert.deepEqual(s.submitted,[]);
  }finally{s.mic.dispose();}
});
