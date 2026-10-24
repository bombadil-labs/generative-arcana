const { test } = require('node:test');
const assert = require('node:assert/strict');
const { authoredSentence, currentCardDetails, readDetailsPreference, saveDetailsPreference, detailPageRuns } = require('../.test-build/parlor/cardDetails.js');
const {silentPage}=require('../.test-build/parlor/silentReading.js');
const { ArcanaEngine } = require('../.test-build/engine/ArcanaEngine.js');
const { DeckRegistry } = require('../.test-build/decks/registry.js');
const { rawDeck } = require('./fixtures.cjs');
async function fixture() {
  const engine = new ArcanaEngine(new DeckRegistry()), deck = engine.importDeck(rawDeck());
  const reading = structuredClone(await engine.castReading(deck.id, 'three-card', 'Fixture'));
  const card = reading.placements[0].card;
  card.name = 'The guest of a very long and entirely authored title';
  card.visuals.detailed_description = 'One woman holds a sealed envelope at a cafe table. A crowd surrounds her.';
  card.meaning = { upright: 'Trust the patient message. Another meaning.', inverted: 'A delayed message needs care. Another meaning.' };
  return { phase: 'ready', revealed: 1, segment: 0, reading, pendingQuestion: '' };
}
test('deck notes use actual authored scene, taxonomy and orientation without future metadata', async () => {
  const state = await fixture(), placement = state.reading.placements[0]; placement.reversed = false;
  state.reading.placements[1].card.name = 'FORBIDDEN FUTURE';
  const notes = currentCardDetails(state);
  assert.equal(notes.name, placement.card.name); assert.equal(notes.scene, 'One woman holds a sealed envelope at a cafe table.');
  assert.equal(notes.meaning, 'Trust the patient message. Another meaning.'); assert.equal(notes.orientation, 'Upright');
  assert.deepEqual(notes.sections.slice(1).map(s=>[s.kind,s.active]),[['upright',true],['reversed',false]]);
  assert.match(notes.text,/Upright meaning \(drawn\):/);assert.match(notes.text,/Reversed meaning \(not drawn\):/);
  assert.ok(notes.station); assert.doesNotMatch(notes.text, /FORBIDDEN FUTURE|A crowd/);
  placement.reversed = true; assert.equal(currentCardDetails(state).meaning, 'A delayed message needs care. Another meaning.');
  assert.deepEqual(currentCardDetails(state).sections.slice(1).map(s=>[s.kind,s.active]),[['upright',false],['reversed',true]]);
  assert.equal(currentCardDetails(state).orientation, 'Reversed');
  placement.card.arcana = 'major'; assert.equal(currentCardDetails(state).family, 'Major Arcana');
});

test('both full meanings page with exact Unicode offsets and correct styling even when wording repeats',async()=>{
  const state=await fixture(),card=state.reading.placements[0].card;state.reading.placements[0].reversed=true;
  const repeated='A shared phrase 🌙. '.repeat(60);card.meaning.upright='UPRIGHT_BEGIN '+repeated+'UPRIGHT_END';card.meaning.inverted='REVERSED_BEGIN '+repeated+'REVERSED_END';
  const notes=currentCardDetails(state);let start=0;const pages=[];
  for(let i=0;i<500;i++){
    const limit=i%2?83:119,page=silentPage(notes.text,start,s=>Array.from(s).length<=limit),runs=detailPageRuns(notes.sections,start,Array.from(page.text).length);
    assert.equal(runs.map(r=>r.text).join(''),page.text);for(const run of runs){if(run.kind==='upright')assert.equal(run.active,false);if(run.kind==='reversed')assert.equal(run.active,true);}
    pages.push(page.text);if(page.done)break;start=page.end;
  }
  assert.equal(pages.join(''),notes.text);for(const value of ['UPRIGHT_BEGIN','UPRIGHT_END','REVERSED_BEGIN','REVERSED_END'])assert.ok(pages.join('').includes(value));
  assert.equal(state.reading.placements[0].card.meaning.upright,'UPRIGHT_BEGIN '+repeated+'UPRIGHT_END','presentation never mutates source');
});

test('a missing meaning is omitted without fabricating an alternative or changing drawn orientation',async()=>{
  const state=await fixture(),card=state.reading.placements[0].card;state.reading.placements[0].reversed=true;card.meaning.inverted=undefined;
  const notes=currentCardDetails(state);assert.equal(notes.orientation,'Reversed');assert.equal(notes.meaning,undefined);assert.equal(notes.sections.length,2);assert.equal(notes.sections[1].active,false);assert.doesNotMatch(notes.text,/Reversed meaning/);assert.match(notes.text,/Upright meaning \(not drawn\)/);
});
test('notes omit missing or unsuitable fields rather than inventing facts or slicing sentences', async () => {
  const state = await fixture(), card = state.reading.placements[0].card;
  delete card.suit_slug; delete card.rank_slug; card.arcana = 'minor'; card.station_slug = 'missing';
  card.visuals.detailed_description = 'Render this as a textured painting.'; card.meaning.upright = card.meaning.inverted = '';
  const notes = currentCardDetails(state); assert.equal(notes.family, undefined); assert.equal(notes.rank, undefined); assert.equal(notes.station, undefined); assert.equal(notes.scene, undefined); assert.equal(notes.meaning, undefined);
  assert.equal(authoredSentence('A sentence '+ 'long '.repeat(100)+'.'), undefined);
  assert.equal(authoredSentence('An unfinished scene'), undefined);
  assert.equal(authoredSentence('Dr. Brown holds a cup. The next sentence.'), 'Dr. Brown holds a cup.');
  card.meaning.upright = card.meaning.inverted = 'Patience, shelter, companionship';
  assert.equal(currentCardDetails(state).meaning, 'Patience, shelter, companionship');
});
test('notes disappear on reset, preparation, synthesis and unrevealed states, and follow deliberate advance', async () => {
  const state = await fixture();
  for (const change of [{phase:'idle'}, {phase:'generating'}, {revealed:0}, {phase:'speaking',segment:1}, {phase:'complete',segment:4}]) assert.equal(currentCardDetails({...state,...change}), null);
  const next = {...state,revealed:2,segment:1};assert.equal(currentCardDetails(next).slug,state.reading.placements[1].card.slug);
});
test('display preference defaults off and persists only a boolean scoped to the account, independently of keys', () => {
  const entries=new Map(),storage={getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)};
  assert.equal(readDetailsPreference(storage,'owner'),false);assert.equal(saveDetailsPreference(storage,'owner',true),true);
  assert.equal(readDetailsPreference(storage,'owner'),true);assert.equal(readDetailsPreference(storage,'other'),false);
  assert.deepEqual(JSON.parse([...entries.values()][0]),{cardDetails:true});
  saveDetailsPreference(storage,'owner',false);assert.equal(readDetailsPreference(storage,'owner'),false);
  const unavailable={getItem(){throw Error();},setItem(){throw Error();}};
  assert.equal(readDetailsPreference(unavailable,'owner'),false);assert.equal(saveDetailsPreference(unavailable,'owner',true),false);
});
