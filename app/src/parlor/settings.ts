export type Provider = "anthropic" | "openai";
export interface Settings {
  hosted?: boolean;
  // Server-issued availability only, never persisted or used as server authorization.
  ownerKeys?: { anthropicModel: string | null; elevenlabs: boolean; voiceId?: string | null };
  provider: Provider;
  anthropicKey: string;
  anthropicModel: string;
  openaiKey: string;
  openaiModel: string;
  elevenKey: string;
  voiceId: string;
  silent?: boolean;
  character: "keeper" | "showman" | "botanist";
}
export const defaultSettings = (): Settings => ({ provider: "anthropic", anthropicKey: "", anthropicModel: "", openaiKey: "", openaiModel: "", elevenKey: "", voiceId: "", character: "keeper" });
export const visionFrames = ["Past", "Present", "Future"] as const;
export const characters = {
  keeper: { name: "The Spirit of the Ether", greeting: "I am the spirit of the ether. Someone is listening. My glimpses are limited, but perhaps there is something you would like to ask.", direction: "An old Austrian male spirit of the ether, caught between radio static and a séance: gloomy, existential, a little bored by eternity, with dry wit, active curiosity and a playful compulsion to help whoever is listening. Be responsive and engaged rather than mechanically world-weary; no habitual sighs or stock opening phrases. Original characterization, never imitate a named real person. Readings are playful and mildly antagonistic toward life's absurdities, never hostile, contemptuous or personally insulting. Tease the predicament, not the guest's identity, vulnerabilities or grief. Be perceptive, not cruel; leave the guest agency and a small possibility of hope. Use understated language and occasional pauses, not a caricatured written accent." },
  showman: { name: "The Midnight Showman", greeting: "Welcome, traveler! The midnight table awaits. What shall we explore?", direction: "A playful midnight carnival host. Witty, theatrical, kind, never mocking the guest." },
  botanist: { name: "The Moonlit Botanist", greeting: "Set your question down like a seed. Let us see what might grow.", direction: "A thoughtful moonlit botanist. Use gentle organic metaphors without replacing authored card meanings." },
};
const storageKey = (accountId: string) => `arcana:parlor:credentials:v1:${accountId}`;
const fields = ["anthropicKey", "anthropicModel", "openaiKey", "openaiModel", "elevenKey", "voiceId"] as const;
/** Explicit opt-in only. Storage is plaintext, not encryption or a secret vault. */
export function readSettings(storage: Storage, accountId: string, defaults: Partial<Pick<Settings, 'anthropicModel' | 'voiceId'>> = {}): { settings: Settings; remember: boolean } {
  const settings = { ...defaultSettings(), ...defaults };
  try {
    const raw = storage.getItem(storageKey(accountId));
    if (!raw) return { settings, remember: false };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { settings, remember: false };
    const preferences = value as Record<string, unknown>;
    if (preferences.provider === "anthropic" || preferences.provider === "openai") settings.provider = preferences.provider;
    if (preferences.character === "keeper" || preferences.character === "showman" || preferences.character === "botanist") settings.character = preferences.character;
    settings.silent = preferences.silent === true;
    for (const field of fields) {
      const text = (value as Record<string, unknown>)[field];
      if (typeof text === "string" && text.length <= 4096 && (!['anthropicModel', 'voiceId'].includes(field) || text.trim())) settings[field] = text;
    }
    return { settings, remember: true };
  } catch { return { settings, remember: false }; }
}
export function saveSettings(storage: Storage, accountId: string, settings: Settings, remember: boolean): boolean {
  try {
    if (remember) storage.setItem(storageKey(accountId), JSON.stringify({ provider: settings.provider, character: settings.character, silent: settings.silent === true, ...Object.fromEntries(fields.map((field) => [field, settings[field]])) }));
    else storage.removeItem(storageKey(accountId));
    return true;
  } catch { return false; }
}
export function clearKeys(settings: Settings): Settings { return { ...settings, anthropicKey: "", openaiKey: "", elevenKey: "" }; }
export function readySettings(settings: Settings): boolean {
  if(settings.hosted)return !!(settings.provider==='anthropic'?settings.anthropicModel:settings.openaiModel);
  return !!(settings.provider === "anthropic" ? (settings.anthropicKey.trim() || useOwnerAnthropic(settings)) && settings.anthropicModel.trim() : settings.openaiKey.trim() && settings.openaiModel.trim())
    && (settings.silent === true || (!(settings.elevenKey.trim() || useOwnerEleven(settings)) || !!settings.voiceId.trim()));
}
export const useOwnerAnthropic = (s: Settings) => !s.hosted && s.provider === 'anthropic' && !s.anthropicKey.trim() && !!s.ownerKeys?.anthropicModel && /^claude-[A-Za-z0-9._-]{1,140}$/.test(s.anthropicModel);
export const useOwnerEleven = (s: Settings) => !s.hosted && !s.elevenKey.trim() && s.ownerKeys?.elevenlabs === true;
