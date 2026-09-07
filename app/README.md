# app — the Generative Arcana renderer

A static deck browser & reading composer for custom tarot decks. It renders decks from the top-level
**`../decks/`** corpus (portable, renderer-agnostic JSON) and gives each one one or more visual
**skins**. The whole thing builds to static files for **GitHub Pages**.

Read **[PRINCIPLES.md](./PRINCIPLES.md)** for the Ultima p5 illustration spec.

## The data / renderer boundary

A `deck.json` contains authored meanings, axes, structure, and **iconographic briefs** (including
symbols and integrated scene descriptions), but no executable renderer. Meaning and structure,
iconographic brief, and rendered treatment are separate layers. The JSON lives in the top-level
`decks/<id>/` corpus and any renderer can read it. *This* app is one renderer.

The portable `CardData` contract lives in `decks/card.ts`. `runtime/types.ts` re-exports it for
existing consumers; its Ultima-specific suit/register/lighting types describe only the kit skin.
Other decks do not have to pretend their slugs are Ultima virtues or suits.

## Visual skins

A **skin is just a name.** Each card's renderer is resolved *per card* from whatever content is
registered for that (deck, skin): a typed p5 **"kit"** sketch (`TarotCard`), a **raw p5** source string
(`RawP5Card`), or a **static image** (`<img>`). A deck can offer several skins, selectable in the
browser; per-card fallback means a partial skin degrades to whichever other skin has the card. The
registry + resolver live in `runtime/defineCard.ts` (`registerPack` / `registerImagePack` /
`registerRawPack` / `claimSketchesFor` / `resolveVisual`).

## Structure

```
app/                            # the renderer
  index.html                    # mounts src/main.tsx
  vite.config.ts                # base "./", "@" -> src, "@decks" -> ../decks (the data corpus)
  src/
    main.tsx                    # entry: imports design tokens, registers decks, renders <App>
    app/                        # the shell — hash router + screens
      App.tsx router.ts Landing.tsx DeckHome.tsx AxisExplorer.tsx CardBrowser.tsx Reading.tsx packPref.ts
    runtime/                    # the skin registry (defineCard) + the p5 kit engine (no React)
    components/                 # card UI: CardArt (resolves a card's skin), CardFrame, CardModal,
                                #   CardPlaceholder, DeckGrid, TarotCard, RawP5Card, cardMeta
    decks/                      # the deck LAYER: registry, types, spreads, custom-loader + each deck's skin(s)
      registry.ts types.ts spreads.ts custom.ts index.ts
      ultima/                   #   cards/ (typed p5 "kit" skin) + index.ts
      ulysses/                  #   cards.ts (raw-p5 + Pixel image skins) + pixel/*.png
      byrne/                    #   cards.ts (image skin) + cards/*.png
      finalfantasy/             #   cards.ts (Pixel chibi skin) + pixel/*.png
    reading/                    # deal, encode/decode the reading token, build the LLM prompt
    styles/                     # the design-system tokens: light core + per-deck data-theme "worlds"
../decks/<id>/deck.json         # the DATA (top-level, outside this app) — read via @decks
../.github/workflows/deploy.yml # CI build + deploy to GitHub Pages
```

**Layers, by dependency direction:** portable `decks/card.ts` → `runtime` (pure, no React) →
`components` (React, deck-agnostic) → `app` (shell). The `decks/` folder also contains registry and
bundled-skin composition modules, reading data via `@decks`. A sketch never imports React; the app
discovers decks through the registry.

## Run / build

```bash
cd app
npm install
npm run dev        # http://localhost:5173  (#/  ->  #/deck/ultima)
npm run build      # -> dist/  (Vite reads ../decks for data)
npm run typecheck
npm test           # Node test runner, using the existing TypeScript dependency
```

GitHub Pages: push to `main`; the workflow builds `app/` and deploys `dist/`. `base: "./"` works under
any `/<repo>/` path, and **hash routing** needs no 404/SPA-fallback — and (key for readings) a
`#fragment` is never sent to a server, so reading URLs stay client-side.

## Adding a deck

1. Drop the data: `../decks/<id>/deck.json` (run the generative-arcana skill).
2. Add a skin (optional): `src/decks/<id>/cards.ts` — register a static-image pack
   (`registerImagePack(deckId, skinId, urls)` + `registerPack(...)`), or for generative art put typed p5
   sketches in `src/decks/<id>/cards/*.ts` and claim them with `claimSketchesFor`. A deck may register
   several skins; un-illustrated cards fall back to an automatic placeholder, so a data-only (or pasted)
   deck works with no skin at all.
3. `src/decks/<id>/index.ts` — `import deckJson from "@decks/<id>/deck.json"` (+ `import "./cards"` if it
   has a skin), then `registerDeck({ id, name, tagline, data, cards, spreads? })`.
4. Add `import "./<id>";` to `src/decks/index.ts`, and a `[data-theme="<id>"]` block in `styles/tokens.css`.

## Adding a p5 card sketch (a "kit" skin)

```ts
import { registerCard } from "@/runtime/defineCard";
export default registerCard({
  slug: "crowns-ace",
  draw(kit)       { /* per-frame; the only required method */ },
  onPointer?(kit) { /* interactivity; kit.pointer is normalized 0..1 */ },
  poster?(kit)    { /* the still frame for thumbnails / reduced-motion */ },
});
```

`kit` (`SketchKit`) hands you the p5 instance, the card JSON, geometry helpers (`u`, `cx`, `cy`, `safe`),
a looping clock + seeded RNG, the shared library pre-bound (`light`, `register`, `fig`, `palette`),
`pointer`, and a `signal(name, detail)` channel to the host. Never import React from a sketch.

## Pixel skins

The image skins (Ulysses' "Pixel · Vico", Final Fantasy's "Pixel") are generated by the Python pipeline
in `../tools/pixel/` and rendered out to each deck's `pixel/*.png` (filenames are bare card slugs).

## Import and reading integrity

The importer validates the entire deck before registration: JSON/object shape, axis indices, every
card's required fields, slug/key agreement, and suit/rank/station references. It permits corpus variants such
as Ulysses's 77 cards and Octave's 8×8 minors, and retains extension fields. This is a runtime
contract, not an artistic-quality check or a claim that every deck follows the default walk.
Card order is derived from major number, then suit/rank indices. Existing registry IDs are never
overwritten; use a distinct slug for a separate deck. Imports are session-local, not persistent.

New links use **v2**: canonical deck slug, stable card slugs and orientations, a full spread snapshot,
and a SHA-256 digest of canonical deck JSON. Object keys are sorted recursively before hashing;
array order and authored values remain significant. A changed deck is rejected even if its declared
version was not bumped. The digest detects changes; it does not authenticate the author or provide
a signature. No backend or revision archive is introduced: recovery requires the original JSON.
Web Crypto requires HTTPS (as on Pages) or localhost.

**v1 links remain readable**, after validating tuple shapes, bounds, deck identity, spread, and card
count. They display a warning because positional identities cannot detect historical order/content
changes. New v2 links do not inherit that ambiguity. Questions are limited to 4,000 characters;
encoded links to 65,536 characters; spreads to 64 positions. A spread requiring more cards than a
deck contains is rejected instead of silently truncated. Custom JSON is not embedded in a link:
recipients must load the original deck, and URL-fragment contents are readable by anyone with the link.

Pull requests run `.github/workflows/ci.yml` (typecheck, regression tests, and build). Deployment
runs the same checks before publishing. The test loader transpiles only for Node execution; the
separate typecheck remains essential. No test dependency or lockfile change is needed.

**Trust boundary:** use deck JSON from trusted authors. Structural validation is not SVG sanitization;
the existing inline SVG renderer is unchanged by this work. Supporting arbitrary untrusted decks
requires a separate rendering-isolation or sanitization pass.
