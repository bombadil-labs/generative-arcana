import type { ArcanaReading } from '../engine/types';
import { resolveCardRenderSpec } from '../decks/renderSpec';
import { visionFrames } from './settings';

export const READER_INPUT_BYTES = 64_000;
export const CONTEXT_TOO_LARGE = 'The full authored reading context exceeds the reader input limit. No descriptions were shortened or sent. Use a smaller deck context or conversation.';

/** Only project selected placements, never the deck's card catalogue. Keep the
 * authored card intact alongside the same inherited specification used by art. */
function sources(reading: ArcanaReading, revealed: number) {
  return reading.placements.slice(0, Math.max(0, Math.min(3, revealed))).map((p, index) => {
    const described = typeof p.card.visuals?.detailed_description === 'string' && !!p.card.visuals.detailed_description.trim();
    // Legacy/incomplete local sources may lack a scene. Preserve the source as-is
    // and mark that absence; an empty resolver input must not invent a depiction.
    const renderInput = { ...p.card, visuals: { ...p.card.visuals, detailed_description: p.card.visuals?.detailed_description ?? '' } };
    return {
      name: p.card.name, position: p.position.name, reversed: p.reversed, meaning: p.meaning,
      narrativeFrame: visionFrames[index], positionContext: p.position,
      visualGrounding: described ? 'authored_scene' : 'no_authored_scene',
      card: p.card, renderSpec: resolveCardRenderSpec(reading.deck, renderInput),
    };
  });
}

export function conversationContext(reading: ArcanaReading, revealed: number): string {
  const cards = sources(reading, revealed);
  return JSON.stringify({ question: reading.question, deck: reading.deck.name, currentCard: cards[cards.length - 1]?.name, cards });
}

/** One existing generation supplies the three sequential visions and closing.
 * Identity trailer remains separate from the full, lossless source text. */
export function narrationContext(reading: ArcanaReading): string {
  const identities = reading.placements.map(({ card, position, reversed }, index) => ({ slug: card.slug, name: card.name, position: position.name, reversed, narrativeFrame: visionFrames[index] }));
  return `AUTHORED VISION SOURCES\n${conversationContext(reading, 3)}\n\nCARD IDENTITIES IN ORDER\n${JSON.stringify(identities)}`;
}
