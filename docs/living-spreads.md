# Living Spreads

**Living Spreads** is the product-facing name for spread-level interactive visual composition. The lower-level runtime concept is a **spread scene**: one shared visual program receives the complete resolved reading and may render relationships among placements rather than drawing each card in isolation.

The distinction matters. A spread scene is not a special kind of tarot spread and does not change reading semantics. Generative Arcana still owns the deck, spread, placements, reading token, and resolved card context. A host may choose to render that reading as ordinary cards, a shared scene, both, or neither.

## Why one shared scene

Independent animated cards are useful, but they are the wrong primitive for genuine cross-card behavior. Separate canvases make particles, light, topology, and interaction across boundaries awkward and renderer-specific.

A spread scene instead owns one canvas and receives every placement at once. It can therefore:

- let marks, particles, figures, or light travel from one placement to another;
- blend station environments across neighboring cards;
- expose shared rank geometry or dialectical relationships;
- make numeric/factorization relationships visible across majors;
- react to pointer input anywhere in the spread;
- remain deterministic for a particular reading token;
- render a stable poster frame when animation is unavailable or reduced motion is requested.

## Runtime contract

`SpreadSketch` is deliberately parallel to the existing typed p5 `CardSketch`, but it is spread-shaped rather than card-shaped.

A scene receives `SpreadSceneData`:

- stable deck/spread identity;
- spread name/description and question;
- stable seed material (normally the reading token);
- ordered placements;
- each placement's authored `CardData`;
- each placement's full resolved `CardRenderSpec`;
- reversed state and resolved reading meaning;
- a host-provided normalized rectangle describing placement geometry.

The scene runtime (`SpreadSceneKit`) adds canvas size, deterministic time/RNG, pointer state, reduced-motion state, and a host signal channel.

The important consequence is that a scene does **not** need to perform follow-up deck lookups. Schema-v2 render projections already provide the complete inherited visual stack for each card.

## Registration and visual packs

Spread scenes live in the browser/runtime visual registry, alongside card visuals, under the same `(deckId, packId)` skin namespace but in an independent spread namespace.

This means one skin may contain:

- image art for some cards;
- typed p5 sketches for other cards;
- migrated raw-p5 card sketches;
- shared spread scenes for selected spreads.

Card and spread ids do not collide. Pack preference/fallback ordering is shared, so selecting a skin can select both its card treatment and its compatible Living Spread treatment when one exists.

This remains **host adaptation glue**, not canonical deck ontology. A host that cannot execute the scene still has the full reading and card render specifications.

## Persistence / manifest direction

Do not store React components, p5 objects, or executable closures in `DeckManifest`.

A later manifest/asset layer may describe a visual program as a portable asset/capability descriptor (for example a trusted module asset, static fallback, declared interaction capabilities, and aspect-ratio/layout hints). The runtime can then bind supported descriptors to implementations. That design should follow the durable asset/storage model rather than coupling schema v2 directly to p5.

## Security boundary

Bundled first-party/trusted scene modules are safe enough for the current runtime model. User-uploaded executable JavaScript is a separate security project and must not be enabled merely because spread scenes exist.

Before arbitrary uploaded programs are supported, require an isolated execution boundary (for example sandboxed iframe/origin), constrained message API, CSP, asset/network policy, CPU/frame budgets, teardown guarantees, and a non-executable fallback. Raw `new Function` execution remains acceptable only for the existing trusted bundled migration path.

## Delivery sequence

1. **Runtime seam** — `SpreadSketch`, spread-scene registry, pack resolution. (This document's initial PR.)
2. **Browser executor** — p5 lifecycle component + reading-page scene/card toggle.
3. **Proof scene** — one deliberately authored bundled scene to validate cross-card interaction and reduced-motion/poster behavior.
4. **Portable descriptors/assets** — host-neutral references and durable storage for shareable visual programs and fallbacks.
5. **Untrusted program sandbox** — only after the security model is explicit.

The goal is not “make spreads animated.” It is to make the resolved visual grammar compositional: cards remain meaningful independently, while proximity can create a new visual event that belongs to the reading as a whole.
