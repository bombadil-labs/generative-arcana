import { resolveSpread, type Spread } from "@/decks/spreads";
import type { DeckDataFile, DeckModule } from "@/decks/types";
import { isRecord } from "@/decks/validate";
import type { DealtCard, ReadingToken, StableReadingToken } from "./types";

export const MAX_QUESTION_LENGTH = 4000;
export const MAX_TOKEN_LENGTH = 65536;
const MAX_POSITIONS = 64;
const text = (v: unknown, max = 200): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const string = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

export function isSpread(value: unknown): value is Spread {
  if (!isRecord(value) || !text(value.id) || !text(value.name) || !string(value.description, 4000) ||
      (value.deckId !== undefined && !text(value.deckId)) || !Array.isArray(value.positions) ||
      !value.positions.length || value.positions.length > MAX_POSITIONS) return false;
  return value.positions.every((p) => isRecord(p) && text(p.name) && string(p.prompt, 4000));
}

function isToken(value: unknown): value is ReadingToken {
  if (!isRecord(value) || (value.v !== 1 && value.v !== 2) || !text(value.d) ||
      !string(value.q, MAX_QUESTION_LENGTH) || !Array.isArray(value.c) || !value.c.length || value.c.length > MAX_POSITIONS) return false;
  if (value.v === 1 ? !(text(value.s) || isSpread(value.s)) : !isSpread(value.s)) return false;
  if (value.v === 2 && (typeof value.r !== "string" || !/^[a-f0-9]{64}$/.test(value.r))) return false;
  const seen = new Set<unknown>();
  return value.c.every((tuple) => {
    if (!Array.isArray(tuple) || tuple.length !== 2 || (tuple[1] !== 0 && tuple[1] !== 1)) return false;
    const key = tuple[0];
    if (value.v === 1 ? !Number.isSafeInteger(key) || key < 0 : !text(key)) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Object key order is irrelevant; array order and all authored values remain significant. */
export function canonicalJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Deck revisions require JSON data.");
  return encoded;
}

export async function deckRevision(data: DeckDataFile): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(data));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function encodeReading(deck: DeckModule, spread: string | Spread, question: string, cards: DealtCard[]): Promise<string> {
  const resolved = resolveSpread(spread, deck.spreads);
  if (!isSpread(resolved)) throw new Error("Unknown or invalid spread.");
  if (resolved.deckId && resolved.deckId !== deck.id && resolved.deckId !== deck.data.slug) throw new Error("This spread belongs to a different deck.");
  if (cards.length !== resolved.positions.length) throw new Error("The number of cards must match the spread.");
  if (cards.some((c) => !Number.isSafeInteger(c.index) || c.index < 0 || !deck.cards[c.index] || typeof c.reversed !== "boolean")) throw new Error("Invalid dealt card.");
  const token: StableReadingToken = {
    v: 2, d: deck.data.slug, r: await deckRevision(deck.data), s: resolved, q: question,
    c: cards.map((c) => [deck.cards[c.index].slug, c.reversed ? 1 : 0]),
  };
  if (!isToken(token)) throw new Error("Invalid reading (check the question length, spread, and duplicate cards).");
  const bin = Array.from(new TextEncoder().encode(JSON.stringify(token)), (b) => String.fromCharCode(b)).join("");
  const encoded = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (encoded.length > MAX_TOKEN_LENGTH) throw new Error("This reading is too large to share as a link.");
  return encoded;
}

export function decodeReading(encoded: string): ReadingToken | null {
  if (!encoded || encoded.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const base = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base + "=".repeat((4 - base.length % 4) % 4));
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    return isToken(value) ? value : null;
  } catch { return null; }
}

/** Validate at this boundary too: callers need not trust a preceding decoder. */
export function tokenToDealt(value: unknown, deck: DeckModule): DealtCard[] | null {
  if (!isToken(value) || value.d !== (value.v === 1 ? deck.id : deck.data.slug)) return null;
  const indices = new Map(deck.cards.map((card, index) => [card.slug, index]));
  const result: DealtCard[] = [];
  for (const [key, reversed] of value.c) {
    const index = value.v === 1 ? key as number : indices.get(key as string);
    if (index === undefined || !deck.cards[index]) return null;
    result.push({ index, reversed: reversed === 1 });
  }
  return result;
}

export type ResolvedReading =
  | { ok: true; spread: Spread; dealt: DealtCard[]; question: string; legacy: boolean }
  | { ok: false; error: string };

export async function resolveReading(value: unknown, deck: DeckModule): Promise<ResolvedReading> {
  const fail = (error: string): ResolvedReading => ({ ok: false, error });
  if (!isToken(value)) return fail("This reading link is malformed or uses an unsupported format.");
  if (value.d !== (value.v === 1 ? deck.id : deck.data.slug)) return fail("This reading belongs to a different deck.");
  const spread = resolveSpread(value.s, deck.spreads);
  if (!isSpread(spread)) return fail("Unknown or invalid spread in this reading.");
  if (spread.deckId && spread.deckId !== deck.id && spread.deckId !== deck.data.slug) return fail("This spread belongs to a different deck.");
  if (value.c.length !== spread.positions.length) return fail("The reading's card count does not match its spread.");
  const dealt = tokenToDealt(value, deck);
  if (!dealt) return fail("A card in this reading is missing from this deck.");
  if (value.v === 2) {
    try {
      if (value.r !== await deckRevision(deck.data)) return fail("This reading uses a different deck revision. Load the original deck JSON to recover it; the current deck will not be substituted.");
    } catch { return fail("Unable to verify the deck revision. Open the app over HTTPS or localhost."); }
  }
  return { ok: true, spread, dealt, question: value.q, legacy: value.v === 1 };
}
