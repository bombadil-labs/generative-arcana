# Ulysses Majors — illustration plan through the control plane

Applying the sculptor→stager→painter pipeline (`tools/atelier/`, see
`CONTROL_PLANE.md`) to the 21 Ulysses majors. Pilot: `tools/atelier/projects/ulysses/telemachus.py` → `projects/ulysses/out/s_telemachus.png`.

## The mapping (the deck's structure IS the control plane)

- **Episode hour → the stager's light rig.** Ulysses is a single day; the majors are its hours.
  8am dawn (Telemachus/Calypso) through noon, dusk (Nausicaa), midnight (Circe), 2am starfield
  (Ithaca — "the heaventree of stars"), and out past the day entirely (Penelope's unpunctuated
  dark; Riverrun's pre-dawn river). The arc of the deck is a single lighting continuity.
- **Vico age (the transversal) → the painter's register.** Sublimation implemented in stroke
  behavior, per station:
  - **gods** — vast coherent fields, long strokes, strong vortices (myth organizes everything)
  - **heroes** — the bold impasto default (contested, monumental)
  - **men** — documentary: shorter, straighter strokes, muted chroma, weak vortices (the
    ordinary resists mythologizing)
  - **ricorso** — dissolution: global coherence drop, strokes permitted to trespass silhouettes
    (the world melting into flux; Proteus, Sirens, Circe, T-Z-P are all ricorso — Joyce agrees)
- **Attention → who the episode is about.** Each staging declares 1–2 `attend()` points
  (Mulligan aloft; the letter; the funeral cortège; Gerty across the strand) — the sky's
  vortices are the episode's centers of desire.
- **Figures are silhouette-grade** (`projects/ulysses/dublin.py` `person`: posable arms/lean, no faces — presences,
  not portraits). Bloom is distinguished by hat + coat mass, Stephen by slightness + ashplant;
  identity through posture and staging, never physiognomy.

## Bestiary to sculpt (reusable across episodes)

`person` (done: arms down/raised/akimbo, lean) · `martello_tower` (done) · variants needed:
seated figure, reclining figure (Penelope), walking figure · terrace house facade / doorway
(Calypso, Ithaca) · headstone + cypress (Hades) · pub bar mass (Cyclops) · bed (Penelope) ·
tram/newspaper press mass (Aeolus) · rocks + strand (Proteus, Nausicaa) · river (Riverrun).
Props as tiny high-value parts (the deck's cheese-equivalents): the bowl, the letter, the bar
of soap, the key, the cocoa cups, the fireworks.

## Per-episode staging sketch

| # | Card | Hour/light | Vico register | Stage (subjects · relation · attention) |
|---|---|---|---|---|
| 0 | Forger | no-hour; cold studio grey | gods | lone figure, arms akimbo, vast empty frame · attend: the empty sky itself |
| 1 | Telemachus | 8am dawn, sea | heroes | tower + Mulligan aloft (arms raised) + Stephen apart · attend: Mulligan, sun ✅ pilot |
| 2 | Nestor | 10am flat schoolroom light | men | seated figure + standing boy + coins on desk · attend: the coins |
| 3 | Proteus | 11am glare, strand | ricorso | one walking figure, eyes shut, wrack-line rocks · attend: his own footprints |
| 4 | Calypso | 8am interior warmth | gods | doorway + figure with tray + cat · attend: the doorway's light |
| 5 | Lotus Eaters | 10am languid sun | heroes | strolling figure + the letter (bright prop) · attend: the letter |
| 6 | Hades | 11am overcast | men | four mourners + headstones + one tall cypress · attend: the grave |
| 7 | Aeolus | noon, hard verticals | ricorso | press mass + wind-scattered pages · attend: the headline sheet |
| 8 | Lestrygonians | 1pm appetite light | gods | figure at window + gulls over the Liffey · attend: the gulls |
| 9 | Scylla & Charybdis | 2pm library dusk | heroes | two figures across a table, book rampart · attend: the book between |
| 10 | Wandering Rocks | 3pm shadowless | men | MANY small figures on crossing paths (the one crowd scene) · attend: none — flat field, no vortices (the episode with no center) |
| 11 | Sirens | 4pm bar amber | ricorso | two figures at a bar, bronze & gold · attend: the tuning fork |
| 12 | Cyclops | 5pm pub gloom | gods | giant shadow-figure vs small seated one + flung tin · attend: the biscuit tin mid-air |
| 13 | Nausicaa | 8pm dusk + fireworks | heroes | seated figure on rocks + distant watcher + ROCKET burst (star technique, one big) · attend: the rocket |
| 14 | Oxen of the Sun | 10pm ward lamplight | men | lamp + gathered figures round a table · attend: the lamp |
| 15 | Circe | midnight, gaslight | ricorso | doubled/mirrored figures, tilted frame, coherence floor · attend: two rival vortices of equal weight |
| 16 | Eumaeus | 1am shelter murk | gods | two slumped figures + coffee steam (mist channel, interior) · attend: the shared table |
| 17 | Ithaca | 2am star field | heroes | two figures in a garden looking UP + full emergent-star sky · attend: the heaventree itself (vortex high) |
| 18 | Penelope | unlit bedroom | men | reclining figure, window's faint grey, all flow curves converging inward · attend: the window |
| 19 | Trieste-Zurich-Paris | lamplit desk, no window | ricorso | writing figure + pages; the sky replaced by manuscript flow · attend: the page |
| 20 | Riverrun | pre-dawn river | gods | no figures — the river itself as flow field, running off-frame · attend: the river bend (the only card whose flow LEAVES) |

## Production notes

- One scene script per card (`tools/atelier/projects/ulysses/<episode>.py`), each ~25
  declarative lines against the stage API. Sculpt-once economics: ~10 new builders cover all 21.
- Register the output as a third Ulysses skin (`registerImagePack("ulysses", "vico-oil", …)`) —
  static PNGs from the pipeline, selectable next to "Animated" and "Pixel · Vico".
- Wandering Rocks (no vortices) and Riverrun (flow exits the frame) are the two cards that
  stress the control plane in new ways — schedule them after the bestiary matures.
