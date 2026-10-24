const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deckIntroduction,deckGuideCue,DECK_SHORTCUT_NOTE}=require('../.test-build/parlor/deckIntroduction.js');
const {moduleFor}=require('./fixtures.cjs');

test('introduction uses authored taxonomy, story and names, never a reading or invented ranks',()=>{
  const deck=moduleFor();deck.name='Synthetic chosen deck';deck.data.theme.description='A synthetic theme.';deck.data.major_arcana.story='A synthetic major story.';
  deck.data.suits={first:{index:0,name:'First suit',description:'A factual suit.'},second:{index:1,name:'Second suit'}};
  deck.data.ranks={lower:{index:0,name:'Lower'},upper:{index:1,name:'Upper'}};
  const text=JSON.stringify(deckIntroduction(deck));assert.match(text,/Synthetic chosen deck/);assert.match(text,/A synthetic major story/);assert.match(text,/First suit.*A factual suit/);assert.match(text,/Lower.*Upper/s);assert.doesNotMatch(text,/1920|1929|Court ranks|Ingenue/);
  assert.equal(DECK_SHORTCUT_NOTE,'Three button presses to learn about the deck, five to reset the reading');
});

test('year ranks and courts are explained only when present in the selected authored structure',()=>{
  const deck=moduleFor();deck.data.ranks=Object.fromEntries(Array.from({length:10},(_,i)=>['year-'+(1920+i),{index:i,name:String(1920+i),numeric_value:i+1}]));
  for(const [i,slug] of ['ingenue','daredevil','host','magnate'].entries())deck.data.ranks[slug]={index:i+10,name:'The '+slug,description:'Authored '+slug+'.'};
  const guide=deckIntroduction(deck);assert.match(guide.ranks,/1920.1929.*replace ranks/);assert.equal(guide.courts.length,4);for(const slug of ['ingenue','daredevil','host','magnate'])assert.match(JSON.stringify(guide.courts),new RegExp('Authored '+slug));
  delete deck.data.ranks.magnate;assert.equal(deckIntroduction(deck).courts.length,0);assert.doesNotMatch(deckIntroduction(deck).ranks,/replace ranks/);
});

test('party guide has three manual cues, verified suit icons and a fixed major example independent of any draw',()=>{
  const deck=moduleFor();deck.data.slug='the-roaring-twenties';
  deck.data.suits=Object.fromEntries(['martini','zeppelin','world-clock','atom'].map((slug,index)=>[slug,{name:slug,index}]));
  deck.data.ranks=Object.fromEntries(Array.from({length:10},(_,i)=>['year-'+(1920+i),{name:String(1920+i),index:i,numeric_value:i+1}]));
  for(const [i,slug] of ['ingenue','daredevil','host','magnate'].entries())deck.data.ranks[slug]={name:slug,index:i+10};
  const example=deck.cards.find(c=>c.slug==='major-17');example.name='The Emancipation';
  const guide=deckIntroduction(deck);assert.equal(guide.example,example);assert.match(guide.intro,/evening's festivities/);assert.deepEqual(guide.suits.map(s=>s.icon),['martini','zeppelin','world-clock','atom']);
  assert.equal(deckGuideCue(0),'Press again to advance (Page 1/3)');assert.equal(deckGuideCue(1),'Press again to advance (Page 2/3)');assert.equal(deckGuideCue(2),'Press again to finish (Page 3/3)');
  deck.data.slug='another-deck';assert.doesNotMatch(deckIntroduction(deck).intro,/festivities/);assert.ok(deckIntroduction(deck).suits.every(s=>!s.icon));
});
