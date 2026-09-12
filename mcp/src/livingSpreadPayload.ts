import type { CardData } from "../../app/src/decks/card";
import type { CardRenderSpec } from "../../app/src/decks/renderSpec";
import type { Spread } from "../../app/src/decks/spreads";
import type { ServerSpreadScene } from "./staticVisuals";

export interface ResolvedReadingForLivingSpread {
  token: string;
  deckId: string;
  deckName: string;
  spread: Spread;
  question: string;
  placements: Array<{
    position: { name: string; prompt: string };
    card: CardData & { render: CardRenderSpec };
    reversed: boolean;
    meaning: string;
  }>;
}

export interface LivingSpreadPlacementPayload {
  index: number;
  position: string;
  positionPrompt: string;
  cardSlug: string;
  cardName: string;
  arcana: "major" | "minor";
  reversed: boolean;
  meaning: string;
  visual: {
    family: { kind: "major" | "suit"; slug?: string };
    rankSlug?: string;
    stationSlug: string;
    number: string;
    factorizationCharacter?: "identity" | "prime" | "composite";
    numericLogic?: string;
    sceneDescription: string;
  };
}

export interface LivingSpreadResultPayload {
  token: string;
  deckId: string;
  deckName: string;
  spreadId: string;
  spreadName: string;
  question: string;
  layout: {
    kind: "living-spread";
    format: string;
    packId: string;
    packLabel: string;
    interactive: true;
  };
  placements: LivingSpreadPlacementPayload[];
}

/**
 * Produce the compact, renderer-independent semantic payload consumed by MCP Living Spread widgets.
 * The source reading already contains schema-v2 render projections; this wire view selects stable
 * compositional signals without sending executable code or requiring follow-up deck lookups.
 */
export function buildLivingSpreadResult(
  reading: ResolvedReadingForLivingSpread,
  scene: ServerSpreadScene,
): LivingSpreadResultPayload {
  if (scene.deckId !== reading.deckId || scene.spreadId !== reading.spread.id) {
    throw new Error("Living Spread scene does not match the resolved reading.");
  }

  return {
    token: reading.token,
    deckId: reading.deckId,
    deckName: reading.deckName,
    spreadId: reading.spread.id,
    spreadName: reading.spread.name,
    question: reading.question,
    layout: {
      kind: "living-spread",
      format: scene.format,
      packId: scene.packId,
      packLabel: scene.packLabel,
      interactive: true,
    },
    placements: reading.placements.map((placement, index) => {
      const render = placement.card.render;
      const factorization = render.context.number.factorization;
      return {
        index,
        position: placement.position.name,
        positionPrompt: placement.position.prompt,
        cardSlug: placement.card.slug,
        cardName: placement.card.name,
        arcana: placement.card.arcana,
        reversed: placement.reversed,
        meaning: placement.meaning,
        visual: {
          family: {
            kind: render.context.family.kind,
            ...(render.context.family.slug ? { slug: render.context.family.slug } : {}),
          },
          ...(render.context.rank?.slug ? { rankSlug: render.context.rank.slug } : {}),
          stationSlug: render.context.station.slug,
          number: render.context.number.label,
          ...(factorization?.character ? { factorizationCharacter: factorization.character } : {}),
          ...(render.render.form.numericLogic ? { numericLogic: render.render.form.numericLogic } : {}),
          sceneDescription: render.render.scene.description,
        },
      };
    }),
  };
}
