# The Sighted Hand — principles for representational illustration by code

Distilled from the July 2026 spike (`tools/atelier/`) so that any model — including
ones weaker than the one that ran it — can reproduce the results by following the process
rather than by being clever. Everything here was learned by doing and verified by eye.

## 0. The one prerequisite: close the loop

Code-drawing is blind by default, and **abstraction is what survives blindness**. If you can
render an image and then look at it (vision over your own output), figuration becomes
learnable. Never author more than one revision without looking. If your host can't screenshot,
extract pixels directly (canvas `toDataURL` → decode → view).

## 1. Model, don't draw

Outlines demand coordinate precision you don't have. Volume + light doesn't.

- Build subjects as **smooth-blended 3D primitives** (spheres, capsules, ellipsoids with a
  polynomial smooth-min — "clay"), raymarch, and light with a key/fill/rim rig + cheap ambient
  occlusion. A recognizable animal takes ~20 primitives and 2 eyes-on iterations.
- Realism comes from **shading physics, not line accuracy**. Declare anatomy as volumes in
  known proportions; let the light do the rest.
- Limits found honestly: **facial features are cuts, not bumps** — additive clay can't do
  frontal faces (needs subtractive ops). Profiles work where fronts fail: a **cameo relief**
  (authored landmark polygon → Chaikin corner-cutting → distance-field height → lit normals)
  puts the whole likeness in one editable 2D line.

## 2. Export what you know: the G-buffer

The model knows things the finished pixels forget. Save them alongside the render:
subject **mask**, **depth**, **normals**, **material/part ids**, plus authored channels
(**flow**, **mist**). Every downstream pass gets smarter for free. This is the bridge between
"a 3D render" and "an illustration": the painter can then treat sky, ground, fur, and fog as
different problems.

## 3. Strokes must know what they paint

A uniform stroke pass reads as static (verified: it does). Subject-aware rules that fixed it:

- **Orientation from form, not luminance**: strokes along screen-projected surface normals
  wrap the body; image-gradient flow is a fallback, not a primary.
- **Fur/feather/grain flow is authored, not derived**: each creature carries a skeleton
  polyline (nose→tail); hair direction = nearest-segment tangent, blended toward gravity with
  distance from the spine ("droop"); tree bark = trunk polyline with zero droop. Bake it as a
  G-buffer channel.
- **Strokes stop at silhouettes** (walk the field, halt on region change) — subjects resist
  the sky. Exception: fog strokes may trespass, because fog covers things.
- **Per-region treatment**: sky = long curved strokes in a global field; ground = long lateral;
  subject = short combed; edges of high detail = shorter and finer.

## 4. The field is a compositional instrument

The flow field that orients strokes can encode the picture's *meaning* without moving any
object:

- **Place vortices on narrative points** (the moon; the crow holding the cheese) — the sky
  then literally organizes around the story's centers of attention. Accidental attractors are
  read by viewers as intent; make them intent.
- **Sum direction vectors, never angles.** Angle-summing kinks the field into false seams.
  Vector-summed counter-rotating vortices produce a smooth saddle — usable as a deliberate
  divider (e.g. celestial from terrestrial).
- **Ornaments should be flow deviations, not interruptions.** Stars = a few short bright
  strokes riding the same field + a soft core dab + a tiny local vortex. Explicit halo rings
  read as rivets. If a decoration has its own geometry unrelated to the field, it will look
  pasted on.

## 5. Atmosphere is a channel, not a veil

A baked translucent overlay homogenizes everything under it (reads as "grey smear"). Instead:
author atmosphere as data (mist = height-enveloped **anisotropic noise** — long horizontal
cells, patchy, with gaps — never symmetric gaussian bands, which read as ovals), bake it into
the G-buffer, and let the paint pass render it as *directional strokes whose density and
opacity follow the local value*.

## 6. Build a sculpture library, then compose

Deck-scale economics: carve **reusable, posable subject builders** (fox, crow, tree...) that
(a) take origin/mirror/pose params, (b) record their part-index span so pixel→creature
identity survives into the G-buffer, and (c) export their flow skeletons. Scenes become
compositions: place subjects, connect them with a **gaze line**, give the relation an
**object** (the cheese — desire needs a referent), and integrate with atmosphere. Then
illustrate in a separate pass. One scene, any style.

## 6b. The three layers: sculptor → stager → painter

Separate the concerns and the control plane clarifies itself:

- **Sculptor** (e.g. `projects/fable/creatures.py`): makes ARTIFACTS with affordances — geometry, named anchor
  points ("branch_end", "head", "feet"), flow skeletons or per-part grains, material biography
  (coherence, age, droop). Grain is LOCAL: bark follows the limb it is on, never a global
  axis — a broken treetop's strokes angle down with the break.
- **Stager** (`core/stage.py`): turns artifacts into a SCENE by relation, not coordinates —
  `perch_on(tree.anchor("branch_end"))`, `look_at(bird.anchor("head"))` (pose solved from the
  relation, clamped by anatomy — and the clamp itself is expressive: a fox that cannot quite
  reach the angle visibly strains). The stager also owns environment (ground, sky, mist) and
  the ATTENTION structure — what the story cares about — which it compiles into the painter's
  field vortices. One `render()` emits pixels + every control channel + paint directives.
- **Painter** (`core/styles.py`): consumes channels and directives; owns strokes and nothing else.

The control plane spans all three: anchors and biography at the sculptor; relations,
atmosphere, and attention at the stager; stroke behavior at the painter. A knob belongs at the
layer where its SEMANTICS live.

## 7. Process discipline (as important as the techniques)

- **Iterate with your eyes, but know when to stop.** Over-correcting toward canonical
  proportions sands off character — v1's strangeness is often the interesting part
  (the bust got worse for two "corrections"). Character lives in deviation.
- **Time-box failures and report them.** "Cubism dissolved the subject" taught more than three
  more parameter nudges would have (spatial fracture ≠ semantic decomposition — decompose
  *objects*, not pixels; the SDF part-list is the semantic decomposition, waiting).
- **Contact-sheet your variants** — one composite image, one look, five judgments.
- **The Expert Witness Test — the definition of done.** Before declaring any representational
  work finished, summon (in earnest imagination) the most knowledgeable, least-flatterable
  domain expert the subject admits — the Joycean topographer with a pedometer, the geologist,
  the naval rigger — show him the renders, and write his honest reaction with every claim
  checked against the model's actual numbers. His dismay list, ordered by severity, is the
  next work queue. (First instance: projects/ulysses/AUDIT_1904.md — it found a 22 m Sackville
  Street that should be 49 m, missing canals, and 4.4 m front doors that three "passing"
  probes never caught.)
- **A close reader is a debugger.** Every place a default leaks through (a leftover vortex, a
  math shortcut, a compositing veil), a careful eye will find it and read it as either intent
  or noise. Make every field in the image authored: flow from narrative, boundaries from
  geometry, atmosphere from an explicit channel.

## File map (working reference implementations)

| File | What it proves |
|---|---|
| `core/sdflib.py` | clay raymarcher + lighting + G-buffer export |
| `core/stage.py` | the stager: relations, environment, attention, channel baking |
| `core/styles.py` | subject-aware style engines + Vico registers + vortices/repulsors |
| `projects/fable/creatures.py` | posable sculpture library with flow skeletons |
| `projects/studies/` | the spike arc: clay creature · additive ceiling · profile relief · naive strokes |
| `projects/fable/staged.py` | declarative composition: perch_on, look_at, attend |
| `projects/ulysses/` | the majors pilot + the stretch cards (repulsor, no-center) |
| `report/build_report.py` → report.html | the illustrated R&D report |
