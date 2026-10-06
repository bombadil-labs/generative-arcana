export type Provider = "anthropic" | "openai";
export interface Settings {
  hosted?: boolean;
  provider: Provider;
  anthropicKey: string;
  anthropicModel: string;
  openaiKey: string;
  openaiModel: string;
  elevenKey: string;
  voiceId: string;
  character: "keeper" | "showman" | "botanist";
}
export const defaultSettings = (): Settings => ({ provider: "anthropic", anthropicKey: "", anthropicModel: "", openaiKey: "", openaiModel: "", elevenKey: "", voiceId: "", character: "keeper" });
export const characters = {
  keeper: { name: "The Candlekeeper", greeting: "Come closer to the candle. What question have you brought to the table?", direction: "A warm, mysterious candlekeeper. Quiet theatrical language, welcoming and never ominous." },
  showman: { name: "The Midnight Showman", greeting: "Welcome, traveler! The midnight table awaits. What shall we explore?", direction: "A playful midnight carnival host. Witty, theatrical, kind, never mocking the guest." },
  botanist: { name: "The Moonlit Botanist", greeting: "Set your question down like a seed. Let us see what might grow.", direction: "A thoughtful moonlit botanist. Use gentle organic metaphors without replacing authored card meanings." },
};
const storageKey = (accountId: string) => `arcana:parlor:credentials:v1:${accountId}`;
const fields = ["anthropicKey", "anthropicModel", "openaiKey", "openaiModel", "elevenKey", "voiceId"] as const;
/** Explicit opt-in only. Storage is plaintext, not encryption or a secret vault. */
export function readSettings(storage: Storage, accountId: string): { settings: Settings; remember: boolean } {
  const settings = defaultSettings();
  try {
    const raw = storage.getItem(storageKey(accountId));
    if (!raw) return { settings, remember: false };
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return { settings, remember: false };
    const preferences = value as Record<string, unknown>;
    if (preferences.provider === "anthropic" || preferences.provider === "openai") settings.provider = preferences.provider;
    if (preferences.character === "keeper" || preferences.character === "showman" || preferences.character === "botanist") settings.character = preferences.character;
    for (const field of fields) {
      const text = (value as Record<string, unknown>)[field];
      if (typeof text === "string" && text.length <= 4096) settings[field] = text;
    }
    return { settings, remember: true };
  } catch { return { settings, remember: false }; }
}
export function saveSettings(storage: Storage, accountId: string, settings: Settings, remember: boolean): boolean {
  try {
    if (remember) storage.setItem(storageKey(accountId), JSON.stringify({ provider: settings.provider, character: settings.character, ...Object.fromEntries(fields.map((field) => [field, settings[field]])) }));
    else storage.removeItem(storageKey(accountId));
    return true;
  } catch { return false; }
}
export function clearKeys(settings: Settings): Settings { return { ...settings, anthropicKey: "", openaiKey: "", elevenKey: "" }; }
export function readySettings(settings: Settings): boolean {
  if(settings.hosted)return !!(settings.provider==='anthropic'?settings.anthropicModel:settings.openaiModel);
  return !!(settings.provider === "anthropic" ? settings.anthropicKey.trim() && settings.anthropicModel.trim() : settings.openaiKey.trim() && settings.openaiModel.trim())
    && (!settings.elevenKey.trim() || !!settings.voiceId.trim());
}
