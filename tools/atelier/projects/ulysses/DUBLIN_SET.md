# The Dublin Set — a reusable 1904 city model for the Ulysses majors

One persistent stage set, geographically honest, that every city card visits with its own
camera. Built at world scale (1 unit = 1.75 m); coordinates: **x = east, y = up, z = south**,
origin at O'Connell (Carlisle) Bridge. Not a Borges map — a *skyline instrument*: landmarks
sculpted individually at true height/position, districts as procedural terrace fill, water as
the shared ground plane with land platforms.

## Landmarks (LOD: 3–8 primitives each; heights true)

| Landmark | pos (E, S) m | top | Cards served |
|---|---|---|---|
| Nelson's Pillar (1809–1966, standing in 1904) | (0, −350) | 40.8 m | 5, 7 (Aeolus opens at the Pillar), 8, skyline |
| GPO portico | (−40, −400) | ~20 m | 7, skyline |
| Custom House + dome (Gandon) | (+450, −100) | ~38 m | skyline from the docks; 16 (Eumaeus nearby) |
| Four Courts + dome | (−700, −150) | ~40 m | 10, upriver skyline |
| Trinity campanile | (+150, +350) | 30 m | 9 (Library nearby), 8 |
| St George's spire (Hardwicke Pl) | (−100, −900) | ~60 m | 4, 17, 18 (Eccles St soundscape) |
| Christ Church tower | (−950, +500) | ~30 m | SW skyline |
| St Patrick's spire | (−900, +900) | 43 m | SW skyline |
| Ormond Hotel (quay block) | (−350, −30) | 4 storeys | 11 (Sirens) |
| 7 Eccles St (terrace house) | (−350, −1100) | 3 storeys | 4, 17, 18 |
| Great South Wall (Ringsend → 4 mi E) | (+2300..+5500, +400) | deck +2 m | **0 (Forger)**, 3, 13 vicinity |
| Poolbeg Lighthouse (1820 form) | (+5500, +350) | ~20 m, red | 0, 3 horizon accents |
| Sandymount Strand | (+2000.. , +1200) | flat | 3 (Proteus), 13 (Nausicaa) |
| Martello Tower, Sandycove | far SE satellite | 12 m | 1 (Telemachus) — own local set |

Anachronism guards: **no Poolbeg chimneys** (1970s), no Liberty Hall, no Spire.

## Structure

- `dublin_set.py` exposes `build_city(st, precincts=("river", "docklands", ...))` — returns a
  dict of landmark placements (each with anchors, e.g. `city["custom_house"].anchor("dome_top")`)
  so cards can `attend()` any landmark. Terrace fill generates along quay/street axes per
  precinct; density trimmed to what the card's camera can see.
- Water is the shared ground box (the Liffey, the docks, the bay are one surface); land is
  raised platforms (+1.7 u) north and south of a ~30 u river gap, opening into the bay east of
  x ≈ +750.
- Aerial haze ranges are per-card (the framer's business), typically start 60 / end 700 for
  cross-city shots.

## Forger staging (card 0)

Stephen on a **North Wall dock** (x ≈ +610, z ≈ −25) — "the edge of a pier" with deep-sea
berths, true to 1904. Camera on the river SE of him: he stands centered foreground; upriver to
frame-left the city recedes — Custom House dome nearest, Pillar and spires behind, declining
into haze; to frame-right the river mouth opens east into the bay's horizon. City legible at
300–1200 m; the whole-spire-vs-lens problem dissolves because the skyline is at true skyline
distance.

Sources: the [Ulysses map tradition](https://www.michaelgroden.com/notes/map.html) ·
[Nelson's Pillar](https://en.wikipedia.org/wiki/Nelson's_Pillar) ·
[Poolbeg Lighthouse / Great South Wall](https://en.wikipedia.org/wiki/Poolbeg_Lighthouse) ·
[Gunn & Hart, *James Joyce's Dublin*](http://www.riverrun.org.uk/JJD2_Small.pdf)
