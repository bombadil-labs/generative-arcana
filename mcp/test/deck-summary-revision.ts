import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine";
import { DeckRegistry } from "../../app/src/decks/registry";
import { ArcanaToolAdapter } from "../../app/src/mcp/ArcanaToolAdapter";
import { createArcanaAdapter } from "../src/hostStore";
import { CatalogPersistingArcanaToolAdapter, InMemoryUserDeckCatalogRepository } from "../src/userDeckCatalog";
import { createArcanaMcpServer, type ArcanaMcpServerOptions } from "../src/server";
import { neutralManifest, toolResult } from "./protocol-fixtures";

async function connect(options: ArcanaMcpServerOptions) {
  const server = createArcanaMcpServer(options);
  const client = new Client({ name: "revision-metadata-tests", version: "1" });
  const [a,b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
  return { client, async close() { await client.close(); await server.close(); } };
}
const read = async (client: Client, deckId: string, view: string) => toolResult<Record<string,any>>(await client.callTool({name:"get_deck",arguments:{deckId,view}}));

test("warm owner summaries and structure include the same current catalog revision, including slug aliases", async () => {
  const catalog = new InMemoryUserDeckCatalogRepository();
  const record = await catalog.createImported("alice",neutralManifest());
  const adapter = new CatalogPersistingArcanaToolAdapter(createArcanaAdapter(),"alice",catalog);
  const session = await connect({catalog,adapter,principal:{id:"alice"}});
  try {
    for (const id of [record.id,record.slug]) {
      const summary = await read(session.client,id,"summary"); assert.equal(summary.revision,1); assert.equal(summary.id,record.id);
      assert.equal((await read(session.client,id,"structure")).summary.revision,1);
    }
    const next = await catalog.replaceOwned("alice",record.id,1,{...record.manifest,data:{...record.manifest.data,name:"Updated snapshot"}});
    const summary = await read(session.client,record.slug,"summary"); assert.equal(summary.revision,next.revision); assert.equal(summary.name,"Updated snapshot");
    assert.equal("revision" in await read(session.client,record.id,"full"),false);
    assert.equal("revision" in await read(session.client,record.id,"manifest"),false);
    assert.equal("ownerId" in summary,false);
  } finally { await session.close(); }
});

test("owner read-through attaches revision from the same record and shared/built-in views never invent it", async () => {
  class RacingCatalog extends InMemoryUserDeckCatalogRepository {
    changeAfterRead=false;
    override async get(id:string) {
      const record=await super.get(id);
      if(record && this.changeAfterRead) { this.changeAfterRead=false; await super.replaceOwned(record.ownerId,id,record.revision,{...record.manifest,data:{...record.manifest.data,name:"Next record"}}); }
      return record;
    }
  }
  const catalog=new RacingCatalog();const record=await catalog.createImported("alice",neutralManifest());
  const owner=await connect({catalog,principal:{id:"alice"}});
  const anonymous=await connect({catalog,principal:null});
  const bob=await connect({catalog,principal:{id:"bob"}});
  const registry=new DeckRegistry(); const builtin=neutralManifest("synthetic-built-in");registry.registerDeck({data:builtin.data,tagline:builtin.tagline,custom:false});
  const local=await connect({catalog,adapter:new ArcanaToolAdapter(new ArcanaEngine(registry)),principal:{id:"alice"}});
  try {
    catalog.changeAfterRead=true;
    const old=await read(owner.client,record.id,"summary");assert.equal(old.name,record.manifest.data.name);assert.equal(old.revision,1);
    const next=await read(owner.client,record.id,"structure");assert.equal(next.summary.name,"Next record");assert.equal(next.summary.revision,2);
    await catalog.setVisibility("alice",record.id,"public");
    for(const session of [anonymous,bob]) { assert.equal("revision" in await read(session.client,record.id,"summary"),false);assert.equal("revision" in (await read(session.client,record.id,"structure")).summary,false); }
    assert.equal("revision" in await read(local.client,builtin.data.slug,"summary"),false);
    assert.equal("revision" in (await read(local.client,builtin.data.slug,"structure")).summary,false);
  } finally { await Promise.all([owner,anonymous,bob,local].map(session=>session.close())); }
});

test("cached owner revision stays paired with returned content if the catalog changes just after refresh", async () => {
  class RacingCatalog extends InMemoryUserDeckCatalogRepository {
    changeAfterRead=false;
    override async listOwned(owner:string) {
      const records=await super.listOwned(owner);
      if(this.changeAfterRead) { this.changeAfterRead=false;const record=records[0];await super.replaceOwned(owner,record.id,record.revision,{...record.manifest,data:{...record.manifest.data,name:"Newer snapshot"}}); }
      return records;
    }
  }
  const catalog=new RacingCatalog();const record=await catalog.createImported("alice",neutralManifest());
  const adapter=new CatalogPersistingArcanaToolAdapter(createArcanaAdapter(),"alice",catalog);
  await adapter.call("get_deck",{deckId:record.id,view:"summary"}); // hydrate before racing refresh
  catalog.changeAfterRead=true;
  const old=await adapter.call("get_deck",{deckId:record.id,view:"structure"}) as {summary:{name:string;revision:number};data:{name:string}};
  assert.equal(old.summary.revision,1);assert.equal(old.summary.name,record.manifest.data.name);assert.equal(old.data.name,record.manifest.data.name);
  const next=await adapter.call("get_deck",{deckId:record.id,view:"summary"}) as {name:string;revision:number};assert.equal(next.revision,2);assert.equal(next.name,"Newer snapshot");
});

test("revision metadata cannot expose private data through insufficient OAuth read scopes", async () => {
  const catalog=new InMemoryUserDeckCatalogRepository();const record=await catalog.createImported("alice",neutralManifest());
  const adapter=new CatalogPersistingArcanaToolAdapter(createArcanaAdapter(),"alice",catalog);
  await adapter.call("get_deck",{deckId:record.id,view:"summary"});
  const oauth={resourceMetadataUrl:"https://example.test/.well-known/oauth-protected-resource/mcp",readScopes:["decks:read"],writeScopes:["decks:write"]};
  const writer={id:"alice",scopes:["decks:write"]},reader={id:"alice",scopes:["decks:read"]};
  const denied=await connect({catalog,adapter,principal:writer,oauth:{...oauth,principal:writer}});
  const allowed=await connect({catalog,adapter,principal:reader,oauth:{...oauth,principal:reader}});
  try {
    assert.equal((await denied.client.callTool({name:"get_deck",arguments:{deckId:record.id,view:"summary"}})).isError,true);
    assert.equal((await read(allowed.client,record.id,"summary")).revision,1);
  } finally { await denied.close();await allowed.close(); }
});
