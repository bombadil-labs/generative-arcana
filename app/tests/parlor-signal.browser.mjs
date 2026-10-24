// Real offline Web Audio rendering; no output device, provider or microphone.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import ts from 'typescript';
const source=await readFile(new URL('../src/parlor/radioAudio.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();
  const results=await page.evaluate(async code=>{
    const exports={};new Function('exports',code)(exports);
    const all=[];
    for(const mode of ['normal','capture','mute','noGesture']) {
      const context=new OfflineAudioContext(1,24000,48000);let clock=0;
      const facade={state:'running',get currentTime(){return clock;},sampleRate:48000,destination:context.destination,
        createBuffer:context.createBuffer.bind(context),createBufferSource:context.createBufferSource.bind(context),createGain:context.createGain.bind(context),createBiquadFilter:context.createBiquadFilter.bind(context),resume:async()=>{},suspend:async()=>{},close:async()=>{}};
      const sound=new exports.RadioAudio(()=>facade,async()=>context.createBuffer(1,4800,48000),()=>0);
      sound.setPreferences({muted:mode==='mute',volume:1});sound.setState('speaking',false);
      if(mode!=='noGesture')sound.unlock();await Promise.resolve();await Promise.resolve();
      sound.signal('lock');
      let rendered;
      if(mode==='capture'){
        const paused=context.suspend(.025);const rendering=context.startRendering();await paused;
        clock=context.currentTime;sound.setState('listening',true);sound.signal('loss');await context.resume();rendered=await rendering;
      } else {clock=.25;sound.signal('loss');rendered=await context.startRendering();}
      const samples=rendered.getChannelData(0);
      const peak=(a,b)=>samples.slice(Math.round(a*48000),Math.round(b*48000)).reduce((m,v)=>Math.max(m,Math.abs(v)),0);
      let step=0;for(let i=1;i<samples.length;i++)step=Math.max(step,Math.abs(samples[i]-samples[i-1]));
      all.push({mode,peak:peak(0,.5),lock:peak(0,.075),loss:peak(.25,.36),between:peak(.08,.24),afterCancel:peak(.035,.5),step,first:samples[0],last:samples.at(-1)});sound.dispose();
    }return all;
  },compiled);
  for(const value of results){assert.equal(Math.abs(value.first),0);assert.equal(Math.abs(value.last),0);assert.ok(value.peak<=.012);assert.ok(value.step<.006);if(value.mode==='normal'){assert.ok(value.lock>0&&value.loss>0);assert.equal(value.between,0);}else if(value.mode==='capture'){assert.ok(value.lock>0);assert.equal(value.afterCancel,0);}else assert.equal(value.peak,0);}
  console.log('PASS offline signal envelopes: '+JSON.stringify(results));
} finally {await browser.close();}
