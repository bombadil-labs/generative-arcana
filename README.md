# Generative Arcana

**[▶ Open Generative Arcana](https://generative-arcana.vercel.app/)** — browse decks and deal readings.

- **Production web app:** https://generative-arcana.vercel.app/
- **Remote MCP endpoint:** https://generative-arcana.vercel.app/mcp
- **[Connect Claude or ChatGPT and author a deck](docs/authoring-hosts.md)**
- **[Self-hosted Better Auth setup](docs/better-auth-deployment.md)** · **[Launch evidence checklist](docs/production-launch-checklist.md)**

**Account launch status (last public audit: 2026-09-30 UTC):** the app and anonymous MCP tools are live,
but production was still in private-alpha bearer mode, browser sign-in was disabled, and `/readyz`
returned 503. This branch selects self-hosted Better Auth with Neon for the account path;
implementation is separate from production activation and operating approval. The real
Better Auth → Claude/ChatGPT → web account journey is **not yet verified**. The account instructions below describe
the intended configured flow, not a claim that production signup is available today. Check the
[launch checklist](docs/production-launch-checklist.md) before inviting account users.

Generative Arcana is three things that fit together:

1. **A method** for designing thematically coherent custom tarot decks, each woven from four symbolic
   axes — **suit**, **rank**, a **transversal** substrate (the generalization of tarot's Chaldean/decan
   order), and the **prime/composite** character latent in every card's number. Packaged as a Claude skill.
2. **A deck corpus** — the decks themselves, as portable, renderer-agnostic JSON. A `deck.json` carries
   renderer-independent *data*: meanings, structure, the four axes, and an authored iconographic brief.
   It contains **no executable rendering implementation**; skins supply the rendered treatment.
3. **A web app and MCP service** that render those decks, manage account-owned libraries when configured,
   and turn readings into shareable links and LLM-ready prompts. The React/Vite client and Node service
   are served together on the canonical production URL; GitHub Pages is a separate static build.

The split is the whole idea: **a deck is data; how it looks is a separate, pluggable layer.** A deck can
ship one or more named **skins**, and each card's renderer is resolved *per card* — a typed p5 "kit"
sketch, a raw p5 sketch, or a static image — so the same deck data can wear animated generative art,
hand-built pixel art, smooth generative light, or flat composed components. Skins are selectable in the
browser; a skinless deck (or one you paste in) still browses and reads, just with placeholder faces.

## Create, save, and share your own deck

The account path uses self-hosted Better Auth, with one stable internal owner identity shared
by browser and MCP. Once the production account setup is enabled and the [acceptance checks](docs/production-launch-checklist.md)
pass:

1. Open [My Decks](https://generative-arcana.vercel.app/#/my-decks), choose **Sign in**, and create or
   sign into your Generative Arcana account and verify your email. Use that same account in every host.
2. Connect `https://generative-arcana.vercel.app/mcp` in a supported Claude or ChatGPT custom MCP
   surface and complete its OAuth login/consent flow. See [host-specific setup](docs/authoring-hosts.md)
   for account/workspace prerequisites.
3. Ask the host to call `get_deck_authoring_spec`, author a canonical schema-v2 `DeckManifest`, and
   repair it with `validate_deck_manifest` until `valid: true` and `canonical: true`.
4. Explicitly ask it to save the validated manifest with `import_deck`. New catalog imports are
   **private**. Confirm the returned stable resource ID with `list_my_decks`; validation alone does
   not save anything. No separate server-side `generate_deck` tool is required.
5. Find that same ID in My Decks and the other connected host. Open it in the web app to browse/deal,
   or call `list_spreads` → `cast_reading` → `resolve_reading` / `render_reading` in the host.
6. To revise an existing deck, validate the new manifest and explicitly import it with
   `replaceExisting: true` and the same authored slug. Replacement keeps its resource ID and
   visibility and advances its revision. It does not preserve every historical reading revision.
7. To share, deliberately change **Visibility** in My Decks or use `set_deck_visibility`:
   **unlisted** permits anyone with the stable link/ID to open it; **public** also lists it in
   Community. A private deck's link does not give another account access.

You can also import without an LLM: upload/paste a manifest into My Decks, choose **Validate deck**,
then **Import deck**. Replacement has its own explicit checkbox.

### Where your deck lives

| Kind | Storage and availability | Sharing |
|------|--------------------------|---------|
| Bundled deck | Shipped with the app/service | Open by its bundled ID |
| Browser-local pasted deck | Current browser page runtime; not an account save and lost on a full reload | Recipient needs the same original JSON |
| Private account deck | Server-side catalog in Neon when production accounts are configured; owned by your account | Owner must sign in; the link grants no access |
| Unlisted/public account deck | Same durable catalog record, with intentional visibility | Resolves by stable resource ID without a local re-import; public also appears in Community |

Reading links contain the question, spread, and card selections, **not the full deck**. They check
an exact deck fingerprint; replacing a deck can make an old reading fail with a revision mismatch.
Keep the original manifest for archival use. Anyone who has a reading link can decode its question
and selections; a URL fragment is not encryption. See [reading-link contracts](docs/contracts-and-readings.md).

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
app/                          the web client (Vite + React + TypeScript)
mcp/                          the Node MCP, account, authoring, and catalog APIs
Dockerfile.vercel              builds and serves the full production web + MCP service
tools/pixel/                  Python pixel-art pipeline (Ulysses "Vico", Final Fantasy "chibi")
tools/lumen/                  Python luminous-abstract pipeline (Evolution "Lumen")
tools/cube/                   Python composed-component pipeline (Ultima Octave "Cube")
tools/gen/                    deck-data generators (e.g. the Ultima Octave lattice)
.github/workflows/deploy.yml  builds app/ and deploys to GitHub Pages
```

## The skill

The portable skill teaches a host model to author a complete deck as a single canonical JSON manifest. Read
**[`skill/generative-arcana/SKILL.md`](./skill/generative-arcana/SKILL.md)** for the formalism; the
`references/` define the schema and integration rules, and `strategies/` are the per-stage generators.

Use the current **`skill/generative-arcana/`** bundle in a supported skills host, or follow the
live authoring spec exposed by MCP. The historical `generative-arcana-v2.0.zip` is also included;
the runtime spec and validator are authoritative for new canonical manifests. Ask, for example,
*"Design a deep-sea mythology tarot deck; validate the manifest, then ask me before saving it to my
private library."* See [host setup](docs/authoring-hosts.md). Adding a bundled fixture under
`decks/<id>/` and registering it in source is a developer workflow, not required for an account import.

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
LLM prompt). Browser-dealt reading tokens live in the URL fragment; account imports, catalog reads,
authentication, and MCP operations use the server. The chrome is a
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

## Deploy the full app and MCP service

The production service uses the repository-root [`Dockerfile.vercel`](./Dockerfile.vercel) and
[`vercel.json`](./vercel.json). Serve the web client and `/mcp` on the same canonical origin.
Follow the [Better Auth + Neon deployment guide](docs/better-auth-deployment.md) and record the
[launch evidence](docs/production-launch-checklist.md). Plan for the
[maintenance/rotation/recovery work](docs/better-auth-operations.md) and retain a
[hosted-provider exit path](docs/hosted-auth-migration.md). A successful static build or a green
`/healthz` response alone does not establish account readiness or authenticated host compatibility.

## Optional static build (GitHub Pages)

Pushing to `main` runs [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml), which builds
`app/` (Vite reads `../decks` for deck data) and publishes it. Enable Pages with **Source: GitHub
Actions**. The build uses a relative base, so it works under `https://<user>.github.io/generative-arcana/`.

GitHub Pages hosts only the static client and bundled/browser-local deck experience. It does not
provide the Node account, catalog, authoring API, or MCP routes; use the canonical production URL
for those features.
