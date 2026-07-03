# The Control Plane — formal specification

The contract between the layers of the code-native illustration pipeline
(`sculptor → stager → painter`). PRINCIPLES.md says *why*; this document says *what*: the data
each layer owns, produces, and consumes. Reference implementation: `tools/atelier/`
(`core/stage.py` · `core/styles.py` · `projects/fable/creatures.py`).

> **Horizon note.** The atelier is becoming its own software project. The layer names here —
> Sculptor, Stager, Framer, Painter — are on their way to being *interfaces*: the numpy-SDF
> and Blender backends are already two implementations of the first three, and nothing in this
> contract assumes either. When the atelier is extracted from generative-arcana, this document
> is the seam it separates along.

## Layer contract

| Layer | Owns | Produces | Never touches |
|---|---|---|---|
| **Sculptor** | artifact geometry, affordances, material biography | a builder function + its **info dict** | scene placement, light, strokes |
| **Stager** | relations, environment, atmosphere, attention, camera/frame | rendered pixels + the **G-buffer** + **paint directives** | primitive geometry, stroke rendering |
| **Painter** | stroke behavior per channel value | the finished illustration | geometry, placement, what-matters |

**The placement rule: a knob belongs at the layer where its semantics live.** "How disciplined
is fur" is material biography → sculptor. "Who looks at whom" is a relation → stager. "How wide
is a fog stroke" is paint → painter. When a knob seems to belong to two layers, it is usually
two knobs (e.g. coherence: the sculptor sets the coat's base value; the stager's bake applies
the spatial falloff; the painter maps the value to angular jitter).

## 0b. The canon rule (decks)

When illustrating a deck's card, the card's `visuals.detailed_description` in its `deck.json`
**is the canonical truth of what the scene is.** The stager's job is to realize that scene —
subjects, placement, props, what recedes and what forms — not to invent a thematic paraphrase
of it. Read the card first; stage what it says; spend invention on *how*, never on *what*.
(Learned from Forger v1: an abstraction was staged where the card already specified a pier, a
receding city, nets in the architecture, and wing-shapes over the sea.)

## 1. Sculptor interface

A **builder** is a function `builder(scene, origin=(x, y), mirror=False, **pose) -> info`.
Pose params are builder-specific (`head_pitch`, …) and must be *solvable* — accompanied by
module-level affordance constants/functions so a stager can compute them from relations
(e.g. `fox.neck_local`, `fox.gaze0`, `solve_fox_pitch(origin, target, mirror)`).

The returned **info dict**:

| Key | Type | Required | Meaning |
|---|---|---|---|
| `span` | `(i0, i1)` | yes | part-index range in `scene.parts` — pixel→artifact identity in the G-buffer |
| `anchors` | `{name: (x, y)}` | yes | named scene-space attachment/attention points (`"head"`, `"feet"`, `"branch_end"`) |
| `skeleton` | `[(x, y), …]` or `None` | for coats | growth polyline, origin→terminus (fur: nose→tail); flow crosses parts smoothly |
| `grains` | `[(part_idx, (ax, ay), (bx, by)), …]` | for woody/rigid | per-part local axes; grain follows the limb it is on, never a global axis |
| `droop` | float 0–1 | with skeleton | how strongly the coat falls toward gravity away from the spine (fur 0.7, feathers 0.35, bark 0.0) |
| `coherence` | float 0–1 | no (default 0.7) | discipline of the surface (combed 1.0 ↔ chaotic 0.0); base value, spatially modulated at bake |
| `aged` | bool | no | participate in the age channel (old at `anchors["base"]`, young at `anchors["top"]`) |

Anchors must be computed *after* pose is applied (a pitched head moves its `"nose"`).

## 2. Stager interface (`Stage`)

Declarative scene assembly:

- `place(builder, at=None, perch_on=None, look_at=None, mirror=False, **pose) -> Placement`
  — `perch_on` solves `at` from the builder's `feet_local`; `look_at` solves pose via the
  builder's solver, **clamped by anatomy** (the clamp is expressive: a subject that cannot
  reach the demanded pose visibly strains toward it).
- `attend(*points)` — declares the story's centers of attention (anchor points, `"moon"`, …).
- `stars(*frac_points)` / `moon` / `mist_cfg` — environment and atmosphere configuration.
- `render(w, h, out_png, aux_path, **light) -> img` — raymarches, **bakes all channels**,
  composites the environment, returns/saves pixels.
- `paint_directives() -> (vortices, stars)` — attention compiled for the painter: vortex list
  (fractional coords + alternating polarity), star list.

## 3. The G-buffer (aux `.npz` schema)

All arrays are image-shaped `(H, W)` unless noted. Fractional/angle conventions: image y is
DOWN; angles are radians in image space.

| Channel | dtype | Producer | Painter semantics |
|---|---|---|---|
| `mask` | uint8 | renderer | 1 = something was hit (subject or ground) |
| `depth` | f32 | renderer | ray-march distance (0 where no hit) |
| `normal` | f32 `(H, W, 3)` | renderer | surface normals; fallback stroke orientation (`atan2(ny, nx) + π/2`) |
| `material` | int16 | renderer | nearest-part index; join with `span` for artifact identity, with `grains` for per-part treatment |
| `flow` | f32 | stager bake | authored stroke direction (fur/feather/grain) where `flowmask` = 1 |
| `flowmask` | uint8 | stager bake | 1 where `flow` is authored; else painter falls back to `normal` |
| `coherence` | f32 | stager bake | base coherence × spine-distance falloff; painter maps to angular jitter σ = (1−c)·0.55 and length ×(0.6+0.6c) |
| `age` | f32 | stager bake | 0 young → 1 old; painter maps to stroke weight, darkening, lichen probability ∝ age |
| `mist` | f32 | stager bake | atmosphere density; painter: participation ∝ value, lateral strokes, may cross silhouettes |

Regions derived by the painter: `0` sky/background (`mask=0`), `1` ground (`material=0`),
`2` subject (else). Extension channels follow the same pattern: authored by the stager's bake
from sculptor affordances + scene fields, consumed by name, with a documented painter mapping.
Implemented since: `emphasis` (stager `emphasize(*placements)` → dilated span mask; painter
gives emphasized pixels finer strokes, contrast boost, and a protected pseudo-region outside
strokes cannot enter — dilation is what saves 1-px geometry like masts). Reserved next:
`wind` (vector field: fur ruffle, fog drift — one cause, many textures), `wet`, `event`
(discrete scars/marks).

## 4. The direction plane

Everything the painter accepts beyond the G-buffer, in one sentence:

> **A knob (semantic intent) modulates, via the engine's bindings (style), how the axes
> (mechanics) respond to the buffers (the scene's facts) — drawing from a stock (the palette).**

Intent → style → mechanics → world, from a limited pigment supply. Each entity only speaks to
its neighbors; the deck and stager side of the wall speak *only* knob-and-stock language.

### 4.1 The five entities

| Entity | What it is | Denominated in | Owned by | Count discipline |
|---|---|---|---|---|
| **Buffers** | spatial scene facts (depth, emphasis, coherence, age, …) | world units | stager bake | grows with §3 |
| **Axes** | mechanical affordances of one engine (bleed amplitude, rim-pool px, hatch period, sat chips) | engine units | each engine, private | many; push-driven — they exist because the mechanics exist |
| **Knobs** | semantic tuning instruments, engine-independent | meaning, 0–1 | the direction vocabulary (below) | FEW; pull-driven — mint one only when a deck or stager needs to say something no single engine owns |
| **Bindings** | how one engine translates knobs into axis motion — slope, shape, sign, or honest silence | per-engine tables | each engine, **declarative and inspectable** | one table per engine |
| **Stock** | the palette: pigments the painter may reach for, with roles | color (perceptual space) | deck / card / direction | one per painting |

**Membership test for knobs:** does it survive changing engines? Rim-pool tightness dies with
watercolor; "how much does object identity survive" means something to every style that has
edges. If a scene script ever wants to set an engine axis directly, either that axis is
secretly an unnamed knob, or the layering has leaked.

### 4.2 The knob vocabulary

| Knob | The question it answers | Illustrative dialects |
|---|---|---|
| `edge` | how much does object identity survive? | watercolor: bleed↔glaze · comic: ink presence/weight · vangogh: region-stop↔trespass · monet: lost-edge σ |
| `focus` | how unequal is the frame's treatment? (gain on the `emphasis` buffer's influence) | comic: the saturation/brightness grade · watercolor: local crispness + reserve · vangogh: vortex gain, emphasis protection |
| `order` | how disciplined are the marks? | vangogh: coherence bias, curl, jitter · watercolor: edge wander, bloom count · sketch: hatch wobble |
| `chroma` | how loud is the pigment? | vangogh: sat boost · comic: chip count/boost · monet: broken-color probability |
| `weight` | how big/dense is the mark? | vangogh: stroke length/width · watercolor: glaze opacity/band depth · comic: cel bands, line px |
| `pull` | how faithful to the stock? | comic: chips *become* the stock at 1.0 · watercolor: pigments mix within the stock's gamut · vangogh: color-jitter walks toward the nearest pigment |

Reserved (named, unbound as yet): `key` (tonal register, high↔low), `temperature` (warm/cool
economy, esp. shadows), `economy` (how much is left unsaid), `age` (the MEDIUM's age — foxing,
misregistration, craquelure — distinct from the scene's `age` buffer).

Knobs are scalars today, but any knob may be promoted to a **field** the stager writes
(`focus` already is one in disguise: a gain on the emphasis map). "Crisp here, dissolving
there" is a composition expressed as data.

### 4.3 Bindings: interpretation, not implementation

The contract is that an engine must **respond meaningfully or shrug honestly**. Sensitivity is
a property of the binding, not the knob: a style exquisitely responsive to `edge` binds many
axes to it steeply; a style deaf to `focus` ships an empty row. Inversion is legal and
expressive (a cubist engine may bind `edge` inverted — more assertion, more fracture — because
inverting boundary logic is its identity). Uniform bindings across engines are the trap, not
the goal: they sand every style down to the same mush.

Each engine ships its binding table as a declarative structure next to its code, and
`styles.py bindings` prints them. An empty row is a documented shrug, not an omission.

**Presets are points in knob space.** The Vico registers (`gods / heroes / men / ricorso`)
are direction-level presets, not vangogh property — expressed over knobs, they are portable:
a watercolor "gods" and a comic "gods" fall out of each engine's own bindings.

### 4.4 The stock (palette)

Not "you may only use these tones" (though a steep `pull` binding may mean exactly that) but
"these are the pigments on the board." Structure is roles, not just a list:

```
stock = { core: [...], accent: [...], dark: [...], light: [...] }
```

- Pulls happen in a **perceptual space** (Oklab) and are **value-preserving**: lightness
  carries form and lighting; hue and chroma are where the palette lives.
- Color IDENTITY is scene-side (the sculptor colors the tram maroon; the underpainting is the
  scene's color truth). The stock governs color RENDERING — what pigments realize those facts.
  Per-object palettes are therefore rejected: that channel already exists at sculpt time.
- The legitimate per-object desire survives through roles × buffers: bindings may gate
  `accent` pigments on the `emphasis` buffer — the focused thing gets the saturated stock,
  the world gets the earths — with zero object-level plumbing.
- Decks supply stocks. For Ulysses this is canon, not decoration: the Linati/Gilbert schemas
  assign each episode a color (Telemachus white/gold, Calypso orange, Hades black-white…) —
  a per-card stock shipped by Joyce himself.

### 4.5 Scene directives

Narrative geometry — content, not knobs: `vortices` (`"fx,fy,polarity;…"` — field attractors
on narrative points; **summed as direction vectors**, never angles) and `stars` (`"fx,fy;…"` —
flow deviations: short bright strokes riding the local field + a soft core + a micro-vortex).
Directives are *derived from staged semantics* (`attend()`), not hand-authored at the CLI
(the CLI form is just transport).

## 5. Invariants (violations read as bugs to a close viewer)

1. Every field consulted by the painter is **authored** — flow from growth, boundaries from
   geometry, atmosphere from a channel, attention from the story. Defaults leak; viewers
   attribute intent to whatever they see.
2. Strokes **stop at silhouettes** except atmosphere, which may trespass (fog covers things).
3. Grain is **local** (per limb); coats are **global** (per skeleton, cross-part).
4. Vector fields **superpose as vectors**; angle-averaging kinks.
5. Ornament = **deviation of the shared field**, never independent geometry.
6. Coherence falls off toward fringes — discipline at the spine, character at the edge.
7. **The field carries only attributable intent.** A vortex reads because it sits on a visible
   emitter (a moon, a coveted object); attention semantics are social or embodied. Negative
   attention (a repulsor) requires visible attenders — a crowd turning away — or must be
   restated as *absorption*: the summons' flow terminating dead at the subject's body, darkness
   downstream. A lone figure cannot refuse a field; a body can refuse a light. The field
   amplifies staged relations; it never originates them. (Learned from the failed Forger v1:
   a repulsor around a small dark figure read as a quiet spot, not as non serviam.)
8. **Quantizing a smooth field invents shapes that are not there.** Learned three times in one
   week: value-banding the framer's vignette (a giant amoeba wash), cel-quantizing a gradient
   sky (a jagged oval seam), and it holds for hue under palette pull. The rule: unbake global
   low-frequency fields before any value logic and re-apply them as mood after; smooth regions
   get continuous treatment (ramps, single washes, one cel); hard treatment is reserved for
   places where the scene has real structure. Hard edges are information only where structure
   is real.
9. **Thresholds are the scene's own.** Fixed cuts give a misty scene zero working washes and a
   noon scene four black ones; percentiles of the scene's distribution give both their due.
