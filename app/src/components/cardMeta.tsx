/** Presentation helpers for card metadata: glyph rendering plus compatibility re-exports of the
 * renderer-independent label/factorization helpers from the deck domain. */
import { useId } from "react";
import type { DeckDataFile } from "@/decks/types";
import type { CardData } from "@/decks/card";
import { majorGlyphSvg, suitGlyphSvg } from "@/decks/cardMeta";

export {
  RANK_ROMAN,
  RANK_NAME,
  SUIT_LABEL,
  rankLabel,
  rankBadge,
  suitLabel,
  omega,
  facVar,
  facWord,
  stationName,
} from "@/decks/cardMeta";

/** The Ultima glyphs, inlined and currentColor-recolorable (fallback when a deck supplies no SVG). */
export const GLYPHS: Record<string, string> = {
  crowns: `<path d="M15 70 L15 35 L35 55 L50 25 L65 55 L85 35 L85 70 Z" fill="currentColor"/><rect x="12" y="74" width="76" height="12" fill="currentColor"/><circle cx="50" cy="20" r="6" fill="currentColor"/><circle cx="15" cy="32" r="5" fill="currentColor"/><circle cx="85" cy="32" r="5" fill="currentColor"/>`,
  blades: `<polygon points="50,8 57,30 57,62 43,62 43,30" fill="currentColor"/><rect x="30" y="62" width="40" height="9" fill="currentColor"/><rect x="45" y="71" width="10" height="18" fill="currentColor"/><rect x="40" y="88" width="20" height="7" fill="currentColor"/>`,
  runes: `<line x1="50" y1="10" x2="50" y2="90" stroke="currentColor" stroke-width="9"/><line x1="50" y1="30" x2="80" y2="12" stroke="currentColor" stroke-width="9"/><line x1="50" y1="50" x2="20" y2="32" stroke="currentColor" stroke-width="9"/><line x1="50" y1="70" x2="80" y2="52" stroke="currentColor" stroke-width="9"/>`,
  moongates: `<path d="M20 88 L20 50 A30 30 0 0 1 80 50 L80 88 L66 88 L66 50 A16 16 0 0 0 34 50 L34 88 Z" fill="currentColor"/><circle cx="50" cy="42" r="10" fill="currentColor"/>`,
  major: `<circle cx="50" cy="26" r="17" fill="none" stroke="currentColor" stroke-width="10"/><rect x="44" y="42" width="12" height="50" fill="currentColor"/><rect x="28" y="56" width="44" height="11" fill="currentColor"/>`,
};

/** Render a set of inline SVG inner-paths inside a 0 0 100 100 viewBox (Ultima glyph fallback). */
export function Glyph({ which, size = 16 }: { which: string; size?: number }) {
  const inner = GLYPHS[which] ?? GLYPHS.major;
  return (
    <span
      aria-hidden
      style={{ display: "inline-flex", width: size, height: size, color: "currentColor", verticalAlign: "-0.15em" }}
      dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 100 100" width="${size}" height="${size}">${inner}</svg>` }}
    />
  );
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Per-instance-namespace any internal ids (mask/gradient/clip) so multiple copies of a deck SVG on
 * one page don't collide on `url(#id)`. */
function namespaceIds(svg: string, uid: string): string {
  const ids = Array.from(svg.matchAll(/id="([^"]+)"/g), (m) => m[1]);
  let out = svg;
  for (const id of ids) {
    const u = `${id}-${uid}`;
    out = out
      .replace(new RegExp(`id="${reEsc(id)}"`, "g"), `id="${u}"`)
      .replace(new RegExp(`url\\(#${reEsc(id)}\\)`, "g"), `url(#${u})`)
      .replace(new RegExp(`(xlink:href|href)="#${reEsc(id)}"`, "g"), `$1="#${u}"`);
  }
  return out;
}

/** Render a deck-supplied FULL <svg> string, sized and recolored via currentColor (ids namespaced). */
export function Svg({ svg, size = 16 }: { svg: string; size?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const sized = svg.replace(/<svg([^>]*)>/, (_m, attrs: string) =>
    `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="${size}" height="${size}">`);
  return (
    <span
      aria-hidden
      style={{ display: "inline-flex", width: size, height: size, color: "currentColor", verticalAlign: "-0.15em" }}
      dangerouslySetInnerHTML={{ __html: namespaceIds(sized, uid) }}
    />
  );
}

/** The right glyph for a card: deck-authored suit/major SVG when present, else the Ultima fallback. */
export function AxisGlyph({ deck, card, size = 16 }: { deck?: DeckDataFile; card: CardData; size?: number }) {
  const isMajor = card.arcana === "major";
  const raw = isMajor ? majorGlyphSvg(deck) : suitGlyphSvg(deck, card.suit_slug);
  if (raw) return <Svg svg={raw} size={size} />;
  return <Glyph which={isMajor ? "major" : card.suit_slug ?? "major"} size={size} />;
}
