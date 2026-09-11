import { resolveCardRenderSpec } from "../decks/renderSpec";
import type { ArcanaReading } from "../engine/types";
import type { SpreadSceneData, SpreadSceneRect } from "./spreadScene";

/**
 * Default host layout metadata for scenes that want card-like placement anchors.
 * Scene programs remain free to ignore these rectangles and compose the reading another way.
 */
export function defaultSpreadSceneRects(count: number): SpreadSceneRect[] {
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Spread scene layout requires at least one placement.");
  const columns = Math.min(count, Math.max(1, Math.ceil(Math.sqrt(count * 1.6))));
  const rows = Math.ceil(count / columns);
  const gapX = 0.03;
  const gapY = 0.04;
  const marginX = 0.04;
  const marginY = 0.06;
  const cellW = (1 - marginX * 2 - gapX * (columns - 1)) / columns;
  const cellH = (1 - marginY * 2 - gapY * (rows - 1)) / rows;

  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const col = index % columns;
    return {
      x: marginX + col * (cellW + gapX),
      y: marginY + row * (cellH + gapY),
      w: cellW,
      h: cellH,
    };
  });
}

/** Build the self-contained visual input one shared spread scene receives. */
export function buildSpreadSceneData(
  reading: ArcanaReading,
  rects: readonly SpreadSceneRect[] = defaultSpreadSceneRects(reading.placements.length),
): SpreadSceneData {
  if (rects.length !== reading.placements.length) {
    throw new Error(`Spread scene layout has ${rects.length} rectangles for ${reading.placements.length} placements.`);
  }

  return {
    deckId: reading.deck.id,
    spreadId: reading.spread.id,
    spreadName: reading.spread.name,
    spreadDescription: reading.spread.description,
    question: reading.question,
    seed: reading.token,
    placements: reading.placements.map((placement, index) => ({
      index,
      position: placement.position,
      card: placement.card,
      render: resolveCardRenderSpec(reading.deck, placement.card),
      reversed: placement.reversed,
      meaning: placement.meaning,
      rect: { ...rects[index]! },
    })),
  };
}
