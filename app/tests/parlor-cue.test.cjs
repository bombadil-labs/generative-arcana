const {test}=require('node:test');
const assert=require('node:assert/strict');
const {guestCue,IDLE_INVITATION}=require('../.test-build/parlor/cue.js');
const cue=(phase,segment=0,mic='idle',audioPlaying=false)=>guestCue({phase,segment,audioPlaying},{phase:mic,error:''});
const text=c=>[c.title,c.instruction].filter(Boolean).join(' ');

test('silent pages invite reading rather than speech or advance, and keep the summon release gate',()=>{
  const state={phase:'speaking',segment:1,audioPlaying:false,timing:'silent'},mic={phase:'idle',error:''};
  assert.equal(text(guestCue(state,mic)),'Read along. The pages turn automatically.');
  assert.match(text(guestCue({...state,phase:'calling'},mic)),/Keep holding/);
});

test('reset is blank except its invitation; summon never offers a microphone before release',()=>{
  assert.deepEqual(cue('idle',3,'error'),{title:IDLE_INVITATION});
  for(const phase of ['summoning','calling'])assert.match(text(cue(phase)),/holding/);
  assert.deepEqual(cue('awaiting-release'),{title:'Release the button.'});
  for(const phase of ['summoning','calling','awaiting-release'])assert.doesNotMatch(text(cue(phase)),/speak|query|\bask\b|next card/);
});

test('microphone cues separate permission, intentional recording and transcription without inviting another action',()=>{
  assert.match(text(cue('question',0,'checking')),/Keep holding.*microphone/);
  assert.match(text(cue('question',0,'listening')),/Speak now.*Release to send/);
  for(const phase of ['question','ready','complete']){
    const waiting=cue(phase,2,'finishing');assert.equal(waiting.title,'Finding your words.');
    assert.doesNotMatch(text(waiting),/Hold|Press|Tap|speak|next/);
  }
});

test('inference and voice preparation offer no unavailable actions or read-ahead; actual playback says listen',()=>{
  for(const phase of ['confirm','drawing','generating','conversation','speaking','ready']){
    assert.doesNotMatch(text(cue(phase)),/Hold|Press|Tap|ask|next|retry/);
  }
  assert.equal(cue('speaking',1,'idle',false).title,'The voice is taking shape.');
  assert.equal(cue('speaking',1,'idle',true).title,'Listen.');
  // A stale microphone error cannot mask an intentional reading or imply failure during speech.
  assert.deepEqual(cue('speaking',1,'error',true),cue('speaking',1,'idle',true));
});

test('card pauses distinguish another card, closing and completed follow-up without promising an unavailable tap',()=>{
  assert.match(text(cue('question')),/speak your query.*open reading/);
  for(const count of [1,2])assert.match(text(cue('ready',count)),/ask more about this card.*draw the next card/);
  assert.match(text(cue('ready',3)),/ask more about this card.*hear the closing/);
  assert.doesNotMatch(text(cue('ready',3)),/next card/);
  assert.match(text(cue('complete',4)),/ask about the reading.*five times/);
  assert.doesNotMatch(text(cue('complete',4)),/Press once|next card|closing/);
});

test('interruption cues recover through the actual tap gate and errors cannot advertise active processing',()=>{
  assert.match(text(cue('paused',2)),/paused.*Press once to resume/);
  assert.match(text(cue('error',2)),/interrupted.*Press once to retry/);
  assert.equal(cue('error',2).attention,true);
  const failedMic=cue('complete',4,'error');assert.equal(failedMic.attention,true);
  assert.match(text(failedMic),/voice did not reach.*Hold to ask about the reading/);
  assert.doesNotMatch(text(failedMic),/Press once|gathering|considering|Speak now/);
});

test('no configured transcription route means no invitation to record or discuss',()=>{
  for(const [phase,segment] of [['question',0],['ready',1],['ready',3],['complete',4]]){
    const result=guestCue({phase,segment},{phase:'idle',error:''},false);
    assert.doesNotMatch(text(result),/Hold|hold|speak|ask/);
    assert.match(text(result),/Press/);
  }
});
