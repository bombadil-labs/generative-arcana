# The Control Plane — formal specification

The contract between the three layers of the code-native illustration pipeline
(`sculptor → stager → painter`). PRINCIPLES.md says *why*; this document says *what*: the data
each layer owns, produces, and consumes. Reference implementation: `tools/atelier/`
(`core/stage.py` · `core/styles.py` · `projects/fable/creatures.py`).

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

## 4. Paint directives

Semantic instructions that are not per-pixel: currently `vortices`
(`"fx,fy,polarity;…"` — field attractors on narrative points; **summed as direction vectors**,
never angles) and `stars` (`"fx,fy;…"` — rendered as flow deviations: short bright strokes
riding the local field + a soft core + a micro-vortex). Directives are *derived from staged
semantics* (`attend()`), not hand-authored at the CLI (the CLI form is just transport).

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
