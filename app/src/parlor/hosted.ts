import type { Settings } from './settings';
import type { ArcanaReading } from '../engine/types';
import { CONTEXT_TOO_LARGE } from './context';
export interface ParlorCapabilities {mode:'byok'|'hosted';models:{provider:'anthropic'|'openai';id:string}[];voices:string[];ownerKeys?:Settings['ownerKeys'];transcriptLogging?:boolean}
const ownerErrors: Record<string,string> = {
  context_too_large: CONTEXT_TOO_LARGE,
  provider_access_refused: 'The account provider refused access. Check its key permissions and model or voice access in setup.',
  provider_request_rejected: 'The account provider rejected this request. Check the selected model or voice in setup.',
  provider_resource_unavailable: 'The selected account model or voice is unavailable. Check its ID and account access in setup.',
  provider_rate_limited: 'The account provider is busy or its usage limit was reached. Wait before retrying.',
  provider_unavailable: 'The account provider could not complete this request. Retry later.',
  provider_connection_failed: 'The server could not reach the account provider. Retry later.',
  unusable_provider_response: 'The account provider returned an unusable response. Retry this step with the same cards.',
  invalid_reading: 'This reading no longer matches the saved deck. Reset the encounter and reload the deck.',
};
export class OwnerRequestError extends Error {}
export async function readParlorCapabilities(signal:AbortSignal):Promise<ParlorCapabilities> {
  const response=await fetch('/api/parlor/capabilities',{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
  if(!response.ok)throw new Error(response.status===403?'This account does not have hosted parlor access.':'Parlor is unavailable on this deployment.');
  const body=await response.json();
  if(body.mode==='byok'){
    const keys=body.ownerKeys;
    if(keys?.voiceId!==undefined&&keys.voiceId!==null&&(typeof keys.voiceId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(keys.voiceId)))throw new Error('Parlor is unavailable on this deployment.');
    if(keys!==undefined&&(!keys||typeof keys!=='object'||typeof keys.elevenlabs!=='boolean'||!(keys.anthropicModel===null||typeof keys.anthropicModel==='string'&&/^claude-[A-Za-z0-9._-]{1,140}$/.test(keys.anthropicModel))))throw new Error('Parlor is unavailable on this deployment.');
    return {mode:'byok',models:[],voices:[],transcriptLogging:body.transcriptLogging===true,...(keys?{ownerKeys:{anthropicModel:keys.anthropicModel,elevenlabs:keys.elevenlabs,...(keys.voiceId!==undefined?{voiceId:keys.voiceId}:{})}}:{})};
  }
  if(body.mode!=='hosted'||!Array.isArray(body.models)||!body.models.length||body.models.some((m:{provider:string;id:string})=>!m||!['anthropic','openai'].includes(m.provider)||typeof m.id!=='string')||!Array.isArray(body.voices)||body.voices.some((v:unknown)=>typeof v!=='string'))throw new Error('Parlor is unavailable on this deployment.');
  return body as ParlorCapabilities;
}
export async function ownerRequest(kind:'narrate'|'converse'|'speech',data:Record<string,unknown>,signal:AbortSignal) {
  const response=await fetch(`/api/parlor/owner/${kind}`,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',signal,headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  if(!response.ok){
    const value:unknown=await response.json().catch(()=>null);
    const code=value&&typeof value==='object'&&'error' in value?value.error:undefined;
    throw new OwnerRequestError(typeof code==='string'&&Object.prototype.hasOwnProperty.call(ownerErrors,code)?ownerErrors[code]:'The account provider is unavailable. Check server configuration or supply your own key.');
  }
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
  if(!response.ok)throw new Error(response.status===413?CONTEXT_TOO_LARGE:response.status===401||response.status===403?'Hosted access is unavailable. Exit the show and check your account.':response.status===429?'The hosted usage limit has been reached.':'This hosted step could not finish. A retry is a new potentially billable operation.');
  return response;
}
