# app — the Generative Arcana renderer

A static deck browser & reading composer for custom tarot decks. The public app starts empty:
import your own JSON or open an authorized account/Community deck. The seven historical decks,
their skins, and the top-level **`../decks/`** corpus remain repository-only archives and regression
fixtures; the build rejects imports of those sources. The client builds to static files for
**GitHub Pages** or the full Node service.

Read **[PRINCIPLES.md](./PRINCIPLES.md)** for the Ultima p5 illustration spec.

## The data / renderer boundary

A `deck.json` holds renderer-independent data: meanings, the four axes, structure, and an **iconographic
brief** (motifs, scene descriptions, glyphs). It holds **no executable rendering implementation**. It lives
in the top-level `decks/<id>/` corpus and any renderer can read it. *This* app is one renderer.

## Untrusted deck glyphs

Suit and major `symbol.svg` fields remain portable JSON data. Every inline glyph render, including
previously stored account/shared decks and browser-local imports, passes through the same DOMPurify
boundary in `components/safeSvg.ts`. A narrow static SVG allowlist preserves basic shapes, text,
gradients, masks, clips, and local `use` references. IDs and their references are isolated per glyph.
Scripts, event handlers, HTML, stylesheets/inline CSS, images, external references, and animation are
not supported. Empty/oversized/unsupported glyphs and environments without a working browser DOM
use a trusted generic icon; raw SVG is never a fallback. The stored manifest is not rewritten, so deck
fingerprints and reading revisions stay stable. Future SVG features must extend this boundary and
its inert regression tests; do not add another raw HTML sink or modify its sanitized output.

`npm test` includes inert sanitizer fixtures (no script execution or external resource loading),
component/SSR regressions, and geometry checks for the archived glyph corpus. These tests use jsdom
only as a development dependency (Node 20.19+, 22.13+, or 24+); production uses the browser DOM.
Keep DOMPurify patched as security updates are released.

For cover/detail layout regressions, start `npm run dev` and run `npm run test:layout`
in another terminal (Node 24 recommended). The suite uses `playwright-core` with
installed Edge by default; set `ARCANA_BROWSER_CHANNEL=chrome` or
`ARCANA_BROWSER_EXECUTABLE` to a Chromium test binary. `ARCANA_TEST_ORIGIN` can
override the default local Vite origin. All account/catalog/artwork requests are
intercepted with neutral fixtures; no live deck data is used or written. Screenshots
and geometry results are saved under ignored `test-results/deck-presentation/`.
Checks cover 320/375/768/1440px, contained image loading, keyboard/Back navigation,
set changes, stale requests, missing/corrupt artwork, and reduced motion.

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
  vite.config.ts                # base "./", "@" -> src, public distribution guard
  src/
    main.tsx                    # entry: imports design tokens, renders <App> (empty default catalog)
    app/                        # the shell — hash router + screens
      App.tsx router.ts Landing.tsx DeckHome.tsx AxisExplorer.tsx CardBrowser.tsx Reading.tsx packPref.ts
    runtime/                    # the skin registry (defineCard) + the p5 kit engine (no React)
    components/                 # card UI: CardArt (resolves a card's skin), CardFrame, CardModal,
                                #   CardPlaceholder, DeckGrid, TarotCard, RawP5Card, cardMeta
    decks/                      # the deck LAYER: registry, types, spreads, custom-loader + each deck's skin(s)
      registry.ts types.ts card.ts validate.ts spreads.ts custom.ts index.ts
      ultima/                   #   cards/ (typed p5 "kit" skin) + index.ts
      ulysses/                  #   cards.ts (raw-p5 + Pixel image skins) + pixel/*.png
      byrne/                    #   cards.ts (image skin) + cards/*.png
      finalfantasy/             #   cards.ts (Pixel chibi skin) + pixel/*.png
    reading/                    # deal, encode/decode the reading token, build the LLM prompt
    styles/                     # the design-system tokens: light core + per-deck data-theme "worlds"
../decks/<id>/deck.json         # the DATA (top-level, outside this app) — read via @decks
../.github/workflows/deploy.yml # CI build + deploy to GitHub Pages
```

**Layers, by dependency direction:** `runtime` (pure, no React) ← `components` (React, deck-agnostic)
← `decks` (registry + skins, reads data via `@decks`) ← `app` (shell). A sketch never imports React; the
app discovers decks through the registry.

## Run / build

```bash
cd app
npm install
npm run dev        # http://localhost:5173  (#/  ->  #/deck/ultima)
npm run build      # -> dist/  (Vite reads ../decks for data)
npm run typecheck
npm test           # strict compilation + Node regression tests, including every bundled deck
```

GitHub Pages: push to `main`; the workflow builds `app/` and deploys `dist/`. `base: "./"` works under
any `/<repo>/` path, and **hash routing** needs no 404/SPA-fallback — and (key for readings) a
`#fragment` is never sent to a server, so reading URLs stay client-side.

## Archived developer registration workflow

The following describes historical source registration. It is not the public import path, and the
seven retired source directories must not be reintroduced into a public build. New user decks use
My Decks or MCP `import_deck`, with the same runtime validation and generic metadata/spreads.


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

Imports validate every card and axis reference before registration, derive card order from axis indices,
and cannot replace a bundled deck. Cardinality and numeric-origin rules belong to authoring profiles,
not the general runtime contract; the 86-card Ultima Octave remains supported.

New reading links store card slugs, a SHA-256 fingerprint of canonical deck JSON, and a snapshot of the
spread. Reordering JSON keys does not change a reading; edited deck contents trigger an explicit
revision mismatch. Custom decks remain session-local: recipients need to import the original JSON.
Legacy built-in links are marked unverified; legacy custom links are refused rather than guessed.

See [the contract and protocol notes](../docs/contracts-and-readings.md) for compatibility, limits,
and validation boundaries. CI runs the tests, full application typecheck, and production build.

## Signed-in MCP setup

My Decks and Account → Connected clients show the Claude/ChatGPT setup panel only after the
session service confirms sign-in. `/auth/session` supplies the canonical `mcpUrl` from the server’s
validated OAuth resource configuration; the browser must not infer it from an alias, a preview
build hostname, or a hard-coded production address. Missing/invalid metadata shows an actionable
error instead of a guessed endpoint. Static deployments without accounts do not show the panel.

The instructions use Arcana’s existing CIMD/published-client identity flow and do not enable dynamic
client registration, provision client credentials, or authorize a client themselves. Host UI labels,
plans and workspace policies vary; the panel links to current official guides. Its first prompt reads
the complete authoring guide and checks the personal library without creating or modifying a deck.
The component tests cover session gating, canonical metadata, clipboard failures/retries and logout.

## Account card artwork

Each owned deck in **My Decks** has an **Artwork** action at `#/deck/<resource-id>/artwork`.
Choose a card and upload one PNG, JPEG, or WebP (up to 3,000,000 bytes / 16 megapixels).
The server verifies ownership, raster content, revision, and the previous artwork ID, then
re-encodes the image. SVG, animation, and executable rendering code are not accepted.
A replacement conflict refreshes the card list and requires a new explicit selection/upload.

The browser keeps artwork separate from deck manifests and the trusted visual-pack registry.
A disposable catalog-route store fetches one access-checked metadata catalog, then version-pinned
same-origin image bytes for cards being displayed. Only validated WebP responses become object
URLs. Raster artwork takes precedence in the grid, card detail, and readings; unavailable or
failed images retain the semantic card face. Leaving the route or changing authenticated account
aborts work and revokes its object URLs. Deployments without artwork storage return to that
semantic fallback and show a clear upload-unavailable error.

Authenticated `/auth/session` responses include a non-secret stable `accountId`. A focus refresh
for the same ID/profile preserves pending work, including native file-picker selections. Missing
identity, account changes, logout, or failed session verification never preserve authenticated
snapshots based only on email/display name. Artwork requests and image bytes use `no-store` and
never follow returned external URLs or redirects.

On opening an account deck, the browser checks artwork coverage before choosing a set. One set
with saved card images is selected automatically, even when the legacy Saved artwork destination
or other named sets are empty. Several populated sets require an explicit choice unless a valid,
populated per-deck choice is already remembered. A stale/empty remembered choice does not override
available artwork. Automatic choices are not saved as viewer preferences. Empty decks retain their
semantic faces and editable upload destinations. The editor lists empty sets and honors an explicit
empty choice so an owner can start uploading there; browsing/reading never mix images across sets.
