import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import deepTime from "../../decks/deep-time/deck.json";
import { createBetterAuthHarness } from "./better-auth-fixtures.js";
import { NeonExternalIdentityRepository } from "../src/neonExternalIdentityRepository.js";
import { NeonUserDeckCatalogRepository } from "../src/neonUserDeckCatalog.js";
import { NeonArcanaHostStateRepository } from "../src/neonHostStateRepository.js";
import { PersistentArcanaHostStore } from "../src/hostStore.js";
import { ExternalIdentityBrowserPrincipalResolver } from "../src/browserSession.js";
import { OAuthPrincipalResolver } from "../src/oauthIdentity.js";
import { createArcanaWebCatalogRequestHandler } from "../src/webCatalogApi.js";
import { createArcanaMcpServer } from "../src/server.js";

const h = await createBetterAuthHarness();
await h.pg.client.exec(await readFile(new URL("../migrations/001-domain.sql", import.meta.url), "utf8"));
const sql = async (strings: TemplateStringsArray, ...params: unknown[]) => {
  const statement = strings.reduce((all, part, i) => all + (i ? `$${i}` : "") + part, "");
  return (await h.pg.client.query<Record<string, unknown>>(statement, params)).rows;
};
const identities = new NeonExternalIdentityRepository("test-only", sql);
const catalog = new NeonUserDeckCatalogRepository("test-only", sql);
const hosts = new PersistentArcanaHostStore(new NeonArcanaHostStateRepository("test-only", sql), undefined, catalog);
const principalResolver = new OAuthPrincipalResolver(h.runtime.bearerVerifier, identities, []);
const browserPrincipalResolver = new ExternalIdentityBrowserPrincipalResolver(h.runtime.browserAuthenticator, identities);
const oauth = {resourceMetadataUrl:"https://arcana.example/.well-known/oauth-protected-resource/mcp", readScopes:["decks:read"],writeScopes:["decks:write"]};
const handler = createArcanaWebCatalogRequestHandler({catalog, hosts, principalResolver,browserPrincipalResolver,oauth});
const http = createServer((req,res)=>{void handler(req,res);});
await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
const address = http.address();
if (!address || typeof address === "string") throw new Error("Local integration server failed to bind");
const base = `http://127.0.0.1:${address.port}`;
const web = (path:string,cookie?:string,body?:unknown,method=body?"POST":"GET",token?:string) => fetch(base+path,{
  method, headers:{...(cookie?{cookie}:{}),...(body?{"content-type":"application/json"}:{}),...(token?{authorization:`Bearer ${token}`}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),
});
try {
  const alice = await h.signupVerify("alice-ownership@example.test","Alice");
  const bob = await h.signupVerify("bob-ownership@example.test","Bob");
  const clientA = await h.registerClient("ownership-client-a");
  const clientB = await h.registerClient("ownership-client-b");
  const readOnly = await h.registerClient("ownership-reader");
  const aliceA = (await h.authorize(alice.cookie,clientA.clientId)).tokens.access_token;
  const aliceB = (await h.authorize(alice.cookie,clientB.clientId)).tokens.access_token;
  const bobA = (await h.authorize(bob.cookie,clientA.clientId)).tokens.access_token;
  const aliceRead = (await h.authorize(alice.cookie,readOnly.clientId,"decks:read")).tokens.access_token;
  const aliceId = await identities.resolveOrCreate({issuer:h.runtime.issuer,subject:alice.user.id});
  const bobId = await identities.resolveOrCreate({issuer:h.runtime.issuer,subject:bob.user.id});
  assert.notEqual(aliceId,bobId);
  for (const token of [aliceA,aliceB]) assert.equal((await principalResolver.resolve({method:"POST",url:"/mcp",headers:new Headers({authorization:`Bearer ${token}`})}))?.id,aliceId);

  const data = structuredClone(deepTime); data.slug="alice-owned-private"; data.name="Alice private deck";
  const createdResponse=await web("/api/me/decks",alice.cookie,{data,tagline:"A private integration fixture"});
  assert.equal(createdResponse.status,201,await createdResponse.clone().text());
  const created=await createdResponse.json() as {id:string;visibility:string};
  assert.equal(created.visibility,"private");
  assert.equal((await catalog.get(created.id))?.ownerId,aliceId);
  for (const token of [aliceA,aliceB]) {
    const list=await web("/api/me/decks",undefined,undefined,"GET",token);
    assert.equal(list.status,200);
    assert.deepEqual((await list.json() as {id:string}[]).map(deck=>deck.id),[created.id]);
  }
  assert.deepEqual(await (await web("/api/me/decks",bob.cookie)).json(),[]);
  assert.equal((await web(`/api/decks/${created.id}`)).status,404);
  assert.equal((await web(`/api/decks/${created.id}`,bob.cookie)).status,404);
  assert.equal((await web(`/api/decks/${created.id}`,undefined,undefined,"GET",bobA)).status,404);
  assert.equal((await web(`/api/me/decks/${created.id}`,bob.cookie,undefined,"DELETE")).status,404);
  assert.equal((await web(`/api/me/decks/${created.id}`,undefined,{visibility:"public"},"PATCH",bobA)).status,400);
  assert.equal((await catalog.get(created.id))?.visibility,"private");
  assert.equal((await web(`/api/me/decks/${created.id}`,undefined,undefined,"DELETE",aliceRead)).status,403);
  assert.equal((await web(`/api/decks/${created.id}`,undefined,undefined,"GET",aliceRead)).status,200);

  const aliceMcp=await connectMcp(aliceB); const bobMcp=await connectMcp(bobA);
  try {
    assert.equal((await aliceMcp.client.callTool({name:"get_deck",arguments:{deckId:created.id}})).isError,undefined);
    for(const deckId of [created.id,data.slug]) assert.equal((await bobMcp.client.callTool({name:"get_deck",arguments:{deckId}})).isError,true);
    const bobList=await bobMcp.client.callTool({name:"list_my_decks",arguments:{}});
    assert.equal(JSON.stringify(bobList).includes(created.id),false);
    assert.equal((await bobMcp.client.callTool({name:"delete_my_deck",arguments:{deckId:created.id}})).isError,true);
  } finally {await aliceMcp.close();await bobMcp.close();}
  const connections=await (await h.request("/auth/connections",{cookie:alice.cookie})).json() as {clients:{id:string;clientId:string}[]};
  const grantA=connections.clients.find(row=>row.clientId===clientA.clientId)!;
  assert.ok(grantA);
  assert.equal((await h.request("/auth/connections/revoke",{cookie:bob.cookie,body:{id:grantA.id}})).status,404);
  assert.equal((await h.request("/auth/connections/revoke",{cookie:alice.cookie,body:{id:grantA.id}})).status,200);
  assert.equal((await web("/api/me/decks",undefined,undefined,"GET",aliceA)).status,401);
  assert.equal((await web("/api/me/decks",undefined,undefined,"GET",aliceB)).status,200,"disconnecting A leaves B authorized");
  assert.equal((await web("/api/me/decks",alice.cookie)).status,200,"disconnecting a client leaves browser session active");
  assert.equal((await web("/api/me/decks",undefined,undefined,"GET",bobA)).status,200,"disconnecting Alice does not revoke Bob's grant to the same client");
  const reconnect=(await h.authorize(alice.cookie,clientA.clientId)).tokens.access_token;
  assert.equal((await web("/api/me/decks",undefined,undefined,"GET",reconnect)).status,200);
  assert.equal((await web("/api/me/decks",undefined,undefined,"GET",aliceA)).status,401,"reconsent cannot revive a previously revoked JWT");
  console.log("Real Better Auth + PostgreSQL ownership passed: two users, browser + two OAuth clients, read scopes, private deck isolation, scoped disconnect and reconsent.");
} finally {
  await new Promise<void>((resolve,reject)=>http.close(error=>error?reject(error):resolve()));
  await h.close();
}

async function connectMcp(token:string) {
  const principal=await principalResolver.resolve({method:"POST",url:"/mcp",headers:new Headers({authorization:`Bearer ${token}`})});
  assert.ok(principal);
  const server=createArcanaMcpServer({adapter:await hosts.get(principal.id),catalog,principal,oauth:{...oauth,principal},includeStatefulTools:true});
  const client=new Client({name:"real-account-ownership-test",version:"1.0.0"});
  const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport),client.connect(clientTransport)]);
  return {client,close:async()=>{await client.close();await server.close();}};
}
