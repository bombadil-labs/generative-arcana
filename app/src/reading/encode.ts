import { resolveSpread, type Spread } from "../decks/spreads";
import type { DeckModule } from "../decks/types";
import type { DealtCard, ReadingResolution, ReadingToken, StableReadingToken } from "./types";

const MAX_TOKEN_LENGTH = 65_536;
export const MAX_QUESTION_LENGTH = 4_000;
const MAX_POSITIONS = 512;
const SLUG = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === "string";
const nonempty = (v: unknown): v is string => text(v) && !!v.trim();

function validSpread(value: unknown): value is Spread {
  return isRecord(value) && nonempty(value.id) && nonempty(value.name) && text(value.description)
    && (value.deckId === undefined || nonempty(value.deckId))
    && Array.isArray(value.positions) && value.positions.length > 0 && value.positions.length <= MAX_POSITIONS
    && value.positions.every((p) => isRecord(p) && nonempty(p.name) && text(p.prompt));
}

function validToken(value: unknown): value is ReadingToken {
  if (!isRecord(value) || (value.v !== 1 && value.v !== 2) || !nonempty(value.d)
    || !text(value.q) || value.q.length > MAX_QUESTION_LENGTH
    || !Array.isArray(value.c) || !value.c.length || value.c.length > MAX_POSITIONS) return false;
  if (value.v === 2) {
    if (!text(value.h) || !/^[a-f0-9]{64}$/.test(value.h) || !validSpread(value.s)) return false;
  } else if (!nonempty(value.s) && !validSpread(value.s)) return false;
  const ids = new Set<string | number>();
  for (const tuple of value.c) {
    if (!Array.isArray(tuple) || tuple.length !== 2 || (tuple[1] !== 0 && tuple[1] !== 1)) return false;
    const id: unknown = tuple[0];
    if (value.v === 1) {
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) return false;
    } else if (!text(id) || !SLUG.test(id)) return false;
    if (ids.has(id as string | number)) return false;
    ids.add(id as string | number);
  }
  return true;
}

function b64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  if (!s.length || s.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) throw new Error("Invalid token encoding");
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/** Object key order is irrelevant; array order, strings, and all authored fields remain significant. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Deck data must contain only JSON values.");
  return encoded;
}

export async function deckFingerprint(deck: DeckModule): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(deck.data));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function encodeReading(
  deck: DeckModule,
  spread: string | Spread,
  question: string,
  cards: DealtCard[],
): Promise<string> {
  const resolvedSpread = resolveSpread(spread, deck.spreads);
  if (!validSpread(resolvedSpread) || (resolvedSpread.deckId && resolvedSpread.deckId !== deck.id)) throw new Error("Unknown or invalid spread for this deck.");
  if (cards.length !== resolvedSpread.positions.length) throw new Error("Deal one card for every spread position.");
  const tuples: StableReadingToken["c"] = cards.map(({ index, reversed }) => {
    if (!Number.isSafeInteger(index) || index < 0 || index >= deck.cards.length || typeof reversed !== "boolean") throw new Error("Invalid dealt card.");
    return [deck.cards[index].slug, reversed ? 1 : 0];
  });
  const token: StableReadingToken = { v: 2, d: deck.id, h: await deckFingerprint(deck), s: resolvedSpread, q: question, c: tuples };
  if (!validToken(token)) throw new Error("Invalid reading or question too long.");
  const encoded = b64urlEncode(JSON.stringify(token));
  if (encoded.length > MAX_TOKEN_LENGTH) throw new Error("This reading is too large to share as a link.");
  return encoded;
}

export function decodeReading(encoded: string): ReadingToken | null {
  try {
    const value: unknown = JSON.parse(b64urlDecode(encoded));
    return validToken(value) ? value : null;
  } catch {
    return null;
  }
}

/** Resolve before rendering anything. Failure must never silently produce a different/partial reading. */
export async function resolveReading(token: ReadingToken, deck: DeckModule): Promise<ReadingResolution> {
  if (!validToken(token)) return { ok: false, error: "This reading link is malformed." };
  if (token.d !== deck.id) return { ok: false, error: "This reading belongs to a different deck than the link's route." };
  const spread = resolveSpread(token.s, deck.spreads);
  if (!validSpread(spread)) return { ok: false, error: "Unknown or invalid spread in this reading." };
  if (spread.deckId && spread.deckId !== deck.id) return { ok: false, error: "This spread belongs to a different deck." };
  if (spread.positions.length !== token.c.length) return { ok: false, error: "The card count does not match the spread." };
  if (token.v === 1) {
    if (deck.custom) return { ok: false, error: "This legacy custom-deck link stores card positions, not identities. Its original order cannot be verified. Cast a new reading to create a stable link." };
    if (token.c.some(([i]) => i >= deck.cards.length)) return { ok: false, error: "This reading references a card outside the deck." };
    return { ok: true, spread, legacy: true, dealt: token.c.map(([index, rev]) => ({ index, reversed: rev === 1 })) };
  }
  if (token.h !== await deckFingerprint(deck)) return { ok: false, error: "This reading uses a different revision of the deck. Load the original deck JSON to view it; the current contents will not be substituted." };
  const bySlug = new Map(deck.cards.map((card, index) => [card.slug, index]));
  if (bySlug.size !== deck.cards.length) return { ok: false, error: "The loaded deck has duplicate card identities." };
  const dealt: DealtCard[] = [];
  for (const [slug, rev] of token.c) {
    const index = bySlug.get(slug);
    if (index === undefined) return { ok: false, error: `This reading references a missing card: ${slug}.` };
    dealt.push({ index, reversed: rev === 1 });
  }
  return { ok: true, dealt, spread, legacy: false };
}
