import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { IncomingMessage, ClientRequest, RequestOptions } from "node:http";
import type { request } from "node:https";
import { fetchNativeFile, type NativeFileTransport } from "../src/nativeManifestFile";
import { ManifestUploadError } from "../src/manifestUploads";
const file = {file_id:"file-test",download_url:"https://files.oaiusercontent.com/test?private=redacted",mime_type:"application/json"};
const options = {maxBytes:8,mediaTypes:["application/json"]};
const fails = (status: number) => (error:unknown) => error instanceof ManifestUploadError && error.status===status;
function fixture({status=200,type="application/json",chunks=[Buffer.from("{}")],length,addresses=[{address:"8.8.8.8"}],slow=false,timeout=1000}:{status?:number;type?:string;chunks?:Buffer[];length?:number;addresses?:Array<{address:string}>;slow?:boolean;timeout?:number}={}) {
  let calls=0;let destroyed=false;let captured:RequestOptions|undefined;
  const transport:NativeFileTransport={lookup:async()=>addresses,signal:()=>AbortSignal.timeout(timeout),request:((url:URL, opts:RequestOptions, callback:(r:IncomingMessage)=>void)=>{
    calls++;captured=opts;
    assert.equal(url.protocol,"https:");assert.equal(url.hostname,"files.oaiusercontent.com");
    const req = new EventEmitter() as EventEmitter & {end:()=>void;destroy:()=>void};
    req.destroy=()=>{destroyed=true;};
    const signal=opts.signal as AbortSignal;
    signal.addEventListener("abort",()=>req.emit("error",new Error("Do not expose secret URL")),{once:true});
    req.end=()=>queueMicrotask(()=>{
      const response = (slow ? new Readable({read(){}}):Readable.from(chunks)) as IncomingMessage;
      response.statusCode=status;response.headers={"content-type":type,...(length===undefined?{}:{"content-length":String(length)})};
      callback(response);
    });
    return req as unknown as ClientRequest;
  }) as typeof request};
  return {transport,stats:()=>({calls,destroyed,captured})};
}
const good=fixture();assert.equal(Buffer.from(await fetchNativeFile(file,options,good.transport)).toString(),"{}");
const opts=good.stats().captured!;
assert.equal(opts.family,4);assert.equal(opts.agent,false);assert.equal((opts as Record<string,unknown>).rejectUnauthorized,undefined,"TLS certificate verification must not be disabled");
assert.equal((opts as Record<string,unknown>).servername,undefined,"original URL hostname drives TLS identity");
assert.equal((opts.headers as Record<string,string>).authorization,undefined,"native fetch never forwards account/capability credentials");
const pinned=opts.lookup as Function;
await new Promise<void>((resolve,reject)=>pinned("rebound.example",{},(error:unknown,address:string,family:number)=>{try{assert.equal(error,null);assert.equal(address,"8.8.8.8");assert.equal(family,4);resolve();}catch(e){reject(e);}}));
await new Promise<void>((resolve,reject)=>pinned("rebound.example",{all:true},(error:unknown,addresses:unknown)=>{try{assert.equal(error,null);assert.deepEqual(addresses,[{address:"8.8.8.8",family:4}]);resolve();}catch(e){reject(e);}}));
for(const status of [301,302,307,308,401,404,500]){const t=fixture({status});await assert.rejects(fetchNativeFile(file,options,t.transport),fails(502));assert.equal(t.stats().calls,1);assert.equal(t.stats().destroyed,true);}
await assert.rejects(fetchNativeFile(file,options,fixture({type:"text/html"}).transport),fails(502));
await assert.rejects(fetchNativeFile(file,options,fixture({length:9}).transport),fails(413));
await assert.rejects(fetchNativeFile(file,options,fixture({chunks:[Buffer.from("12345"),Buffer.from("6789")]}).transport),fails(413));
await assert.rejects(fetchNativeFile(file,options,fixture({chunks:[]}).transport),fails(400));
const badDns=fixture({addresses:[{address:"8.8.8.8"},{address:"127.0.0.1"}]});await assert.rejects(fetchNativeFile(file,options,badDns.transport),fails(400));assert.equal(badDns.stats().calls,0);
const timeout = fixture({slow:true,timeout:20});
// AbortSignal.timeout is intentionally unref'ed; keep the mocked transport alive until its deadline.
const keepAlive=setTimeout(()=>undefined,100);
try {await assert.rejects(fetchNativeFile(file,options,timeout.transport),error=>error instanceof ManifestUploadError&&error.status===502&&!error.message.includes("private="));}finally{clearTimeout(keepAlive);}
const dnsTimeout=fixture({timeout:20});dnsTimeout.transport.lookup=()=>new Promise(()=>{});
const keepDnsAlive=setTimeout(()=>undefined,100);try{await assert.rejects(fetchNativeFile(file,options,dnsTimeout.transport),fails(502));assert.equal(dnsTimeout.stats().calls,0);}finally{clearTimeout(keepDnsAlive);}
console.log("Native file transport mocks passed: pinned DNS (single/all), HTTPS defaults, no credentials, redirects/status/MIME failures, announced/chunked limits, empty body and DNS/body deadlines. Live-host TLS/file eligibility remains separate.");
