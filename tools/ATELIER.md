# The Atelier has moved

The code-native illustration pipeline (sculptor → stager → painter, the direction plane,
the twelve style engines, the Dublin set, the Byrne figures) grew up here and now lives as
its own project:

**https://github.com/mbilokonsky/atelier**

Extracted along the seam its own CONTROL_PLANE.md predicted, at this repo's commit
`7566f26` — the full development history (the Dublin gold-ring campaign and its four
expert audits, the direction plane, the figure evolution, all twelve engines) is in this
repo's log up to that point.

## Using it from generative-arcana

The painter installs as a command (pure Python):

```bash
uv tool install git+https://github.com/mbilokonsky/atelier
atelier bindings
atelier paint render.png aux.npz comic out.png 11 focus=0.7
```

For scene rendering (Blender + MPFB parametric humans), clone it as a sibling:

```bash
cd .. && git clone git@github.com:mbilokonsky/atelier.git && cd atelier
python vendor/bootstrap.py blender --install
atelier render projects/byrne/minors.py projects/byrne/out/x structures3
```

Deck projects (the Ulysses and Byrne scenes, per-deck pigment stocks) live in the atelier
repo under `projects/<deck>/`; finished card art graduates into this repo at
`app/src/decks/<id>/<skin>/` when a skin ships.
