# The Expert Witness Audit — a Joycean topographer reviews the Dublin Set

*Protocol: before any "done," the work is shown to an imagined domain expert of the highest
standard, and we write his honest reaction — enthusiasm, dismay, and specifics — checked
against the model's actual numbers. This file is the first such audit (2026-07-03), reviewing
the state at campaign wrap (JOURNAL.md, iteration 9).*

---

**The Professor** — a cultural anthropologist and Joyce topographer, the kind of man who has
walked Bloom's routes with a pedometer and knows which side of Sackville Street held the
morning shade — is shown the aerial, the Sackville probe, the Eccles doorway, and the three
cards.

## His first reaction

He leans in. He is *not* dismissive — that matters. "The bones are literate," he says. The
Pillar at 40.8 metres — correct, and he checks it against the GPO. The tower at Sandycove
**on its rise** — "most models forget the rock." The Great South Wall running its true four
miles to Poolbeg. Bloom's door as a *named, queryable anchor* delights him more than any
render: "You've built an instrument, not a diorama. I could stage the funeral route on this."
Persons at 1.72 m against 12–15 m terraces — he measures the probe walkers against the
frontages and nods: **the human ratio is right.**

Then he starts seeing the things he cannot unsee.

## The dismay list (verified against the model)

| # | Finding | Our number | 1904 truth | Severity |
|---|---|---|---|---|
| 1 | **Sackville Street width** | 13 u ≈ 22.7 m (all streets share `STREET_W`) | ~49 m — "the widest street in Europe"; its breadth IS its identity | **Fatal to the probe.** "You have built Sackville as an alley." Streets need per-street widths |
| 2 | **The canals are missing** | none | The Grand and Royal Canals RING the city; Bloom crosses the Grand Canal in Hades; the city's very shape is canal-bounded | **Major.** A Dubliner feels the canals like a belt |
| 3 | **Georgian door height** | 2.5 u ≈ 4.4 m | door ~2.4 m + fanlight ≈ 3.2 m total | **Comic once seen.** "A door for giants" (visible in the Eccles probe) |
| 4 | **Facade bay rhythm** | bays every 5.4 m | Georgian bays 3.0–3.6 m | Facades read half-empty; terraces are tighter, more vertical |
| 5 | **Block interiors are empty terrain** | rows only line streets | dense roofscape: mews lanes, returns, yards, infill | Aerials show pale voids mid-block where a roof-sea belongs |
| 6 | **The Loop Line bridge is absent** | 3 road bridges only | the 1891 railway viaduct crossing east of Butt Bridge, famously ruining the Custom House view | He *wants* the eyesore: "it is the most 1904 object on the river" |
| 7 | **Wellington Testimonial missing** | Phoenix Park is a bare rise | 62 m obelisk — taller than the Pillar, visible across the city | Major skyline omission to the west |
| 8 | **No shops** | ground floors are doors/windows | Sackville/Dame/Grafton ground floors: shopfronts, awnings, signage | Commercial streets read residential |
| 9 | **Street life is thin** | walkers only | horse trams' overhead electric wires + poles (proudly electrified 1901), cabs, drays, cattle, cyclists | The tracks without wires are "a museum of the future" |
| 10 | **The Liffey's bends are invented** | picturesque meanders | the city-reach Liffey runs channelled and near-straight between quays; bends live upstream at Islandbridge | "You gave the river a novelist's curves. Joyce would approve; a cartographer will not" |
| 11 | **O'Connell Bridge proportions** | 15 u wide slab | famously as wide as it is long (~50 m) | Related to #1; the bridge-as-plaza is a Dublin signature |
| 12 | **Four Courts drum too slight** | dome r = 4 u | the drum-dome is a broad rotunda, the river's great swelling | Reads as a bump, not the landmark |
| 13 | **No coal smoke** | clean air | 1904 Dublin breathed coal; chimneys were WORKING | The mist channel exists — a smoke variant is cheap and transformative |

## His verdict

"**A promising armature — a stage maquette with scholarly bones, not yet a portrait.**
I could not teach topography from it without corrections, but I could *stage* on it tomorrow,
and that is not faint praise — no one has handed me a Dublin I can put a camera in before.
Fix the street widths and dig the canals first: a Dubliner feels those in his body. Then give
me the Loop Line, the Wellington obelisk, and chimney smoke, and I will start telling people
about this."

Excited or disappointed? **Both, in the correct order** — excited by the instrument,
disappointed by specifics, and the specifics are all fixable because the instrument is sound.

## Prioritized fixes (next campaign round)

1. **Per-street widths** (`PRINCIPALS` gains a width field; Sackville 28 u, quays 14, Dame 15,
   side streets 8) + O'Connell Bridge resized to match.
2. **The two canals** as carved terrain arcs with lock blocks, ringing the core.
3. **Door/bay scale**: door 1.9 u total w/ fanlight; bays every ~3.4 m (window rhythm ×1.6 denser).
4. **Loop Line viaduct** (dark lattice slab east of Butt Bridge) + **Wellington obelisk**.
5. **Block infill**: rooftop-sea fill inside block polygons (coarse masses, no facades needed).
6. **Smoke**: mist-channel variant seeded at chimney lines, drifting with a wind direction.
7. **Shopfront band** on commercial principals (awning-colored strip + denser ground openings).
8. **Tram standards + catenary hint** on tram streets; a horse-cart builder for street life.

## The standing rule

This audit is now the atelier's **definition of done for any "true-to-life" claim**: summon
the most knowledgeable, least-flatterable expert the subject admits; show, don't describe;
write his dismay list with numbers checked against the model; fix by severity. The test is
repeatable for any deck's world — a geologist for Deep Time's strata, a naval historian for
the threemaster's rig.

---

# Audit 2 — The Transport Historian (2026-07-03, campaign round 11)

*A railway-and-tramway historian — the sort who owns the DUTC fleet lists and knows which
routes ran which liveries — walks the model after the Professor.*

## His first reaction

The Loop Line pleases him enormously ("you built the eyesore — good"). The tram tracks on
Sackville, the quays, Westmoreland: correct choice of streets. Then he stops dead.

## The dismay list (verified against the model)

| # | Finding | Our state | 1904 truth | Severity |
|---|---|---|---|---|
| 1 | **No rail termini at all** | zero stations | FIVE termini ring the city — Amiens St (GNR), Westland Row (DSER), Broadstone (MGWR), Kingsbridge (GSWR), Harcourt St (DSER) — the city's gates; Bloom's Hades route passes two | **Fatal.** "A 1904 city with no railway stations is not a city" |
| 2 | **Tracks without wires** | rails only | DUTC electrified 1901 — poles + overhead running wire, proudly modern | **Major** — flagged in Audit 1 (#9), still owed |
| 3 | **No trams** | none | ~330 cars in service; the Pillar was THE terminus — "trams slowed, shunted, changed trolley" (Aeolus) | **Major.** The Pillar without trams is a sundial |
| 4 | **No cab ranks** | none | jaunting cars + growlers at ranks (the Pillar, colleges, stations); Hades opens IN a cab | Moderate |
| 5 | **Loop Line unconnected** | 62 u river span only | it runs Westland Row → Amiens St, station to station | Moderate — follows free once #1 lands |

## Round-11 fixes (by severity)

1. Four termini as sited masses: Amiens St + Westland Row aligned to the Loop Line ends,
   Broadstone on its NW rise, Kingsbridge west along the river. (Harcourt St journaled as owed.)
2. Tram standards + overhead wire on the tram streets; centre poles on Sackville's twin track.
3. A DUTC double-deck open-top tram builder; cars placed at the Pillar terminus + en route.
4. A jaunting-car rank on Sackville's east side by the Pillar.

---

# Audit 3 — The Architect (2026-07-03, campaign round 13)

*A historian of Georgian and Victorian building fabric — the sort who can date a doorcase
to a decade from its fanlight — reviews the street probes and the station approaches.*

## The dismay list (verified against the model)

| # | Finding | Our state | 1904 truth | Severity |
|---|---|---|---|---|
| 1 | **Rooflines are flat slabs** | roof = one box + a continuous "chimney line" ridge | Georgian terraces end in a **street-face parapet**; behind it, slate slopes; at every party wall a **chunky chimney stack with clay pots** — the sawtooth of stacks IS the Dublin skyline | **Fatal to every probe.** "Your streets have lids, not roofs" |
| 2 | **No window reveals** | shader windows flush with the wall plane | sashes sit ~100 mm back in brick reveals; the shadow line is what makes a wall read as masonry | Major (city-wide flatness); real geometry exists only in detail zones |
| 3 | **Station fronts are mute blocks** | facade grid only (R11 render) | a terminus announces itself: arched entrance arcade, string course, cornice | Major — "I cannot find the way in" |
| 4 | **Chimney line reads as a ridge** | one long thin block | stacks are discrete, paired at party walls, 2–4 pots each | Folded into #1 |

## Round-13 fixes (by severity)

1. Parapet + discrete party-wall chimney stacks with pots, city-wide (`_row_along`, tenements).
2. Entrance arcade + cornice on the four termini fronts.
3. Window reveals: journaled as owed (city-wide geometry is an object-count decision; detail
   zones first).

---

# Audit 4 — The Professor Returns (2026-07-03, campaign round 18)

*Sixteen rounds after his first visit, he is shown: the aerial (aerial11), Sackville with its
trams (probe_sackville_r17b), the Monto court (rawls_r9_monto), the Liberties (rawls_r10_coombe2),
five termini frames, the bridge view west (quays_west), a random shopping-street drop
(rawls_r18), and the 45 MB GLB with its collision sidecar.*

## The original dismay list, scored

| # | Finding (1st visit) | Verdict now |
|---|---|---|
| 1 | Sackville as an alley | **✓** 28 u ≈ 49 m; the probe reads boulevard |
| 2 | Canals missing | **✓** both carved, verified from the air |
| 3 | Doors for giants | **✓** 2.4 m + fanlight |
| 4 | Bays half-empty | **✓** ~3.4 m rhythm |
| 5 | Block interiors void | **✓** infill roof-sea (424 masses, census-counted) |
| 6 | No Loop Line | **✓** viaduct + both its stations now stand at its ends |
| 7 | No Wellington | **✓** verified on its rise |
| 8 | No shops | **✓** joinery + fascia + awnings; a RANDOM drop landed on a shopping street |
| 9 | Street life thin | **◐** trams, wires, cab rank, walkers — but no drays, cattle, cyclists |
| 10 | Liffey's invented bends | **✓ by measurement** — city reach runs ±10 u of straight between the quays (channelled, as demanded); the swings live upstream at Islandbridge where the real river does bend. *Withdrawn with apologies to the model.* |
| 11 | O'Connell Bridge a slab | **✓** 30 u — as wide as it is long |
| 12 | Four Courts drum slight | **✓ this round** — broad colonnaded rotunda, 6.2 u copper dome, lantern |
| 13 | No coal smoke | **✓** plumes off Guinness, the quays, the tenement belt; haze in every probe |

**Eleven fixed, one withdrawn, one partial.**

## What he notices unprompted

The sawtooth of chimney stacks against the sky ("THAT is a Dublin street"). Washing strung
across the Monto courts. The Liberties reading whitewashed and low with St Patrick's beyond.
A campanile at Amiens Street. And that a *randomly seeded* drop landed him outside a
draper's with awnings out.

## His new list (shorter, sharper)

1. Windows sit flush — cut the reveals (the architect said it first).
2. Only three tram routes wired; the rest of the network is owed its poles.
3. The bridge deck is bare — balustrade detail and its famous lamps.
4. Station arcades are flat panels; give them depth when the reveals come.
5. No drays, no cattle to the market, no cyclists — the last of the street life.

## His verdict

"**It is a city now.** Sparse in its blood still, but I recognize Dublin — I could teach the
geography from your aerial and stage all fifteen episodes without apology. Sixteen rounds ago
I called it a maquette; I withdraw that. Wire the rest of the trams, cut the reveals, and I
will bring my students."
