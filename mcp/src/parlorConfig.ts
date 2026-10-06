export type ParlorMode = 'disabled' | 'byok' | 'hosted';
export type LanguageProvider = 'anthropic' | 'openai';
export interface HostedModel { provider: LanguageProvider; id: string; maxCostMicrousd: number }
export interface ParlorConfig {
  mode: ParlorMode; origin: string; models: HostedModel[];
  keys: { anthropic?: string; openai?: string; elevenlabs?: string };
  voices: string[]; speechModel: string; speechCostMicrousd: number;
  userDailyMicrousd: number; globalDailyMicrousd: number;
  userConcurrency: number; globalConcurrency: number;
  maxInputBytes: number; maxOutputTokens: number; maxSpeechCharacters: number; timeoutMs: number;
  pricingReview: string; pricingExpires: number;
}
export class ParlorFault extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
const fail = (): never => { throw new Error('Invalid hosted parlor configuration; check server-only allowlists, keys, pricing review and limits.'); };
export function parlorConfig(env: NodeJS.ProcessEnv): ParlorConfig {
  const mode = env.PARLOR_MODE ?? 'disabled';
  if (!['disabled','byok','hosted'].includes(mode)) fail();
  const base: ParlorConfig = { mode: mode as ParlorMode, origin: '', models: [], keys: {}, voices: [], speechModel: '', speechCostMicrousd: 0,
    userDailyMicrousd: 0, globalDailyMicrousd: 0, userConcurrency: 0, globalConcurrency: 0,
    maxInputBytes: 0, maxOutputTokens: 0, maxSpeechCharacters: 0, timeoutMs: 0, pricingReview: '', pricingExpires: 0 };
  if (mode !== 'hosted') return base;
  const integer = (name: string, max: number) => { const raw=env[name]; const n=Number(raw); if (!raw || !/^[1-9][0-9]*$/.test(raw) || !Number.isSafeInteger(n) || n>max) fail(); return n; };
  let origin: URL; try { origin=new URL(env.BETTER_AUTH_URL!); } catch { return fail(); }
  if (origin.protocol!=='https:' || origin.origin!==env.BETTER_AUTH_URL) fail();
  const safeId=(value: unknown): value is string => typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(value);
  let models: unknown; try { models=JSON.parse(env.PARLOR_MODELS_JSON!); } catch { return fail(); }
  if (!Array.isArray(models) || !models.length || models.length>12) fail();
  const configured=models as HostedModel[];
  if (configured.some(m=>!m || !['anthropic','openai'].includes(m.provider) || !safeId(m.id) || !Number.isSafeInteger(m.maxCostMicrousd) || m.maxCostMicrousd<=0 || m.maxCostMicrousd>1_000_000_000)
    || new Set(configured.map(m=>m.provider+':'+m.id)).size!==configured.length) fail();
  const keys={anthropic:env.ANTHROPIC_API_KEY?.trim(),openai:env.OPENAI_API_KEY?.trim(),elevenlabs:env.ELEVENLABS_API_KEY?.trim()};
  if (configured.some(m=>!keys[m.provider])) fail();
  const voices=(env.PARLOR_VOICE_IDS ?? '').split(',').map(s=>s.trim()).filter(Boolean);
  if (voices.length>12 || voices.some(v=>!safeId(v))) fail();
  const speechModel=env.PARLOR_SPEECH_MODEL ?? '';
  if (voices.length && (!keys.elevenlabs || !safeId(speechModel))) fail();
  const pricingExpires=Date.parse(env.PARLOR_PRICING_EXPIRES_AT ?? '');
  const pricingReview=env.PARLOR_PRICING_REVIEW ?? '';
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(pricingReview) || !Number.isFinite(pricingExpires) || pricingExpires<=Date.now()) fail();
  return { ...base, origin:origin.origin, models:configured, keys, voices, speechModel,
    speechCostMicrousd:voices.length?integer('PARLOR_SPEECH_MAX_COST_MICROUSD',1_000_000_000):0,
    userDailyMicrousd:integer('PARLOR_USER_DAILY_MICROUSD',1_000_000_000), globalDailyMicrousd:integer('PARLOR_GLOBAL_DAILY_MICROUSD',1_000_000_000),
    userConcurrency:integer('PARLOR_USER_CONCURRENCY',4),globalConcurrency:integer('PARLOR_GLOBAL_CONCURRENCY',32),
    maxInputBytes:integer('PARLOR_MAX_INPUT_BYTES',64000),maxOutputTokens:integer('PARLOR_MAX_OUTPUT_TOKENS',2000),
    maxSpeechCharacters:voices.length?integer('PARLOR_MAX_SPEECH_CHARACTERS',4000):0,
    timeoutMs:integer('PARLOR_TIMEOUT_MS',90000),pricingReview,pricingExpires };
}
export function publicParlorConfig(config: ParlorConfig) {
  return {mode:config.mode,models:config.models.map(({provider,id})=>({provider,id})),voices:config.voices};
}
