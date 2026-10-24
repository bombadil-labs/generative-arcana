const {test}=require('node:test');
const assert=require('node:assert/strict');
const {silentPage,silentPageMs,presentSilentPages}=require('../.test-build/parlor/silentReading.js');
const {PresentationPause}=require('../.test-build/parlor/pause.js');

test('guide pauses silent page reading time, resumes the same page, and abort discards pending work',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let now=0,resize,cleanups=0; t.mock.method(performance,'now',()=>now);
  const pause=new PresentationPause(),abort=new AbortController(),pages=[];
  const work=presentSilentPages('Beginning. Middle. Ending.',abort.signal,p=>pages.push(p),{fits:s=>s.length<=12,observe:fn=>{resize=fn;return()=>cleanups++;}},pause);
  const rejection=assert.rejects(work,{name:'AbortError'}),first=pages[0];now=1000;t.mock.timers.tick(1000);pause.set(true);
  now=100000;t.mock.timers.tick(99000);assert.deepEqual(pages,[first]);pause.set(false);t.mock.timers.tick(silentPageMs(first)-1001);assert.deepEqual(pages,[first]);t.mock.timers.tick(1);assert.equal(pages.length,2);
  pause.set(true);resize();t.mock.timers.tick(100000);assert.equal(pages.length,2);pause.set(false);assert.equal(pages[2],pages[1],'resize does not skip current text');
  pause.set(true);abort.abort();await rejection;pause.set(false);resize();t.mock.timers.tick(100000);assert.equal(pages.length,3);assert.equal(cleanups,1);
});

test('pause waiters resume once or abort without reviving',async()=>{
  const pause=new PresentationPause(),abort=new AbortController();pause.set(true);let completed=false;
  const pending=pause.wait(abort.signal).then(()=>completed=true);await Promise.resolve();assert.equal(completed,false);pause.set(false);await pending;assert.equal(completed,true);
  pause.set(true);const stopped=pause.wait(abort.signal);const rejected=assert.rejects(stopped,{name:'AbortError'});abort.abort();await rejected;pause.set(false);await assert.rejects(pause.wait(abort.signal),{name:'AbortError'});
});

test('silent pages retain beginning, middle, ending and Unicode without clipping or dropping characters',()=>{
  const text='Beginning.\n'+'A thought worth reading. '.repeat(35)+'🕯️'.repeat(40)+'\nThe ending.';
  let offset=0;const pages=[];
  while(offset<Array.from(text).length){const page=silentPage(text,offset,value=>Array.from(value).length<=71);pages.push(page.text);offset=page.end;assert.ok(page.text.length);assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(page.text));}
  assert.equal(pages.join(''),text);assert.ok(pages.length>10);assert.match(pages[0],/^Beginning/);assert.match(pages.at(-1),/The ending\.$/);
  assert.ok(silentPageMs('A short page.')>=4000);assert.ok(silentPageMs('word '.repeat(50))>=20800);assert.ok(silentPageMs('字'.repeat(100))>=5300);
});

test('silent delivery completes only after every page including the ending has had reading time',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let resized,cleanups=0,finished=false;const pages=[];
  const text='Beginning. '+'Middle thought. '.repeat(18)+'The ending.';
  const work=presentSilentPages(text,new AbortController().signal,page=>pages.push(page),{fits:v=>v.length<=70,observe:fn=>{resized=fn;return()=>cleanups++;}}).then(()=>finished=true);
  for(let i=0;i<30&&!finished;i++){
    const page=pages.at(-1),count=pages.length;assert.ok(!finished);t.mock.timers.tick(silentPageMs(page)-1);await Promise.resolve();assert.equal(pages.length,count);assert.equal(finished,false);
    t.mock.timers.tick(1);await Promise.resolve();
  }
  await work;assert.equal(pages.join(''),text);assert.equal(cleanups,1);const count=pages.length;resized();t.mock.timers.tick(100000);assert.equal(pages.length,count);
});

test('resize repeats the current page at its original offset and restarts reading time without skipping text',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let resized,width=120,finished=false;const pages=[];
  const text='Beginning. '+'A middle sentence. '.repeat(12)+'The end.';
  const work=presentSilentPages(text,new AbortController().signal,page=>pages.push(page),{fits:v=>v.length<=width,observe:fn=>{resized=fn;return()=>{};}}).then(()=>finished=true);
  t.mock.timers.tick(3000);width=35;resized();assert.ok(pages[0].startsWith(pages[1]));const resizedPages=[pages.at(-1)];
  for(let i=0;i<40&&!finished;i++){const count=pages.length;t.mock.timers.tick(silentPageMs(pages.at(-1)));await Promise.resolve();if(pages.length>count)resizedPages.push(pages.at(-1));}
  await work;assert.equal(resizedPages.join(''),text);
});

test('abort cancels page timers and late resize callbacks; failed measurement cleans up without false completion',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});let resized,cleanups=0;const pages=[],controller=new AbortController();
  const work=presentSilentPages('Beginning. '+'A long passage. '.repeat(30),controller.signal,p=>pages.push(p),{fits:v=>v.length<=50,observe:fn=>{resized=fn;return()=>cleanups++;}});
  const rejected=assert.rejects(work,{name:'AbortError'});controller.abort();await rejected;resized();t.mock.timers.tick(100000);assert.equal(pages.length,1);assert.equal(cleanups,1);
  await assert.rejects(presentSilentPages('Hidden',new AbortController().signal,()=>assert.fail('No unread text may be presented'),{fits:()=>false,observe:()=>()=>cleanups++}),/too small/);assert.equal(cleanups,2);
});
