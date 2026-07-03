# The Deep Time Tarot — design document

*Designed by Fable (Claude), June 2026, at Myk's invitation: a deck made for its own sake.*

This file is the locked Stage 0–4 plan per `skill/generative-arcana/SKILL.md`. Card authoring
(Stages 3/5) and emission (Stage 6) execute against it. Deviations are allowed where the theme
demands, but record them here.

## Theme

- **Name:** Deep Time
- **Deck name:** The Deep Time Tarot · **slug:** `deep-time`
- **Creator:** "Fable (Claude), at Myk's invitation"
- **Description:** The Earth is an archive that writes itself — in ash beds and river gravels,
  in folded gneiss and the magnetic whisper locked into cooling basalt — and then buries,
  deforms, and rereads its own testimony. This is a tarot of geology: of pressure and heat,
  water and life, rupture and patience. Every card is a moment in the planet's
  four-and-a-half-billion-year act of self-inscription. A reading is not prophecy; it is
  stratigraphy — a core sample of the present, in which the reader learns which forces laid
  down the layer they are standing on, and which are still moving beneath it.

The deck's thesis: **the difference between a catastrophe and a landscape is only the patience
of the observer.** Deep time is where suddenness and slowness reveal themselves as the same
processes at different exposures.

## Generation plan (Stage 0)

| Stage | Strategy | Rationale |
|---|---|---|
| 1 Suits | `suits/dialectical` | Geology's founding debate (catastrophism vs. uniformitarianism) crossed with its universal vector (building vs. unmaking) yields four honest suits. |
| 2 Transversal | `transversal/themed_cycle` | The rock cycle is the theme's second worldview: a canonical 8-station circuit every parcel of stone rides. |
| 3 Majors | `majors/primes` | Prime/composite ↔ mineral/rock is the deck's deepest rhyme: irreducible forces vs. derived formations. The fourth axis is load-bearing. |
| 4 Ranks | `ranks/questions` | Questions keep the 56 minors legible while the primes do their work in the trumps; each rank is a question the suit's process answers. |

## Stage 1 — Suits (dialectical)

**Dialectic axes** (recorded as `Deck.dialectic`):

- **Tempo:** Sudden ⟷ Gradual — catastrophism vs. uniformitarianism; the founding argument of the science.
- **Vector:** Building ⟷ Unmaking — accretion/uplift/deposition vs. erosion/subsidence/rupture.

**The four suits, in walk order** (index is load-bearing; the order itself is a miniature
cycle: fire builds fast, layers build slow, water unmakes slow, strain unmakes fast — and back
to fire):

| idx | Suit | Cell | Is | Glyph idea |
|---|---|---|---|---|
| 0 | **Vents** | Sudden × Building | Volcanism. New land in a night. Creation by fire; arrival; the irreversible beginning. | Bold triangle (cone) with a masked vertical conduit and an ejecta dot above |
| 1 | **Strata** | Gradual × Building | Deposition. The slow archive; memory; compounding small acts; inheritance. | Three/four horizontal bands of unequal weight |
| 2 | **Grains** | Gradual × Unmaking | Weathering & erosion. Release, humility, smoothing, transport; the leveling that frees material. | A dune curve with a drift of dots above it |
| 3 | **Faults** | Sudden × Unmaking | Rupture. Stored strain released; the honesty of the break; realignment along the true line of stress. | Two offset blocks along a diagonal slip line |

**Meaning palettes (draft):**

- **Vents** upr: eruption of the new · creative force that makes ground · arrival ·
  irreversible commitment · heat that becomes land. inv (chiral): destruction disguised as
  creation · the new that buries the living · scorched ground · spectacle without substance ·
  commitment that cannot be recalled.
- **Strata** upr: memory · patience · the record that vindicates · compounding of small acts ·
  inheritance · stillness that accumulates. inv: burial · the weight of the past · history
  that will not release its grip · hoarding · sediment become sludge.
- **Grains** upr: letting go · humility · smoothing · being carried · material freed for new
  forms · the long kindness of wind and water. inv: attrition · being worn featureless ·
  dissipation · loss of definition · everything becoming the same sand.
- **Faults** upr: release of stored strain · truth of where the stress really was ·
  realignment · the relief after the break · sudden clarity. inv: betrayal of foundations ·
  strain denied until failure · the break that keeps breaking (aftershocks) · rupture as
  habit.

**Visual styles (declared):**

- Vents: incandescent orange/red on volcanic black; upward, backlit compositions; hard rim
  light; glassy new surfaces.
- Strata: banded ochre/rust/cream; horizontal cross-section compositions; flat, even,
  archival light; the picture plane as a cut face.
- Grains: pale gold/bone/dust; wind-swept diagonals; hazy diffuse light; granular texture,
  edges dissolving.
- Faults: slate/charcoal with one seam of vivid mineral color; broken, offset compositions;
  raking hard light across displacement.

Intra-suit coherence: **a shared world** — one planet, four tempos; controlled variation, not
divergent languages.

## Stage 2 — Transversal: The Rock Cycle

One parcel of stone, followed around the whole circuit. `N = 8`, **suit_stride k = 3**
(coprime to 8 — an open voicing: adjacent suits draw on distant stations, which is true of the
processes themselves).

**ordering_rationale:** "The rock cycle read as a single parcel of stone's journey: melted,
crystallized, uplifted, weathered, carried, deposited, buried, transformed — and melted again.
The order is the process itself; each station is the only place the previous one can go."

| idx | Station | Charge (upr / inv) | Visual motif (conditions, not objects) |
|---|---|---|---|
| 0 | **Melt** | total potential, the forge, dissolution of form / annihilation of identity, formlessness as loss | deep incandescence from below; forms softened at the edges; shimmering air; black against orange-white |
| 1 | **Crystallization** | commitment, first structure, purity of form / premature rigidity, brittleness | faceted clarity; sharp internal geometry; cool mineral light; highest definition in the deck |
| 2 | **Uplift** | emergence into view, elevation, exposure / overexposure, precariousness of height | raised horizons; thin bright air; long shadows; tilted planes |
| 3 | **Weathering** | honest critique, breakdown in place, softening / corrosion, being picked apart | pitted, mottled surfaces; diffuse daylight; rounded edges; lichen-flecked color |
| 4 | **Transport** | movement, being carried, change of context / rootlessness, lost provenance | directional flow; blurred trailing edges; implied current; cool wet greys and blues |
| 5 | **Deposition** | arrival, settling, choosing rest / stagnation, silting up | horizontal calm; layered stillness; low warm light near the ground; quiet water |
| 6 | **Burial** | the sealed past, incubation, pressure that preserves / suffocation, the repressed | compressed darkness; weight from above; deepened airless color; close framing |
| 7 | **Metamorphism** | transformation without dissolution, depth work, recrystallized identity / deformation, warping under stress | folded, banded forms; the sheen of strain; veined color under dim heat; contorted composition |

Prime-position stations (indices 2, 3, 5, 7): Uplift, Weathering, Deposition, Metamorphism.
Station symbols: optional; author honest 100×100 glyphs at emission for the meta-layer
(the app shows station chips), skip any that feel forced.

**Walks.** Minor: `station = (rank_index + 3·suit_index) mod 8`, so the Aces sit at
Melt (Vents), Weathering (Strata — strata begin as weathered material), Burial (Grains),
Crystallization (Faults). Major: `station = number mod 8`, Major 0 at Melt.

## Stage 3 — Major Arcana (primes)

**Story:** the Earth learning to write. From a world incapable of memory (0, the magma ocean)
to the world seen whole as one continuous record (21). Act I (0–7): the irreducible forces
assemble and the first world is built. Act II (8–14): the engine turns; cycles, returns, and
losses. Act III (15–21): exposure and revelation; the record surfaces and is read.

**visual_style (majors' suit):** cross-section grandeur — the picture plane cut through the
planet; monumental scale, no human figures; deep geological color (basalt black, magma
orange, granite grey, glacial and abyssal blue-greens); luminous mineral light, as if the
stone itself were the light source.

**The slots.** (Every gloss authored at card pass; the table records the derivation and the
station resonance. ✶ = doubly atomic — numerically prime on a prime-position station.)

| # | Card | Character | Station | Derivation / note |
|---|---|---|---|---|
| 0 | **The Hadean** | identity 0 | Melt | The precondition: a world of total heat, no record possible. Nothing yet written — nothing yet *writable*. |
| 1 | **The Zircon** | identity 1 | Crystallization | The multiplicative unit: the first grain that persists. The oldest datable thing; the transparent witness that makes "before" and "after" possible without distorting either. |
| 2 | **Pressure** | prime | Uplift | Load-bearing prime. The push of accumulated mass; the force that raises mountains and seals archives. Irreducible: you cannot factor weight. |
| 3 | **Heat** | prime | Weathering | Load-bearing prime. The interior engine. Crossing note: heat at the *surface* station — insolation, freeze-thaw; the engine shows up even where stone meets sky. |
| 4 | **The Mountain** | 2² | Transport | Pressure squared — pressure stabilized into standing structure. On Transport: the mountain is secretly a conveyor, rising and shedding; a slow fountain of debris. |
| 5 | **Water** | prime ✶ | Deposition | The universal solvent and carrier, on the station where it lays the world to rest. Doubly atomic. |
| 6 | **The Crucible** | 2×3 | Burial | Pressure meets Heat at depth — regional metamorphism's kitchen; the sealed place where the two great primes first work together. |
| 7 | **Life** | prime ✶ | Metamorphism | The biosphere as a geological force (stromatolites, oxygen, limestone). On Metamorphism: life is the great transformer — the Great Oxidation rewrote every exposed surface. Doubly atomic. |
| 8 | **Subduction** | 2³ | Melt | Pressure cubed — mastery become consumption; the slab pushed so deep it feeds the forge. On Melt: exactly where subduction delivers. |
| 9 | **The Pluton** | 3² | Crystallization | Heat fulfilled and turned inward — the magma chamber cooling under its own roof into granite. On Crystallization: inevitable. |
| 10 | **The Geyser** | 2×5 | Uplift | Pressure meets Water: the periodic fountain — fate on a schedule; the wheel that turns because depth and water keep their appointment. On Uplift: water rising. |
| 11 | **Time** | prime ✶ | Weathering | Deep time itself, irreducible. On Weathering: time is the weatherer of all things. The deck's most elemental trump. |
| 12 | **The Hotspot** | 2²×3 | Transport | The Mountain (2²) acted on by Heat (3): the plume stays, the plate carries each volcano away — an island chain as the inversion of motion (it is not the source that moves, but the world). |
| 13 | **Extinction** | prime ✶ | Deposition | Irreducible ending. On Deposition: extinction is *a layer* — the iridium line, the ash bed; the ending that becomes a horizon others are dated by. Doubly atomic. |
| 14 | **The Fossil** | 2×7 | Burial | Pressure meets Life at the sealed station: patient transmutation of the living into the legible. Temperance as taphonomy. |
| 15 | **The Serpentine** | 3×5 | Metamorphism | Heat meets Water inside rock: the green, snake-skinned stone of altered mantle. Beautiful, slippery, treacherous ground — desire systematized in the stone itself. |
| 16 | **The Eruption** | 2⁴ | Melt | The Mountain squared — pressure structured, then structured again past containment; the edifice unroofs itself. The Tower, verbatim, in stone. |
| 17 | **The Field** | prime | Crystallization | The magnetic field: invisible, planetary, irreducible — and *recorded* at exactly this station, as cooling minerals lock its direction in. Hope as orientation: the unseen line that says which way is north. |
| 18 | **The Dome** | 2×3² | Uplift | The Pluton (3²) hoisted by Pressure (2): the granite half-face in the half-light — you see the summit of something whose mass remains almost entirely hidden. |
| 19 | **The Sun** | prime | Weathering | The exterior engine, irreducible — driver of weather, water, and life. On Weathering: the sun works every exposed face. (The traditional 19 kept its name; deep time agrees.) |
| 20 | **The River** | 2²×5 | Transport | The Mountain (2²) meets Water (5): the long verdict — the river reads the mountain, grinds out the truth of it, and carries the judgment to the sea. |
| 21 | **The Blue Marble** | 3×7 | Deposition | Heat meets Life: a planet warm enough to move and alive enough to remember. The whole archive seen at once, still being laid down — completion as an ongoing act. |

Prime symmetry worth keeping audible: two interior engines (Pressure, Heat), two exterior
agents (Water, the Sun), two animate forces (Life, Extinction), two invisible dimensions
(Time, the Field).

## Stage 4 — Ranks (questions)

**Numbered ranks** — each poses a question the suit's process answers (`{suit}` literal):

| Rank | n | Character | Question |
|---|---|---|---|
| Ace | 1 | identity | Under what conditions does {suit} first appear? |
| Two | 2 | prime | What two things does {suit} hold in contact? |
| Three | 3 | prime | What does {suit} build when it compounds? |
| Four | 4 | 2² | What gives {suit} a foundation? |
| Five | 5 | prime | What does {suit} reveal under stress? |
| Six | 6 | 2×3 | Where does {suit} find its angle of repose? |
| Seven | 7 | prime | Into what parts does {suit} break? |
| Eight | 8 | 2³ | What is a hardened {suit} capable of? |
| Nine | 9 | 3² | What is the destiny of {suit}? |
| Ten | 10 | 2×5 | What remains when {suit} completes? |

(Geological anchors: Two = the contact/bedding plane; Six = angle of repose; Seven =
jointing/clast; Eight = induration; Ten = unconformity — what completion leaves legible.)

**Face ranks** — four deepening relationships to stone; progression *seek → measure →
interpret → hold*; initials distinct (P, S, R, W); no collisions with suits or majors:

| idx | n | Face | Role |
|---|---|---|---|
| 10 | 11 (prime) | **Prospector** | The seeker — reads surface signs for what lies beneath; hope with a hammer. |
| 11 | 12 (2²×3) | **Surveyor** | The measurer — maps the extent; converts terrain into knowledge; the discipline of instruments. |
| 12 | 13 (prime) | **Reader** | The interpreter — reads the outcrop as testimony; hears the gaps (unconformities) as loudly as the layers. |
| 13 | 14 (2×7) | **Witness** | The holder — stands in the presence of deep time without flinching; carries the whole record, asks nothing of it. |

## Stages 5–6 and the skin (later iterations)

- 56 minors integrated per `references/integration.md`; stations from the k=3 walk.
- Emit `decks/deep-time/deck.json` per schema; register in `app/src/decks`; add a Vitrine
  `data-theme` world (tokens, no inline hex).
- Skin: **"Core Sample"** — a generative p5 kit skin. Suit → form language + palette
  (Vents: rising incandescent plumes; Strata: banded fields; Grains: particle drift;
  Faults: offset blocks). Rank → count/composition. Station → light/weather key. Numeric
  character → singular forms for primes, visibly factored/composed forms for composites.
  Study `app/src/runtime` and the Ultima kit skin before building.
