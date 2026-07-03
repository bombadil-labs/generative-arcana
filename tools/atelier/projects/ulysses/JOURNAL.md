# Dublin Set — build journal

Campaign goal (Myk, July 2026): bring the 1904 set to *life* — side streets, neighborhoods,
row-houses, churches, manors; terrain with hills; a river that turns correctly; a real harbor;
the Martello tower on its rise. Phased, self-paced loop; this journal records goals set,
goals attained, and honest misses. Renders in `out/aerial*/`, `out/survey*/`.

## Phase plan

- **P1 — Terrain & water**: heightfield land (city bowl, Phoenix Park rise W, Dublin/Wicklow
  ridge S, Howth head NE at its true ~170 m, Killiney SE), the Liffey as a *curving* carved
  channel, Dublin Bay's crescent with Sandymount flats emerging at low tide height, bridges,
  quay walls; Martello tower at Sandycove on its rock rise.
- **P2 — Street network**: principal streets as real polylines (the quays, Sackville/
  Westmoreland axis, Dame St, Grafton, Capel, Thomas St...), side streets procedurally derived,
  blocks as the negative space.
- **P3 — Building fabric**: row-houses filling blocks with party-wall rhythm + chimney pots,
  churches per real distribution, institutions (Trinity quads, Castle, Mansion House),
  docklands sheds; LOD by distance-to-probe-zones.
- **P4 — Landmarks & satellites**: colonnade/pilaster detail on Gandon buildings, Howth
  village + Baily light, Pigeon House, Bull Wall, Kingstown harbour piers.
- **P5 — Survey & validation**: aerial + street-level probe renders vs. map references;
  per-card staging spot-checks (Forger, Telemachus, Hades, Wandering Rocks).

## Log

### 2026-07-02 · Iteration 0 — campaign start
- Journal + phase plan created. Baseline: rectangular land slabs, straight 40 u river, eight
  landmarks, precinct terrace strips (see `out/aerial/card.png`, the "grid-shaped, mostly
  empty" state Myk critiqued). Goal for Iteration 1: **P1 complete** — terrain heightfield with
  the named hills, carved curving Liffey, real bay crescent, bridges, quays, Sandycove +
  Martello. Evidence: wide aerial + bay survey render.

### 2026-07-02 · Iteration 1 — P1 terrain landed, coast too platonic
- DONE: heightfield terrain (88k verts, height+slope vertex colors: strand/grass/heather),
  queryable `terrain_height(x,z)`, carved curving Liffey, bay depression, Howth/Killiney/
  Wicklow-ridge masses, Sandycove rise + Martello drum, three bridges, quay walls.
  Survey: `out/aerial2/card.png`.
- MISSES (goals for Iteration 2):
  1. The bay is a perfect ellipse — compose an irregular crescent: coastal noise on the shore
     contour, Howth as a true PENINSULA (pushing into the bay, Sutton isthmus), Bull island
     sliver, Dun Laoghaire harbour arms SE.
  2. Relief illegible under flat noon — survey renders get a LOW RAKING SUN so hills shadow.
  3. Survey framing: shoot from over Howth looking SW down the bay (city, wall, Sandycove in
     one sweep) instead of wasting half the frame on open water.

### 2026-07-02 · Iterations 2–3 — coast opened, THE FABRIC LANDED
- DONE (P1 finish): ragged coastline (fBm noise on the shore contour), Howth as peninsula with
  Sutton neck, Bull Island sliver, Kingstown harbour arms, the bay OPENED to the Irish Sea
  along the Howth→Dalkey diagonal (`out/aerial3-4/`).
- DONE (P2+P3 core): street network of 12 principals as real-ish polylines (quays, Sackville,
  Westmoreland/Grafton, Dame, Capel, Henry/Mary, Talbot, Gardiner, Dorset→Eccles, Thomas,
  Baggot) with jittered perpendicular side streets; continuous row-house strips (brick/stone,
  slate roofs, chimney lines) lining every street both sides, gapped at junctions; ~10 parish
  churches (nave+tower+spire); Trinity's two hollow quads, Dublin Castle + Bedford tower,
  Mansion House. Survey `out/aerial5/card.png`: the city reads as a living street web —
  no longer "grid-shaped and mostly empty."
- HONEST NOTES: rooftops read near-black under the 20° raking survey sun (slate + grazing
  light is physically right, legibility poor) — survey rig wants ~35° elevation and a touch
  more ambient. Fabric density still core-only; no NE/SW neighborhoods beyond principals.
- GOALS Iteration 4: (a) survey light calibration; (b) fabric spread: Eccles St terrace row
  named + anchored (Bloom's door), docklands sheds tied to fabric, a southside spread toward
  Merrion; (c) FIRST STREET-LEVEL PROBE render (the real test of "life"): stand a camera in
  Sackville Street at eye height, Pillar ahead — if the street reads as a street, P3 passes.

### 2026-07-02 · Iteration 4 — the probe's verdict: monumental, not yet street
- DONE: survey sun calibrated to ~35°; neighborhood spread (Merrion, Summerhill, Coombe
  principals); Eccles Street terrace with anchored **bloom_door** (No. 7); FIRST STREET-LEVEL
  PROBE `out/probe_sackville/card.png` — eye height, mid-Sackville, four walkers.
- VERDICT: Nelson's Pillar reads superbly (true monumental scale, plinth + capital, walker for
  scale; warm raking morning light; a De Chirico stillness that's genuinely atmospheric). But
  the street reads as a PLAZA: facades are windowless at eye level, no curbs/pavement, no lamp
  posts, no tram tracks (Sackville was the tram hub). **Aerial fabric ≠ street fabric.**
- GOALS Iteration 5 (Phase 3b — the eye-level layer):
  1. Facade grammar for row-houses near probe zones: window/door rhythm (decide: recessed
     blocks LOD'd by camera distance vs. a baked "window-grid" grain channel the painter
     renders — lean geometry-near/grain-far).
  2. Street furniture kit: lamp post, tram track pair (thin dark strips), curb/pavement strips
     along rows; scatter along principals.
  3. Re-probe Sackville + a second probe at Eccles St front door (Calypso's opening shot).

### 2026-07-02 · Iteration 5 — the street arrives
- DONE (P3b): facade grammar in detail zones (window/sill/door bays, geometry-near only);
  street furniture kit — gas lamps (zoned), TRAM TRACK pairs on Sackville/quays/Westmoreland,
  curbed pavements; Eccles terrace got facades + the proud-of-wall door fix.
- PROBE VERDICTS:
  · Sackville re-probe (`out/probe_sackville2/`): PASSES — tram tracks running to the Pillar's
    foot + lamp globes + windowed frontages turned the plaza into a 1904 street.
  · Eccles door (`out/probe_eccles/`): terrace reads, Georgian rhythm reads; punch list —
    windows should recess not sit proud, facade-door rhythm collides with the anchored Bloom
    door (doubled), doorways want granite steps + area railings; camera math note: work in
    street (u, n) frame, never absolute offsets (two black frames earned this lesson).
- GOALS Iteration 6: (a) window inset look (thinner + reveal shadow) + de-dupe Bloom's door +
  steps/railings kit; (b) GPO builder (portico + colonnade — Sackville probe misses it);
  (c) VALIDATION START: migrate forger_set.py to the full living set (its docklands backdrop
  now has a real city behind it) and re-render the Forger staging as the first card-off-the-set.

### 2026-07-02 · Iteration 6 — first card off the living set
- DONE: window recess look (thin panes), Bloom door aligned + granite step + area rails, GPO
  (mass + hexastyle portico + pediment) registered; **forger_set.py migrated to the full living
  set** — 16 landmark groups, drop-in, zero staging surgery (the set API held). The river
  gained its bridge silhouette in the card's middle distance (real + compositionally right).
  Renders: `out/forger5/card.png` + `painted.png`.
- VALIDATION VERDICT: set mechanics PASS. The painted card remains gated on the same defect a
  second time: thin/critical geometry (threemaster masts, the dome) gets buried by the stroke
  field. **The EMPHASIS channel is now the campaign's blocking item** — promoted to Iteration 7:
  stager `emphasize(placements...)` → baked per-pixel emphasis map (span mask, dilated to
  protect thin masts) → painter spends finer strokes + contrast + silhouette protection there.
- Iteration 7 goals: (1) emphasis channel end-to-end; (2) repaint forger5 — if ship + dome
  survive, the flagship card lands and P5 validation continues to Sackville/Wandering Rocks.

### 2026-07-02 · Iteration 7 — the emphasis channel lands; FLAGSHIP CARD PASSES
- DONE: emphasis end-to-end (stage.emphasize → dilated span-mask channel → painter: finer
  strokes + contrast boost + protected pseudo-region that outside strokes cannot enter).
  CONTROL_PLANE.md updated (channel moved from reserved → implemented).
- REPAINT VERDICT (`out/forger6/painted.png`): the threemaster survives with masts and yards
  legible; Stephen crisp; the dome reads at the horizon. All three emphasized subjects
  protected. The Forger card meets its canonical content with all key subjects legible —
  **flagship gate passed.** Residual polish (non-blocking): sky hue variety, ship value -10%,
  the book remains sub-pixel at this distance (long-flagged optics reality).
- NEXT (Iteration 8+): P5 validation spread — Wandering Rocks on the living set (the true
  "map come to life" card: aerial, men register, NO vortices — our old no-center stretch card
  finally on its real stage); then P4 satellites (Howth/Sandymount detail for Proteus,
  Kingstown for Telemachus's horizon).

### 2026-07-02 · Iteration 8 — Wandering Rocks: the map come to life
- DONE: `wandering_set.py` — the full living set from the indifferent altitude; 14 scattered
  walkers + the viceregal cavalcade in file down Sackville, all emphasized; NO vortices; men
  register. `out/wandering2/painted.png`: the labyrinth thesis LANDS — streets as pale channels
  through dark woven fabric, the Liffey bisecting with bridges, centerless. Possibly the most
  distinctive card yet.
- HONEST MISS: the vignette walkers are ~2 px at this altitude — below stroke size even with
  emphasis protection. Flag: the episode's simultaneous-lives element needs either inset-
  vignette composition (post-collage) or acceptance ("people subsumed by the city-machine").
- NEXT (Iteration 9 — closing the circle): TELEMACHUS on the living set. Myk's founding note —
  "the tower from chapter 1, that stands on a hill" — the Sandycove Martello has stood on its
  rise since P1. Stage: Mulligan aloft (arms raised), Stephen below on the rocks, dawn over the
  open sea toward the bay mouth, Kingstown piers on the horizon. Then campaign wrap + full
  before/after survey.

### 2026-07-02 · Iteration 9 — Telemachus at Sandycove; CAMPAIGN CORE COMPLETE
- DONE: `telemachus_set.py` — the tower ON ITS RISE (real terrain), Mulligan perched aloft,
  Stephen on the seaward rocks, dawn sun over the bay mouth, Kingstown arms placed. Bug fixed
  en route: orb pos=None convention now resolved by bstage (+ runner fallback).
- VERDICT (`out/telemachus2/painted.png`): a striking MOOD draft — the tower as dark monolith
  under the dawn vortex — but one staging pass only: the backlit angle silhouettes away
  Mulligan's performance and Stephen entirely. Known fix: reverse/side angle, sun behind
  camera, golden light ON the tower. Queued as per-card polish, not a campaign blocker.

## CAMPAIGN WRAP — the set is alive
Nine iterations, honest ledger:
- **Attained**: terrain with true hills + queryable height; curving carved Liffey with bridges
  and quay walls; ragged coast, bay open to the Irish Sea, Howth peninsula, Bull Island,
  Kingstown arms; 15-street network with side streets; row-house fabric with slate roofs +
  chimney lines; facade grammar (windows/doors/sills), tram tracks, gas lamps, curbs, granite
  steps; landmarks: Pillar, GPO, Custom House, Four Courts, St George's, Trinity, cathedrals,
  Castle, Mansion House, Eccles St with Bloom's numbered door, Martello on its rise, South
  Wall + Poolbeg, warehouses, the threemaster. Probes pass at street level; three cards
  validated off the set (Forger FLAGSHIP w/ emphasis channel, Wandering Rocks labyrinth,
  Telemachus mood draft).
- **Remaining (enhancements, not blockers)**: Telemachus reverse-angle restage; window recess
  depth; vignette legibility strategy for aerial cards; P4 satellites detail (Howth village,
  Baily light, strand texture for Proteus/Nausicaa); Sackville probe re-render with GPO.

### 2026-07-03 · The Expert Witness Audit (post-wrap review)
- Ran the first formal expert-persona audit (AUDIT_1904.md): the Professor is excited by the
  INSTRUMENT (named anchors, true heights, the tower's rise, human ratio correct) and dismayed
  by 13 verified specifics — headline: Sackville at 22.7 m vs its true ~49 m ("the widest
  street in Europe" is currently an alley), the two canals entirely missing, 4.4 m front
  doors, bays twice too sparse, empty block cores, no Loop Line, no Wellington obelisk, no
  smoke, no shops, invented river meanders.
- Verdict: "a stage maquette with scholarly bones, not yet a portrait" — stageable today,
  teachable only after corrections. Both excited AND disappointed, in the correct order.
- The test is now standing atelier discipline (PRINCIPLES.md §7). Campaign round 2 queue =
  the audit's prioritized fix list (street widths + canals first).

## MANDATE AMENDED (Myk, 2026-07-03) — the gold ring
Forget the anti-Borges restraint. Target: a 1904 Dublin complete enough to export into a game
engine and let ten-year-olds play in it — **the Rawls test**: drop anyone anywhere behind the
veil and the city must hold. No Potemkin routes. Standing practice: rotating expert audits
(the Professor + fresh eyes each round: transport historian, social historian — who will ask
where the TENEMENTS and the Monto are — architect, game-level designer, port engineer), plus
seeded RANDOM street-drop probes every round.

### 2026-07-03 · Round 2 — the Professor's headline items
- DONE: per-street widths (Sackville 28 u ≈ 49 m — the boulevard sweep restored, double tram
  lines; probe `out/probe_sackville3/`); THE CANALS carved (Grand south belt, Royal north belt);
  honest Georgian doors (2.4 m + fanlight) and 3.4 m bays (~×2.75 denser fenestration);
  O'Connell Bridge as wide as it is long; the Loop Line viaduct (elevated iron deck + piers,
  east of Butt Bridge); the Wellington Testimonial (62 m) in Phoenix Park; Eccles door + fan.
- NOT YET VERIFIED: canals only exist in the height function — need an aerial confirming both
  belts read; Wellington unverified in frame.
- ROUND 3 QUEUE: (1) canal + west-city aerial verification; (2) block-interior roofscape infill
  (the Rawls test dies in a hollow block); (3) coal-smoke atmosphere from chimney lines;
  (4) shopfront band on commercial principals; (5) THE SOCIAL LAYER: north-inner-city tenement
  district (decayed Georgian, the densest poverty in Europe) + the Monto (Circe's Nighttown!) —
  the social historian's first question; (6) random-drop Rawls probes (seeded, 3 per round);
  (7) invite the transport historian (rail termini: Amiens St, Westland Row, Broadstone,
  Kingsbridge; the tram wires) and the level designer (export sanity, collision, POI density).

### 2026-07-03 · Round 3 — the Rawls harness speaks
- DONE: block-interior roofscape infill (mews/returns, water-guarded); THE SOCIAL LAYER —
  north-inner-city tenement belt + the Monto (tight sooty 4-storey courts with collapse-gaps,
  anchored "monto" for Circe); rawls_probe.py (seeded random street-drops, no cherry-picking).
- **THE FINDING** (`out/rawls_r3_contact.png`): three seeds, three streets — three nearly
  identical blank brick corridors. Outside the two detail zones the city is windowless wall:
  the detail-zone strategy IS the Potemkin strategy, now proven empirically. (Also honest:
  infill + tenements built but not yet verified in frame — drops landed elsewhere; aerial
  verification of canals/Wellington still pending.)
- ROUND 4 (the Rawls fix): (1) **procedural facade material** — window-grid + sill banding in
  the shader, applied to EVERY row block city-wide at zero geometry cost; detail zones keep 3D
  reveals for close-ups; (2) global lamp spacing on all principals; (3) verification aerial
  (canals, Wellington, tenements, infill); (4) re-run the SAME three seeds — the before/after
  of the Rawls fix; (5) then smoke + shopfronts; transport historian audit after.

### 2026-07-03 · Round 4 — the Rawls fix lands; the uniformity finding
- DONE: **procedural FacadeGrid shader** (shared node group; per-block bay/floor counts) on
  every row-house, tenement, and mews block city-wide — zero geometry cost; lamps go global.
- BEFORE/AFTER (`rawls_r3_contact.png` vs `rawls_r4_contact.png`): the same three seeds that
  showed blank corridors now show windowed Georgian frontages with sills and rhythm. The
  Potemkin defect is fixed at the architecture level.
- **NEW FINDING**: the three drops still resemble each other — every street is the same street.
  Coverage ≠ character. The city needs a SOCIAL GEOGRAPHY field: wealth/soot/height/rhythm/
  material varying by district (quays ≠ Gardiner ≠ the Coombe), so a blind drop can be *placed*
  by look alone. That's the true Rawls bar: not "does it hold" but "do I know where I am."
- ENGINEERING NOTE: per-block facade materials ballooned shader compile time (3-drop run hit
  the 10-min cap) — share materials by (palette, bay-class, floor-class) next round.
- ROUND 5: (1) social-geography field informing fabric params; (2) the still-pending
  verification aerial (canals, Wellington, tenements, infill); (3) material sharing perf fix;
  (4) street-surface setts shader; (5) coal smoke; then the transport historian's audit.

### 2026-07-03 · Round 5 — canals verified, the city gains a social skin
- DONE: material caches (facade + plain, keyed by palette/bay/floor — shader-compile blowup
  fixed); **social geography field** (`social(x,z)`: wealth/north-poverty/Liberties/soot)
  informing fabric heights + palettes (SE squares warm and tall, north side tall and sooted,
  the Coombe low and grey); terrain grid refined 35→18 u after the aerial caught the canals
  rendering as strings of ponds (sampling bug) — **both canal belts now read as continuous
  channels** (`out/aerial8/card.png`), and the Monto reads visibly darker from the air.
- PENDING VERIFICATION: Wellington obelisk not yet confirmed in any frame; district character
  at street level (the real Rawls upgrade test: "do I know where I am?") — next round's drops.
- ROUND 6: (1) Rawls drops across districts (seeds tuned to land in Monto / Merrion / Coombe —
  the identification test); (2) THE TRANSPORT HISTORIAN's audit: rail termini (Amiens St,
  Westland Row, Broadstone, Kingsbridge), tram standards + wires, cab ranks; (3) coal smoke;
  (4) street-surface setts shader; (5) Wellington verification frame.

### 2026-07-03 · Round 6 — two bugs and a discovery
- **CORRECTION TO THE RECORD**: runner.py never forwarded extra args to Blender — every Rawls
  drop through round 4 ran with the default seed. Round 3's "three streets look alike" was ONE
  street three times. (The Potemkin finding survives — that street was genuinely blank — but
  the uniformity claim was overdrawn.) Fixed: args forward; drops now truly vary.
- District identification test (true drops, `rawls_r6b_contact.png`): **Merrion PASSES** (warm
  Georgian squares, legible as south side). **Monto and Coombe FAIL structurally** — cameras
  spawned inside geometry: generators collide (infill mews inside tenement courts; cottages on
  drop points). Coal-haze atmosphere config added to drops.
- **THE DISCOVERY — OCCUPANCY**: the set needs a spatial occupancy index: (a) generators check
  before placing (no interpenetration), (b) probes/spawns query free space, (c) it doubles as
  the collision/navigation layer the game-export goal requires. This is the level designer's
  audit arriving early, through the harness.
- ROUND 7: (1) occupancy grid (coarse 2D: mark footprints at placement; generators skip
  occupied cells; probes snap to free street cells); (2) re-run the district test — all three
  must render FROM VALID AIR; (3) then Monto/Coombe character tuning (the actual identification
  test, unblocked); (4) transport historian audit write-up.

### 2026-07-03 · Round 7 — occupancy lands
- DONE: **occupancy grid** (mark on fabric/tenements/infill/churches; infill checks before
  squatting; probes snap to free air via nearest_free) — the collision/nav seed for game
  export. District re-test (`rawls_r7_contact.png`): Monto now renders from valid air;
  Merrion passes again; Coombe diagnosed as wall-hugging viewpoint + under-lit soot palette,
  not a collision.
- STILL OWED: district IDENTIFIABILITY (Monto reads generic, not tenement-tall-and-sooty at
  street level — the drop may be snapping toward low mews; tune drop point + tenement court
  presence); Coombe probe lateral clamp + exposure; marks for institutions/gpo/eccles.
- CAMPAIGN STATUS at round 7: terrain/coast/canals TRUE and verified; streets at true widths;
  city-wide facade shader; social-geography skin; occupancy; probes honest (two harness bugs
  found and fixed). Expert queue: transport historian (termini, wires), architect (rooflines,
  reveals), level designer (export test: glTF out, collision from OCC).

### 2026-07-03 · Round 8 — the glTF export test (the Roblox road, proven)
- GOAL: the level designer's first audit artifact — push the full set through glTF and verify
  what a game engine actually receives. Zero render cost, maximum mandate value.
- DONE: `export_glb.py` → `out/dublin_1904.glb`: **19,991 meshes, ~622k tris, 448 materials,
  45.8 MB, valid glTF v2** (binary header + JSON chunk parsed and checked). `roundtrip_glb.py`
  re-imports into a **fresh factory scene** (none of the set's build code present) and renders
  Sackville-toward-Pillar in EEVEE: all 19,991 meshes survive, terraces/windows/doors intact
  (`out/roundtrip_sackville2.png`).
- FINDING (predicted, now measured): the procedural FacadeGrid shader **cannot cross the export
  boundary** — first-pass walls rendered hospital-white. FIX: export-time flattening pass in
  export_glb.py collapses each facade material to its palette's flat brick color read off the
  group node's Base input (**414 materials flattened**); real window/door geometry unaffected.
  Round trip now shows warm brick + dark glazing + colored doors. What's lost: shader-painted
  window grids on distant infill masses (acceptable at range; a true bake-to-texture pass is
  the eventual fix).
- REMAINING for game-grade export (queued for the level-designer round):
  1. **Draw calls**: 19,991 separate meshes = 19,991 draw calls. Needs a join-by-material pass
     (fabric rows → one mesh per block per material) before any engine will be happy.
  2. **Terrain color**: vertex-color-driven terrain exports flat grey — either bake the
     height/slope palette to a texture or to COLOR_0 the exporter respects.
  3. **Collision**: OCC occupancy grid exists as data; emit it as a collision layer.
- Still owed from Round 7: district identifiability at street level (Monto), Coombe probe
  exposure, OCC marks for institutions/gpo/eccles, transport historian audit.

### 2026-07-03 · Round 9 — district identifiability, part 1: Monto passes, Coombe half-way
- GOAL: the R7 finding — "Monto renders from valid air but reads generic" — plus the Coombe
  wall-hugging viewpoint.
- DONE (set-level, not probe dressing — every court gets it, seen or unseen): tenements() now
  strings **washing lines across every court** (5 per court, 3–6 sheets each, four cloth greys)
  and scatters **yard clutter** (barrels/crates/handcarts, 9 per court). Probe fix: district
  drops stand **centre-street** (lateral=0) — diagnostic viewpoints shouldn't hug walls.
- VERDICT Monto (`out/rawls_r9_monto/card.png`): **passes identification.** The drop now reads
  as an enclosed tenement court — washing strung wall-to-wall overhead, yard below, sooty
  4-storey walls. A Dubliner would say "a court off Gardiner Street" without prompting.
  Watch-items: one hanging sheet renders near-black (probably a dark background building seen
  through a sheet gap — verify); the far wall reads tanner than the SOOT palette intends.
- VERDICT Coombe (`out/rawls_r9_coombe/card.png`): **viewpoint fixed, identity not.** Clean
  centre-street sightline, lamps, 2-storey rows — but it reads generic-terrace, not Liberties.
  What's missing: **weaver-cottage grammar** (low 1–2 storey, whitewash/render over rubble,
  gabled), and **St Patrick's spire owning the skyline** (the drop's gaze points away from the
  cathedrals — consider reversing it NE). Queued as Round 10 lead item.
- Still owed: transport historian audit, architect audit, join-by-material export pass,
  terrain color bake, OCC marks for institutions/gpo/eccles, OCC-as-collision.

### 2026-07-03 · Round 10 — district identifiability, part 2: the Coombe reads Liberties
- GOAL: R9's miss — Coombe viewpoint fixed but grammar generic-terrace.
- DONE (set-level):
  1. **Whitewash cottage grammar** in `_row_along`: where `social()` liberties > 0.5, rows
     switch from brick to whitewash/pale render (4 grimed off-whites, reduced soot factor —
     grimy but unmistakably NOT brick) and facades drop to **1-storey window bands**.
  2. **St Patrick's corrected to true height**: 43 m tower + spire to ~68 m (was ~46 m total)
     — the old city's tallest object and the Liberties' constant compass.
  3. **Drop point moved into the fabric**: first attempt aimed the old drop at the spire from
     93 u — tower-as-monolith in an empty precinct (`out/rawls_r10_coombe/`). Moved the drop
     SW along the Coombe principal to (−647, 502), gaze oblique across the street: cottage
     roofline low, spire beyond (`out/rawls_r10_coombe2/card.png`).
- VERDICT: **conditional pass.** Whitewash + single-storey band + spire-beyond-roofline are
  three independent Liberties signals in one frame; a Dubliner says "the Liberties" without
  prompting. Framing note: the across-street stance is tight — the cottage row fills most of
  the frame. A future pass could rotate the gaze ~20° toward along-street for more depth.
- District identification scoreboard: **Monto ✓ (R9), Merrion ✓ (R7), Coombe ✓ (R10).**
- Still owed: transport historian audit (next round's lead), architect audit, export
  join-by-material + terrain bake + OCC-as-collision, OCC marks for institutions/gpo/eccles.

### 2026-07-03 · Round 11 — the transport historian's audit (Audit 2)
- AUDIT: written to AUDIT_1904.md §2. Five findings, one fatal: **a 1904 city with no railway
  stations is not a city.** Also: tracks-without-wires (owed since Audit 1), no trams, no cab
  ranks, Loop Line unconnected.
- DONE — new `transport` landmark (dublin_set.py), placed in all scene lists + export:
  1. **Four termini as sited masses**: Amiens St (GNR, campanile, aligned to Loop Line north
     end), Westland Row (DSER, south end), Broadstone (MGWR, on its NW rise), Kingsbridge
     (GSWR, west riverbank). Italianate front + gabled train shed + OCC forecourt marks.
     Harcourt St journaled as owed.
  2. **Tram standards + overhead running wire** on Sackville (centre poles, twin wires),
     the north quay, Westmoreland/Grafton (side poles + span wire).
  3. **DUTC double-deck open-top trams** (liveried, riders aloft, trolley pole to the wire):
     Pillar terminus, inbound Sackville, north quay, Westmoreland.
  4. **Jaunting-car rank** (horse in shafts, side-seats, big wheels ×4 cars) on Sackville's
     east curb by the Pillar.
- EVIDENCE: `out/probe_sackville_r11/card.png` — green tram on the inbound line, centre
  standard + bracket, wires receding, cab rank at the curb, Pillar beyond. The street finally
  reads *electrified 1904*, not museum-of-the-future.
- BUG FOUND BY PROBE: first Amiens render blocked by an infill mass — **scene lists placed
  infill before transport**, so OCC didn't know the station existed. Fixed: transport placed
  before tenements/infill everywhere + termini mark forecourts. (Same class as R7's
  probe-order bug: placement order IS a correctness surface.)
- VERDICT Amiens approach (`out/rawls_r11_amiens2/card.png`): station present, campanile
  breaks the roofline at frame left, forecourt clear — but the front reads generic-block;
  entrance arches/porte-cochère owed to the architect audit. Westland Row, Broadstone,
  Kingsbridge placed but not yet verified in frame — owed.
- Still owed: architect audit (station fronts, rooflines, window reveals), level-designer
  export items (join-by-material, terrain bake, OCC-as-collision), Wellington frame,
  Harcourt St terminus, Telemachus reverse angle.

### 2026-07-03 · Round 12 — level-designer export hardening (the Roblox road, paved)
- GOAL: R8's three measured export gaps — draw calls, grey terrain, no collision.
- DONE (all in export_glb.py):
  1. **Join-by-material**: all meshes sharing a material merged — **19,991 → 485 objects**
     (~41× fewer draw calls), ~651k tris, world placement preserved.
  2. **Terrain color fixed**: the glTF exporter ignores generic Attribute nodes; swapped in
     the Color Attribute node it recognizes (part_color vertex colors now export).
  3. **Collision sidecar**: the OCC occupancy grid exported as row-RLE JSON
     (`dublin_1904_collision.json`, 4,084 runs, cell 3 u, with unit/coord metadata) —
     engine-agnostic; a Roblox/Unity importer can rebuild collision or navmesh from it.
- EVIDENCE: `out/roundtrip_sackville3.png` — fresh-scene reimport of the joined GLB: city
  intact, brick + glazing + doors + **trolley wires** (transport layer now in the export).
- RAWLS DROP seed=31 (`out/rawls_r12/card.png`): an honest street canyon — rows both sides,
  lamps, walker, depth. Pass; no spawn collision, no void.
- Still owed: architect audit (station fronts/rooflines/reveals — next lead), Wellington
  frame, Harcourt St, Westland Row/Broadstone/Kingsbridge verification frames, Telemachus
  reverse angle, coal-smoke plumes, shopfront band, setts shader.

### 2026-07-03 · Round 13 — the architect's audit (Audit 3): the Dublin sawtooth
- AUDIT: AUDIT_1904.md §3. Fatal finding: "your streets have lids, not roofs" — flat slab
  rooflines instead of parapet + party-wall chimney stacks; plus mute station fronts and
  (owed) window reveals.
- DONE:
  1. **Parapet + discrete chimney stacks with clay pots, city-wide** (`_row_along` + the
     tenement belt): street-face parapet, stacks every ~8.5 u, two terracotta pots each —
     the sawtooth silhouette that IS a Dublin street. Evidence:
     `out/probe_sackville_r13/card.png` — rooflines both sides now serrated.
  2. **Termini announce themselves**: entrance arcade (3 openings) + string course + cornice
     on all four fronts. Evidence: `out/rawls_r13_amiens2/card.png` — reads "public building
     with a way in", campanile at frame left, forecourt clear, walkers for scale.
  3. Random drop seed=47 (`out/rawls_r13/card.png`): tight along-wall view of a facade row —
     honest, passes (windows + sills recede correctly), though it shows the flush-window
     flatness the architect flagged (reveals still owed).
- THIRD PLACEMENT BUG, properly fixed this time: first Amiens re-render still had a fabric
  row in the forecourt — a Summerhill side-street row. Root cause: **`_row_along` never
  CHECKED the occupancy grid, it only marked it** — ordering alone could never protect
  anything from fabric. Fixed: fabric segments now skip when `OCC.free(center, r=4)` fails;
  transport placed before fabric in all scene lists; forecourt mark extended to cover the
  full approach (50 u deep). The placement-order lesson is now a placement-CONTRACT lesson:
  generators that mark must also check.
- Still owed: window reveals in detail zones, Wellington/Westland/Broadstone/Kingsbridge
  frames, Harcourt St, coal smoke, shopfront band, setts, Telemachus reverse angle.

### 2026-07-03 · Round 14 — the verification sweep: every landmark gets a camera
- GOAL: three placement bugs in this campaign came from unverified landmarks; four remained
  unverified. Verify all of them + add the owed Harcourt St terminus.
- DONE: Harcourt St (DSER) added to `transport`; probe DISTRICTS gained westland /
  broadstone / kingsbridge / wellington / harcourt approach frames.
- VERDICTS (all render evidence in `out/rawls_r14_*/card.png`):
  - **Westland Row ✓** — front + arcade + cornice, city fabric behind.
  - **Broadstone ✓** — the austere three-storey mass suits its Egyptian-revival severity.
  - **Kingsbridge ✓** — long palazzo front reads. CAVEAT journaled: it stands at x=−1350,
    *outside the OCC grid* (x0=−1300); mark() clamps silently. Nothing builds out there
    today, but extend the grid if the west end ever grows fabric.
  - **Wellington ✓** — the obelisk on its stepped base alone on the Phoenix Park green,
    walkers at its foot; the best single frame of the sweep.
  - **Harcourt St ✓** — added *and* verified in the same round (the lesson, applied).
  - Random drop seed=53 ✓ — wide junction, lamps, tram standard, sawtooth chimney roofline
    left. Honest and passes.
- ZERO new placement bugs — the R13 mark-and-check contract is holding.
- Still owed: window reveals (detail zones), coal-smoke plumes, shopfront band, setts shader,
  Telemachus reverse angle, aerial re-shoot with the new roofscape.

### 2026-07-03 · Round 15 — the working city: industry, coal smoke, and the aerial re-shot
- DONE:
  1. **`industry` landmark**: Guinness at James's Gate (three stores + the two great brewery
     chimneys), the docklands gasometer (crossed-drum + rim), two coal-quay stacks. The 1904
     skyline smoked from these; now it has them.
  2. **`smoke` landmark**: 36 plumes off the stacks — Guinness, coal quays, the tenement
     belt, the Liberties — drifting NE on the prevailing south-westerly (two-segment capsule
     plumes, rising then flattening). Ephemeral scene dressing: aerial/mood shots place it,
     street probes don't.
  3. **dublin_aerial.py repaired**: it was placing several landmarks TWICE (a legacy loop +
     explicit re-placements) and placed transport last, violating the R13 OCC contract.
     Rewritten to the canonical once-each order.
  4. **Aerial legibility** (queued item): lower, tighter camera (focal 42), haze 0.30→0.20.
     `out/aerial10/card.png`: river corridor + quays + bridges read, whitewash Liberties
     visible as a pale quarter, Guinness smoking, gasometer at the docks.
- HONEST FLAG for next round: comparing aerial10 to aerial8, mid-block infill *looks*
  sparser. Perceptual (closer camera, warmer parapets) or real (R13's fabric OCC-check
  thinning something downstream)? Needs a QUANTITATIVE check: count infill/fabric objects
  before/after the R13 change instead of eyeballing renders.
- Random drop seed=61 (`out/rawls_r15/card.png`): street canyon, lamps, closed vista — pass.
- Still owed: infill-density check (next round's lead), window reveals, shopfront band,
  setts, Telemachus reverse angle, painted flagship aerial through the vangogh register.

### 2026-07-03 · Round 16 — the census: R13's fix had quietly deleted 37% of the city
- GOAL: settle R15's "infill looks sparser" flag with numbers, not eyes.
- BUILT: `census.py` — headless build, mesh-object counts per landmark, OCC coverage; A/B
  toggle via env `FABRIC_OCC_CHECK`.
- FINDING: **fabric = 26,093 with the R13 check vs 41,541 without — the check was censoring
  the city by 37%.** Root cause: rows MARK the live grid as they place, and later rows CHECKED
  the same live grid — so fabric blocked fabric (back-to-back rows, side-street rows near
  principals, corner meetings). The stations were never the problem; the semantics were.
- FIX: **snapshot semantics** — `OCC.snapshot()` freezes the grid when fabric starts; rows
  check the pre-fabric world (landmarks, transport, industry) and never each other.
  Re-census: **fabric = 37,952** (91% of unchecked; the missing 9% is rows genuinely
  displaced by station footprints/forecourts and industry — exactly what should be missing).
  Contract, amended: *a generator that both marks and checks must check the snapshot, or it
  censors itself.*
- EVIDENCE: `out/aerial11/card.png` — the city dense again, all quarters filled, Guinness
  and the quays smoking.
- RAWLS DROP seed=67: first render honestly FAILED — valid air, gaze point-blank into a wall
  corner. Fixed in the probe: **open-gaze selection** — sightline-scan the street axis, its
  reverse, then 8 headings; override only when the assigned gaze is blocked (<14 u).
  Re-render (`out/rawls_r16b/card.png`): same drop reads as a court corner, stacks + pots on
  the roofline. Pass.
- LESSON for the protocol: renders FIND problems; counts CONFIRM them. "Looks sparser" was
  hedged as perceptual in R15 — the census proved the eyes right and the hedge wrong.
- Still owed: window reveals, shopfront band, setts, Telemachus reverse angle, painted
  flagship aerial (vangogh), possible expert re-audit (Professor round 2) as capstone.

### 2026-07-03 · Round 17 — shopfronts, and the streets became first-class citizens
- PLANNED: shopfront band + the Professor's return audit. GOT: shopfronts + a deep placement
  bug the new code exposed. The re-audit moves to R18 — this is the round the streets
  themselves entered the occupancy model.
- DONE 1 — **shopfront band** (Audit 1 #8, the last unbuilt fix): commercial principals
  (Sackville, Westmoreland/Grafton, Dame, Henry/Mary, Talbot, both quays) get ground-floor
  joinery in trade colors + pale fascia (signage) band + protruding awnings (~55% of bays).
  Liberties excluded (lib > 0.4 keeps cottage fronts).
- BUG (found because shopfront rng draws reshuffled downstream layout): the Sackville probe
  rendered a wall — `whodunit.py` ray-cast identified a **side-street row standing in
  Sackville's carriageway** at (7, −126). Pre-existing: side streets run up to 210 u with no
  knowledge of other streets' roadways; every earlier render was rng-lucky.
- FIX, in three measured steps (census after each):
  1. **Roads mask**: `OCC.roads` + two-pass fabric — PLAN all streets (principals + derived
     side streets), mark every carriageway, then place rows; a row refuses road cells.
     → fabric collapsed to 13,633: my stamp axes were swapped (w is along-street).
  2. Axis fix + 0.75-width mask → 22,805: still eating diagonals — `_stamp` marked the
     **AABB** of rotated rects, smearing diagonal streets into fat staircase bands.
  3. **Rotated-rect rasterization** in `_stamp` (benefits ALL marks, not just roads)
     → **fabric = 34,542 (91%), OCC coverage 9.6% → 4.8%**, whodunit: no hit.
  The missing 9% is rows whose centers genuinely stood in carriageways — the bug's true size.
- EVIDENCE: `out/probe_sackville_r17b/card.png` — street open: tram, wires, stacks, shop
  colors at the kerb. Random drop seed=71 (`out/rawls_r17b/card.png`): landed in the
  Liberties and the whitewash grammar showed up UNPROMPTED in a random frame — the district
  system working where no camera was aimed.
- PROTOCOL NOTE: census-after-every-step turned a two-hour mystery into three 5-minute
  falsifications. The R16 lesson (renders find, counts confirm) is now standard practice.
- Next (R18): the Professor's return audit against his original 13-item dismay list; then
  painted flagship aerial, window reveals, setts, Telemachus reverse angle.

### 2026-07-03 · Round 18 — the Professor returns: eleven fixed, one withdrawn, one partial
- AUDIT 4 (AUDIT_1904.md): his original 13-item dismay list scored against the model.
  **11 ✓, 1 withdrawn (the Liffey — city reach MEASURES ±10 u of straight between the quays;
  his "invented bends" live upstream where the real ones do), 1 partial (street life: trams/
  wires/cabs/walkers in, drays/cattle/cyclists owed).** Verdict upgraded from "stage maquette
  with scholarly bones" to **"it is a city now... I could stage all fifteen episodes."**
- FIXED this round: **Four Courts drum** (#12, the last standing) — broad colonnaded rotunda
  (14.5 u), 6.2 u copper dome, lantern; the river's great swelling reads from the bridge.
- EVIDENCE: `out/quays_west/card.png` — standing on O'Connell Bridge looking west: channelled
  river between quay walls, the new dome on the right bank, smoke haze. (Framing note: lower
  half is bare deck; the bridge's balustrade + lamps are on his new list.)
- RAWLS DROP seed=79 (`out/rawls_r18/card.png`): landed on a SHOPPING STREET — joinery bands,
  fascias, red and green awnings both sides, walkers. R17's shopfronts appearing unprompted
  in a random frame: the no-Potemkin test passing at its own game.
- His new list (the R19+ queue): window reveals, wire the remaining tram routes, bridge
  balustrade + lamps, arcade depth, drays/cattle/cyclists.
