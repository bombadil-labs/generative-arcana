const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deckIntroduction,DECK_SHORTCUT_NOTE}=require('../.test-build/parlor/deckIntroduction.js');
const {moduleFor}=require('./fixtures.cjs');

test('introduction uses authored taxonomy, story and names, never a reading or invented ranks',()=>{
  const deck=moduleFor();deck.name='Synthetic chosen deck';deck.data.theme.description='A synthetic theme.';deck.data.major_arcana.story='A synthetic major story.';
  deck.data.suits={first:{index:0,name:'First suit',description:'A factual suit.'},second:{index:1,name:'Second suit'}};
  deck.data.ranks={lower:{index:0,name:'Lower'},upper:{index:1,name:'Upper'}};
  const text=deckIntroduction(deck);assert.match(text,/Synthetic chosen deck/);assert.match(text,/A synthetic major story/);assert.match(text,/First suit.*A factual suit/);assert.match(text,/Lower.*Upper/s);assert.doesNotMatch(text,/1920|1929|Court ranks|Ingenue/);
  assert.equal(DECK_SHORTCUT_NOTE,'Three button presses to learn about the deck, five to reset the reading');
});

test('year ranks and courts are explained only when present in the selected authored structure',()=>{
  const deck=moduleFor();deck.data.ranks=Object.fromEntries(Array.from({length:10},(_,i)=>['year-'+(1920+i),{index:i,name:String(1920+i),numeric_value:i+1}]));
  for(const [i,slug] of ['ingenue','daredevil','host','magnate'].entries())deck.data.ranks[slug]={index:i+10,name:'The '+slug,description:'Authored '+slug+'.'};
  const text=deckIntroduction(deck);assert.match(text,/1920.1929.*replace ranks one through ten/);assert.match(text,/Court ranks/);for(const slug of ['ingenue','daredevil','host','magnate'])assert.match(text,new RegExp('Authored '+slug));
  delete deck.data.ranks.magnate;assert.doesNotMatch(deckIntroduction(deck),/Court ranks|replace ranks/);
});
