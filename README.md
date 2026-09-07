# Generative Arcana

**[▶ Open the live site](https://mbilokonsky.github.io/generative-arcana/)** — browse the decks, read a spread, share the link.

Generative Arcana is three things that fit together:

1. **A method** for designing thematically coherent custom tarot decks, each woven from four symbolic
   axes — **suit**, **rank**, a **transversal** substrate (the generalization of tarot's Chaldean/decan
   order), and the **prime/composite** character latent in every card's number. Packaged as a Claude skill.
2. **A deck corpus** — the decks themselves, as portable, renderer-agnostic JSON. A `deck.json` carries
   renderer-independent *data*: meanings, structure, the four axes, and an authored iconographic brief.
   It contains **no executable rendering implementation**; skins supply the rendered treatment.
3. **An app** that renders those decks and turns a reading into a shareable link any LLM can interpret.
   A static React/Vite site that builds to GitHub Pages.

The split is the whole idea: **a deck is data; how it looks is a separate, pluggable layer.** A deck can
ship one or more named **skins**, and each card's renderer is resolved *per card* — a typed p5 "kit"
sketch, a raw p5 sketch, or a static image — so the same deck data can wear animated generative art,
hand-built pixel art, smooth generative light, or flat composed components. Skins are selectable in the
browser; a skinless deck (or one you paste in) still browses and reads, just with placeholder faces.

## The decks

Seven bundled decks — and, more to the point, **four different topologies**, which is the real proof that
the engine generalizes:

| Deck | Cards | Transversal | Skin | Topology |
|------|------:|-------------|------|----------|
| **The Ultima Tarot** | 78 | the eight Virtues | animated p5 (kit) | the canonical four-axis spread |
| **The Byrne Journey Tarot** | 78 | The Room | illustrated images | migrated from a prior tool |
| **Ulysses Tarot** | 77 | Vico's Cycle | animated p5 · Pixel (Vico) | 21 majors, two selectable skins |
| **Final Fantasy Tarot** | 78 | the Elemental Wheel | Pixel (chibi) | creature suits as a dialectic cross-product |
| **Evolution and Consciousness** | 78 | The Involution | Lumen (generative light) | the axes *concentrated* — Dewart's speech-bootstraps-consciousness |
| **Ultima Octave** | 86 | the Lunar Cycle | Cube (the colour-cube) | an **8×8 lattice** — Garriott's 3-bit virtue algebra; suit = a virtue/colour, rank = an octave |
| **The Deep Time Tarot** | 78 | the Rock Cycle | Core Sample (parametric p5) | designed end-to-end **by Claude (Fable)** — geology as the four axes; primes = irreducible forces, composites = derived formations |

**Deep Time** is the first deck authored entirely by the model itself, from invitation to finished skin —
and the first whose art is *derived in the browser*: one parametric p5 engine instantiated per card
from its four coordinates (suit → form language, rank → composition, station → light, number →
singular vs. factored forms); the majors render as literal core samples with a luminous event at
their numbered depth.

**Evolution** folds the transversal and number into a single
parametric coordinate (`form(suit) · operation(rank) · light(station)`); the renderer literally *is* the
deck's thesis. **Ultima Octave** makes the suit the eight virtues (each a corner of the additive colour
cube) and the rank the eight Ultima 8-folds, so a card is "{octave} of {virtue}" — *Place of Justice* is
Yew, *Role of Valor* is the Fighter — with the 3-bit Truth·Love·Courage value worn as a watermark.

## What's in here

```
skill/generative-arcana/      the method, as a Claude skill (SKILL.md + references/ + strategies/)
generative-arcana-v2.0.zip    the same skill, packaged for one-click install
decks/<id>/deck.json          the deck corpus — portable meanings, structure, and iconographic briefs (no renderer code)
app/                          the renderer (Vite + React + TypeScript)
tools/pixel/                  Python pixel-art pipeline (Ulysses "Vico", Final Fantasy "chibi")
tools/lumen/                  Python luminous-abstract pipeline (Evolution "Lumen")
tools/cube/                   Python composed-component pipeline (Ultima Octave "Cube")
tools/gen/                    deck-data generators (e.g. the Ultima Octave lattice)
.github/workflows/deploy.yml  builds app/ and deploys to GitHub Pages
```

## The skill

The skill teaches Claude to generate a complete deck as a single JSON file. Read
**[`skill/generative-arcana/SKILL.md`](./skill/generative-arcana/SKILL.md)** for the formalism; the
`references/` define the schema and integration rules, and `strategies/` are the per-stage generators.

**Install:** upload **`generative-arcana-v2.0.zip`** to Claude (Skills), or copy
`skill/generative-arcana/` into your skills directory. Then ask for a deck — e.g. *"design a deep-sea
mythology tarot deck"* — and it emits a `deck.json`. Drop it under `decks/<id>/`, register it in the app,
and it renders.

This is **v2.0**: the prime/composite axis is stored as an authored `factorization` gloss on the majors
(a gloss that won't cohere signals a miscast slot); stations carry a concise `description` and optional
`symbol`; numbered ranks carry a `{suit}`-placeholder `question`; suits may form a `dialectic`
cross-product. The app validates its runtime contract independently of the default 78-card authoring profile,
so structurally novel decks (the Octave's 8×8) work too. See [contracts and reading links](docs/contracts-and-readings.md).

## The app

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm run build      # -> app/dist (static)
npm run typecheck
npm test           # data/import/reading regression tests; includes the full deck corpus
```

- **[app/README.md](./app/README.md)** — architecture, the visual-skin system, adding a deck or skin.
- **[app/PRINCIPLES.md](./app/PRINCIPLES.md)** — the Ultima p5 illustration spec (suit = line, virtue = light, number = composition).

Flow: **Landing** (pick a bundled deck or paste your own `deck.json`) → an **About** page with a
four-axis explorer → a filterable **card browser** with a skin selector → a **reading** composer (ask a
question, choose a spread, deal — inversion-aware — and get a compact shareable URL plus a self-contained
LLM prompt; nothing is sent to a server, the whole reading lives in the URL fragment). The chrome is a
token-based design system: a light core theme with a per-deck "world" (`data-theme`) that re-skins all
the chrome to each deck's palette.

```
app/src/
  runtime/     the visual-skin registry (defineCard) + the p5 "kit" engine — no React
  components/  card UI: CardArt (resolves a card's skin), CardFrame, CardModal, DeckGrid, TarotCard, RawP5Card
  decks/       the deck LAYER: registry, types, generic + native spreads, paste-loader, each deck's skin(s)
  reading/     deal, encode/decode the reading token, build the LLM prompt
  styles/      the design-system tokens (light core + per-deck data-theme worlds)
  app/         the shell: hash router, landing, deck about (axis explorer), browser, reading
```

`@` → `app/src` (the renderer); `@decks` → the top-level `decks/` corpus (the data).

## Deploy (GitHub Pages)

Pushing to `main` runs [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which builds
`app/` (Vite reads `../decks` for deck data) and publishes it. Enable Pages with **Source: GitHub
Actions**. The build uses a relative base, so it works under `https://<user>.github.io/generative-arcana/`.
