# Atelier — code-native representational illustration

A three-layer pipeline for illustrating cards without diffusion models: **sculpt** subjects as
smooth-blended distance fields, **stage** them into scenes by relation, **paint** them with
subject-aware stroke engines — every step iterated with vision over the rendered output.

- **[PRINCIPLES.md](./PRINCIPLES.md)** — the method, distilled so any model with vision over
  its own output can follow it.
- **[CONTROL_PLANE.md](./CONTROL_PLANE.md)** — the formal contract between layers: builder
  info-dict schema, G-buffer channels, paint directives, invariants.

## Layout

```
core/                 the engine (deck-agnostic; the only code projects may import)
  sdflib.py           SDF raymarcher: clay primitives, lighting rig, G-buffer export
  sculpt.py           sculptor-contract helpers (local→scene transforms)
  stage.py            the stager: placement by relation, environment, attention, channel baking
  styles.py           the painter: style engines (vangogh/monet/picasso/sketch/watercolor),
                      Vico registers, vortices/repulsors, CLI
projects/<name>/      one folder per deck or study line: sculptures, scene scripts, out/
  studies/            the original spike arc (fox · bust ceiling · cameo · naive stroke pass)
  fable/              Aesop's Fox & Crow: creatures.py, scene.py, staged.py
  ulysses/            Ulysses majors (see decks/ulysses/MAJORS_ILLUSTRATION.md):
                      dublin.py sculptures, telemachus.py, forger.py, wandering.py
report/               build_report.py → report.html (the illustrated R&D report artifact)
```

`projects/*/out/` (renders, aux .npz, painted cards) is generated and gitignored; final card
art graduates out of the atelier into `app/src/decks/<id>/<skin>/` when a skin ships.

## Dependencies

Python: `numpy`, `pillow`. The 3D backend uses **Blender** (headless), resolved through the
vendored-tools bootstrap — never committed to the repo:

```bash
python ../vendor/bootstrap.py blender            # print resolved path (vendor dir, then PATH)
python ../vendor/bootstrap.py blender --install  # download 4.5 LTS into tools/vendor/ (gitignored)
```

The original numpy SDF raymarcher (`core/sdflib.py`) remains for reproducing
`projects/studies/` and `projects/fable/`; new scene work targets the Blender backend
(sculpt = metaballs/mesh, stage = constraints, frame = camera, G-buffer = passes/Cryptomatte/AOVs).

## Running

```bash
cd tools/atelier
python projects/fable/staged.py          # render a scene (writes projects/fable/out/)
# each scene script prints its own paint command, e.g.:
python core/styles.py projects/fable/out/staged.png projects/fable/out/staged_aux.npz \
       vangogh projects/fable/out/painted.png 5 "<vortices>" "<stars>" heroes
python report/build_report.py            # rebuild report/report.html
```
