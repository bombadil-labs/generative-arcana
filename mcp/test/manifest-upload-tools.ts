import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createArcanaMcpServer } from "../src/server";
import { createArcanaAdapter } from "../src/hostStore";
import { CatalogPersistingArcanaToolAdapter } from "../src/userDeckCatalog";
import { NeonUserDeckCatalogRepository } from "../src/neonUserDeckCatalog";
import { PostgresManifestUploads } from "../src/manifestUploads";
import { neutralManifest, toolResult } from "./protocol-fixtures";
const db = new PGlite();
try {
  await db.exec(await readFile(new URL("../migrations/001-domain.sql",import.meta.url),"utf8"));
  await db.exec(await readFile(new URL("../migrations/003-manifest-uploads.sql",import.meta.url),"utf8"));
  const query = (text: string, args?: unknown[]) => db.query(text,args);
  const uploads = new PostgresManifestUploads({ query, async connect() { return {query,release(){}}; } } as unknown as Pick<Pool,"query"|"connect">);
  const sql = async (strings: TemplateStringsArray, ...params:unknown[]) => (await db.query<Record<string,unknown>>(strings.reduce((all,part,i)=>all+(i?`$${i}`:"")+part,""),params)).rows;
  const catalog = new NeonUserDeckCatalogRepository("test-only",sql);
  const oauth = {resourceMetadataUrl:"https://arcana.example/.well-known/oauth-protected-resource/mcp",readScopes:["decks:read"],writeScopes:["decks:write"]};
  async function connect(id: string|null, scopes=["decks:read","decks:write"]) {
    const principal = id ? {id,scopes}:null;
    const server = createArcanaMcpServer({catalog,principal,oauth:{...oauth,principal},adapter:id?new CatalogPersistingArcanaToolAdapter(createArcanaAdapter(),id,catalog):createArcanaAdapter(),manifestUploads:{uploads,uploadOrigin:"https://arcana.example"}});
    const client = new Client({name:"efficiency-test",version:"1"});
    const [a,b]=InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
    return {client,async close(){await client.close();await server.close();}};
  }
  const alice=await connect("alice"), bob=await connect("bob"), anon=await connect(null), reader=await connect("alice",["decks:read"]);
  try {
    const tools=(await alice.client.listTools()).tools;
    const stage=tools.find(t=>t.name==="stage_deck_manifest")!;
    assert.deepEqual(stage._meta?.["openai/fileParams"],["file"]);
    const validateTool=tools.find(t=>t.name==="validate_deck_manifest")!; assert.equal(validateTool.annotations?.readOnlyHint,false); assert.equal(validateTool.annotations?.idempotentHint,false);
    const fileSchema = (stage.inputSchema.properties as Record<string, any>).file;
    for(const key of ["download_url","file_id","mime_type","file_name"]) assert.ok(fileSchema.properties[key]);
    assert.deepEqual(fileSchema.required,["download_url","file_id"]);
    for(const session of [anon,reader]) assert.equal((await session.client.callTool({name:"stage_deck_manifest",arguments:{manifest:neutralManifest()}})).isError,true);
    const staged=toolResult<{uploadId:string;sha256:string}>(await alice.client.callTool({name:"stage_deck_manifest",arguments:{manifest:neutralManifest()}}));
    assert.match(staged.sha256,/^[0-9a-f]{64}$/);
    const validated=toolResult<{valid:boolean;uploadId:string;sha256:string}>(await alice.client.callTool({name:"validate_deck_manifest",arguments:{uploadId:staged.uploadId}}));
    assert.equal(validated.valid,true); assert.equal(validated.sha256,staged.sha256);
    for(const session of [bob,anon,reader]) assert.equal((await session.client.callTool({name:"validate_deck_manifest",arguments:{uploadId:staged.uploadId}})).isError,true);
    const imported=toolResult<{id:string;revision:number}>(await alice.client.callTool({name:"import_deck",arguments:{uploadId:staged.uploadId}}));
    assert.equal(imported.revision,1);
    assert.equal((await alice.client.callTool({name:"import_deck",arguments:{uploadId:staged.uploadId,deckId:imported.id,expectedRevision:1,replaceExisting:false}})).isError,true);
    assert.deepEqual(toolResult(await alice.client.callTool({name:"import_deck",arguments:{uploadId:staged.uploadId}})),imported);
    const manifest=toolResult<{schemaVersion:number;data:{cards:unknown}}>(await alice.client.callTool({name:"get_deck",arguments:{deckId:imported.id,view:"manifest"}}));
    assert.equal(manifest.schemaVersion,2); assert.ok(manifest.data.cards); assert.equal("cards" in manifest,false);
    const lean=await alice.client.callTool({name:"get_deck",arguments:{deckId:imported.id,view:"summary",responseFormat:"structured"}});
    assert.equal(lean.isError,undefined); assert.match((lean.content[0] as {text:string}).text,/Deck:/);
    const ticket=toolResult<{uploadUrl:string;headers:{Authorization:string}}>(await alice.client.callTool({name:"create_manifest_upload",arguments:{byteLength:2}}));
    assert.match(ticket.uploadUrl,/^https:\/\/arcana.example\/api\/manifest-uploads\//); assert.match(ticket.headers.Authorization,/^Bearer [A-Za-z0-9_-]{43}$/);
    const deniedUrl=await alice.client.callTool({name:"stage_deck_manifest",arguments:{file:{download_url:"http://127.0.0.1/secrets",file_id:"file-test"}}}); assert.equal(deniedUrl.isError,true);
    console.log("MCP transfer discovery, native file descriptor, staged reference flow, ownership/scopes and lean read tests passed.");
  } finally {await alice.close();await bob.close();await anon.close();await reader.close();}
} finally {await db.close();}
