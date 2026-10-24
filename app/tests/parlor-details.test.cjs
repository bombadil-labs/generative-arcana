const { test } = require('node:test');
const assert = require('node:assert/strict');
const { authoredSentence, currentCardDetails, readDetailsPreference, saveDetailsPreference } = require('../.test-build/parlor/cardDetails.js');
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
  assert.equal(notes.meaning, 'Trust the patient message.'); assert.equal(notes.orientation, 'Upright');
  assert.ok(notes.station); assert.doesNotMatch(notes.text, /FORBIDDEN FUTURE|A crowd/);
  placement.reversed = true; assert.equal(currentCardDetails(state).meaning, 'A delayed message needs care.');
  assert.equal(currentCardDetails(state).orientation, 'Reversed');
  placement.card.arcana = 'major'; assert.equal(currentCardDetails(state).family, 'Major Arcana');
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
