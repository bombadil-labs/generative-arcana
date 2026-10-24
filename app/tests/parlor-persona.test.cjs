const {test}=require('node:test');
const assert=require('node:assert/strict');
const {defaultSettings,characters,visionFrames}=require('../.test-build/parlor/settings.js');
const {narrate,converse,narrationInstructions,discussionInstructions}=require('../.test-build/parlor/providers.js');
const {ArcanaEngine}=require('../.test-build/engine/ArcanaEngine.js');
const {DeckRegistry}=require('../.test-build/decks/registry.js');
const {rawDeck}=require('./fixtures.cjs');

test('scripted personas contain no device instructions; keeper is the original spirit of the ether',()=>{
  assert.equal(characters.keeper.name,'The Spirit of the Ether');
  assert.match(characters.keeper.greeting,/spirit of the ether/);
  assert.match(characters.keeper.direction,/old Austrian male/);
  assert.match(characters.keeper.direction,/gloomy, existential/);
  assert.match(characters.keeper.direction,/never hostile/);
  for(const character of Object.values(characters))assert.doesNotMatch(character.greeting,/\b(button|press|hold|release|tap|click|reset|advance|cards|deck|spread)\b/i);
  assert.deepEqual(visionFrames,['Past','Present','Future']);
});

test('every persona keeps source meanings internal, knows no cards and leaves controls exclusively to visual cues',()=>{
  for(const character of Object.keys(characters))for(const build of [narrationInstructions,discussionInstructions]){
    const prompt=build({...defaultSettings(),character});
    assert.match(prompt,/spirit of the ether/);
    assert.match(prompt,/Internally ground every vision in the provided card data/);
    assert.match(prompt,/private source metadata, never spoken text/);
    assert.match(prompt,/you know nothing of cards/);
    assert.match(prompt,/Never speak button or control instructions/);
    assert.match(prompt,/exclusively to the visual cues/);
    assert.match(prompt,/do not repeat old card or control wording/);
    assert.match(prompt,/fictional roleplay and reflective entertainment/);
    assert.match(prompt,/not claims about facts or a certain future/);
    assert.doesNotMatch(prompt,/You are a.*tarot storyteller|Preserve the deck's authored meanings, names/);
  }
});

test('both BYOK providers receive vision prompts with exact private identities and revealed-only discussion context',async()=>{
  const engine=new ArcanaEngine(new DeckRegistry()),deck=engine.importDeck(rawDeck());
  const reading=await engine.castReading(deck.id,'three-card','A synthetic question');
  const original=global.fetch,requests=[];
  try{
    global.fetch=async(url,init)=>{
      const body=JSON.parse(init.body),system=body.system??body.messages[0].content;requests.push(body);
      const content=system.includes('Return only JSON')?JSON.stringify({cards:reading.placements.map(p=>({slug:p.card.slug,text:'[sighs] A distant landscape takes shape in the mist.'})),synthesis:'The horizon is uncertain. You still have a choice.'}):'I know nothing of cards. I see only a landscape in the mist.';
      return String(url).includes('anthropic')?Response.json({content:[{type:'text',text:content}]}):Response.json({choices:[{message:{content}}]});
    };
    for(const provider of ['anthropic','openai']){
      const settings={...defaultSettings(),provider,anthropicKey:'synthetic-a',openaiKey:'synthetic-o',anthropicModel:'synthetic',openaiModel:'synthetic'};
      const result=await narrate(settings,reading,new AbortController().signal),request=requests.at(-1);
      assert.equal(request.system??request.messages[0].content,narrationInstructions(settings));
      const identities=JSON.parse(request.messages.at(-1).content.split('CARD IDENTITIES IN ORDER\n')[1]);
      assert.deepEqual(identities.map(p=>p.narrativeFrame),visionFrames);
      assert.deepEqual(identities.map(p=>p.slug),reading.placements.map(p=>p.card.slug));
      assert.deepEqual(identities.map(p=>p.position),reading.placements.map(p=>p.position.name));
      assert.ok(result.cards.every(p=>!p.text.includes('button')));
      const turns=[{role:'user',content:'The spirit has described vision 1.'},{role:'assistant',content:result.cards[0].text},{role:'user',content:'What cards are you looking at? Should I press the button?'}];
      await converse(settings,reading,turns,new AbortController().signal,1);
      const follow=requests.at(-1),system=follow.system??follow.messages[0].content;
      assert.ok(system.startsWith(discussionInstructions(settings)));
      const context=JSON.parse(system.slice(system.lastIndexOf('\n')+1));
      assert.deepEqual(context.cards,[{name:reading.placements[0].card.name,position:reading.placements[0].position.name,reversed:reading.placements[0].reversed,meaning:reading.placements[0].meaning,narrativeFrame:'Past'}]);
      assert.deepEqual(follow.messages.slice(provider==='openai'?1:0),turns,'guest question is preserved as data, not elevated into instructions');
    }
  }finally{global.fetch=original;}
});
