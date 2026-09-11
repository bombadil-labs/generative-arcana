import type { CardData } from "./card";
import { immutableJsonSnapshot } from "./jsonSnapshot";
import { resolveCardNumberContext, type NumericFactorizationSource } from "./numericContext";
import type {
  DeckModule,
  DeckVisualLanguage,
  FactorizationData,
  RankVisualForm,
  StationVisualEnvironment,
  VisualFamilyGrammar,
} from "./types";

export const CARD_RENDER_SPEC_VERSION = 1 as const;

export interface CardRenderSpec {
  specVersion: typeof CARD_RENDER_SPEC_VERSION;
  deck: {
    id: string;
    name: string;
    slug: string;
    version: string;
    tagline: string;
    theme: DeckModule["data"]["theme"];
    visualLanguage?: DeckVisualLanguage;
  };
  context: {
    family: {
      kind: "suit" | "major";
      slug?: string;
      name: string;
      description?: string;
      legacyStyle?: string;
      visualGrammar?: VisualFamilyGrammar;
    };
    rank?: {
      slug: string;
      name: string;
      description?: string;
      legacyContent?: string;
      visualForm?: RankVisualForm;
    };
    station: {
      slug: string;
      name: string;
      description?: string;
      legacyMotif?: string;
      visualEnvironment?: StationVisualEnvironment;
    };
    dialectic?: Array<{ axis: string; pole: string }>;
    number: {
      label: string;
      origin: NumericFactorizationSource;
      factorization?: FactorizationData;
      factorizationSource?: NumericFactorizationSource;
    };
  };
  render: {
    material: {
      medium?: string;
      surface?: string;
      markMaking?: string;
      signatureAccent?: string;
      familyHandling?: string;
      deckFinish?: string;
      familyFinish?: string;
    };
    form: {
      familyComposition?: string;
      edgeLanguage?: string;
      valueStructure?: string;
      cameraAndScale?: string;
      detailDistribution?: string;
      rank?: RankVisualForm;
      numericLogic?: string;
    };
    environment?: StationVisualEnvironment;
    legacy: {
      familyStyle?: string;
      rankContent?: string;
      stationMotif?: string;
    };
    scene: {
      description: string;
      styleOverride?: string;
      contentOverride?: string;
    };
    avoid: string[];
  };
}

export type RenderableCard = CardData & { render: CardRenderSpec };

/**
 * Produce the deliberately denormalized card projection a human artist or generative renderer needs.
 * The source deck remains normalized; this view embeds inherited deck/family/rank/station/number context.
 */
export function resolveCardRenderSpec(deck: DeckModule, card: CardData): CardRenderSpec {
  const suit = card.suit_slug ? deck.data.suits[card.suit_slug] : undefined;
  const rank = card.rank_slug ? deck.data.ranks[card.rank_slug] : undefined;
  const station = deck.data.transversal.stations[card.station_slug];
  if (!station) throw new Error(`Card “${card.slug}” references missing station “${card.station_slug}”.`);

  const major = card.arcana === "major" ? deck.data.major_arcana : undefined;
  const familyGrammar = suit?.visual_grammar ?? major?.visual_grammar;
  const familyStyle = suit?.visual_style ?? major?.visual_style;
  const numberContext = resolveCardNumberContext(deck, card);
  const factorization = numberContext.factorization;

  let dialectic: Array<{ axis: string; pole: string }> | undefined;
  if (card.suit_slug && deck.data.dialectic) {
    const cell = deck.data.dialectic.cells[card.suit_slug];
    if (cell) {
      dialectic = [
        { axis: deck.data.dialectic.axes[0].name, pole: cell[0] },
        { axis: deck.data.dialectic.axes[1].name, pole: cell[1] },
      ];
    }
  }

  const render: CardRenderSpec = {
    specVersion: CARD_RENDER_SPEC_VERSION,
    deck: {
      id: deck.id,
      name: deck.name,
      slug: deck.data.slug,
      version: deck.data.version,
      tagline: deck.tagline,
      theme: deck.data.theme,
      ...(deck.data.visual_language ? { visualLanguage: deck.data.visual_language } : {}),
    },
    context: {
      family: card.arcana === "major"
        ? {
            kind: "major",
            name: "Major Arcana",
            ...(major?.story ? { description: major.story } : {}),
            ...(familyStyle ? { legacyStyle: familyStyle } : {}),
            ...(familyGrammar ? { visualGrammar: familyGrammar } : {}),
          }
        : {
            kind: "suit",
            slug: card.suit_slug!,
            name: suit?.name ?? card.suit_slug!,
            ...(suit?.description ? { description: suit.description } : {}),
            ...(familyStyle ? { legacyStyle: familyStyle } : {}),
            ...(familyGrammar ? { visualGrammar: familyGrammar } : {}),
          },
      ...(rank
        ? {
            rank: {
              slug: card.rank_slug!,
              name: rank.name,
              ...(rank.description ? { description: rank.description } : {}),
              ...(rank.visual_content ? { legacyContent: rank.visual_content } : {}),
              ...(rank.visual_form ? { visualForm: rank.visual_form } : {}),
            },
          }
        : {}),
      station: {
        slug: card.station_slug,
        name: station.name,
        ...(station.description ? { description: station.description } : {}),
        ...(station.visual_motif ? { legacyMotif: station.visual_motif } : {}),
        ...(station.visual_environment ? { visualEnvironment: station.visual_environment } : {}),
      },
      ...(dialectic ? { dialectic } : {}),
      number: {
        label: card.number,
        origin: numberContext.origin,
        ...(factorization ? { factorization } : {}),
        ...(numberContext.factorizationSource ? { factorizationSource: numberContext.factorizationSource } : {}),
      },
    },
    render: {
      material: {
        ...(deck.data.visual_language?.medium ? { medium: deck.data.visual_language.medium } : {}),
        ...(deck.data.visual_language?.surface ? { surface: deck.data.visual_language.surface } : {}),
        ...(deck.data.visual_language?.mark_making ? { markMaking: deck.data.visual_language.mark_making } : {}),
        ...(deck.data.visual_language?.signature_accent ? { signatureAccent: deck.data.visual_language.signature_accent } : {}),
        ...(familyGrammar?.medium_handling ? { familyHandling: familyGrammar.medium_handling } : {}),
        ...(deck.data.visual_language?.finish ? { deckFinish: deck.data.visual_language.finish } : {}),
        ...(familyGrammar?.finish ? { familyFinish: familyGrammar.finish } : {}),
      },
      form: {
        ...(familyGrammar?.composition ? { familyComposition: familyGrammar.composition } : {}),
        ...(familyGrammar?.edge_language ? { edgeLanguage: familyGrammar.edge_language } : {}),
        ...(familyGrammar?.value_structure ? { valueStructure: familyGrammar.value_structure } : {}),
        ...(familyGrammar?.camera_and_scale ? { cameraAndScale: familyGrammar.camera_and_scale } : {}),
        ...(familyGrammar?.detail_distribution ? { detailDistribution: familyGrammar.detail_distribution } : {}),
        ...(rank?.visual_form ? { rank: rank.visual_form } : {}),
        ...(factorization?.visual_logic ? { numericLogic: factorization.visual_logic } : {}),
      },
      ...(station.visual_environment ? { environment: station.visual_environment } : {}),
      legacy: {
        ...(familyStyle ? { familyStyle } : {}),
        ...(rank?.visual_content ? { rankContent: rank.visual_content } : {}),
        ...(station.visual_motif ? { stationMotif: station.visual_motif } : {}),
      },
      scene: {
        description: card.visuals.detailed_description,
        ...(card.visuals.style_override ? { styleOverride: card.visuals.style_override } : {}),
        ...(card.visuals.content_override ? { contentOverride: card.visuals.content_override } : {}),
      },
      avoid: unique([
        ...(deck.data.visual_language?.avoid ?? []),
        ...(familyGrammar?.avoid ?? []),
      ]),
    },
  };

  return immutableJsonSnapshot(render, "card render spec");
}

export function renderableCard(deck: DeckModule, card: CardData): RenderableCard {
  return Object.freeze({ ...card, render: resolveCardRenderSpec(deck, card) });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
