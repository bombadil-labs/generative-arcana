import type { Settings } from './settings';
import type { ArcanaReading } from '../engine/types';
export interface ParlorCapabilities {mode:'byok'|'hosted';models:{provider:'anthropic'|'openai';id:string}[];voices:string[];ownerKeys?:Settings['ownerKeys']}
export async function readParlorCapabilities(signal:AbortSignal):Promise<ParlorCapabilities> {
  const response=await fetch('/api/parlor/capabilities',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  if(!response.ok)throw new Error(response.status===403?'This account does not have hosted parlor access.':'Parlor is unavailable on this deployment.');
  const body=await response.json();
  if(body.mode==='byok'){
    const keys=body.ownerKeys;
    if(keys!==undefined&&(!keys||typeof keys!=='object'||typeof keys.elevenlabs!=='boolean'||!(keys.anthropicModel===null||typeof keys.anthropicModel==='string'&&/^claude-[A-Za-z0-9._-]{1,140}$/.test(keys.anthropicModel))))throw new Error('Parlor is unavailable on this deployment.');
    return {mode:'byok',models:[],voices:[],...(keys?{ownerKeys:{anthropicModel:keys.anthropicModel,elevenlabs:keys.elevenlabs}}:{})};
  }
  if(body.mode!=='hosted'||!Array.isArray(body.models)||!body.models.length||body.models.some((m:{provider:string;id:string})=>!m||!['anthropic','openai'].includes(m.provider)||typeof m.id!=='string')||!Array.isArray(body.voices)||body.voices.some((v:unknown)=>typeof v!=='string'))throw new Error('Parlor is unavailable on this deployment.');
  return body as ParlorCapabilities;
}
export async function ownerRequest(kind:'narrate'|'converse'|'speech',data:Record<string,unknown>,signal:AbortSignal) {
  const response=await fetch(`/api/parlor/owner/${kind}`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  if(!response.ok)throw new Error('The account provider is unavailable. Check server configuration or supply your own key.');
  return response;
}
export async function ownerTranscribe(audio:Blob,signal:AbortSignal):Promise<string> {
  if(!audio.size||audio.size>8_000_000)throw new Error('Invalid recording');
  const response=await fetch('/api/parlor/owner/transcribe',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'content-type':audio.type},body:audio});
  if(!response.ok)throw new Error('Account transcription unavailable');
  const value=await response.json();if(typeof value.text!=='string'||value.text.length>1200)throw new Error('Invalid transcription');return value.text.trim();
}
export async function hostedRequest(kind:'narrate'|'converse'|'speech',settings:Settings,reading:ArcanaReading,signal:AbortSignal,extra:Record<string,unknown>={}) {
  const response=await fetch(`/api/parlor/${kind}`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
    headers:{'content-type':'application/json'},body:JSON.stringify({operationId:crypto.randomUUID(),deckId:reading.deck.id,token:reading.token,character:settings.character,provider:settings.provider,model:settings.provider==='anthropic'?settings.anthropicModel:settings.openaiModel,...extra})});
  if(!response.ok)throw new Error(response.status===401||response.status===403?'Hosted access is unavailable. Exit the show and check your account.':response.status===429?'The hosted usage limit has been reached.':'This hosted step could not finish. A retry is a new potentially billable operation.');
  return response;
}
