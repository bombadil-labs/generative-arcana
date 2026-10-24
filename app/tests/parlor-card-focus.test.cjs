const {test}=require('node:test');
const assert=require('node:assert/strict');
const {focusedCard}=require('../.test-build/parlor/cardFocus.js');
const state=(phase,revealed=0,segment=0,pendingQuestion='')=>({phase,revealed,segment,pendingQuestion});

test('summon, unrevealed cards and a completed reading never get visual focus',()=>{
  for(const phase of ['idle','summoning','calling','awaiting-release','question','confirm','drawing','generating','complete'])
    assert.equal(focusedCard(state(phase,3,3)),null,phase);
  for(const phase of ['ready','speaking','conversation','paused','error'])assert.equal(focusedCard(state(phase)),null);
});

test('only an actually revealed card comes forward; advancing settles it during voice preparation',()=>{
  for(let card=0;card<3;card++){
    const loading=Object.freeze(state('speaking',card,card));assert.equal(focusedCard(loading),null);
    assert.equal(focusedCard(state('speaking',card+1,card)),card,'actual audio reveal brings the current card forward');
    assert.equal(focusedCard(state('ready',card+1,card+1)),card,'completed narration stays forward for discussion');
  }
});

test('discussion, interruption and retries retain the relevant revealed card without exposing later cards',()=>{
  for(let card=0;card<3;card++){
    for(const phase of ['conversation','speaking','paused','error'])
      assert.equal(focusedCard(state(phase,card+1,card+1,'A follow-up')),card,phase);
    for(const phase of ['paused','error']){
      assert.equal(focusedCard(state(phase,card+1,card)),card,'interrupted current narration');
      assert.equal(focusedCard(state(phase,card+1,card+1)),null,'interrupted preparation of the next segment');
    }
  }
});

test('closing narration and final follow-up use the whole spread, with no stale focus after reset',()=>{
  assert.equal(focusedCard(state('ready',3,3)),2);
  for(const phase of ['speaking','paused','error'])assert.equal(focusedCard(state(phase,3,3)),null);
  for(const phase of ['complete','conversation','speaking','paused','error'])assert.equal(focusedCard(state(phase,3,4,'Final follow-up')),null);
  assert.equal(focusedCard(state('idle')),null);
});
