# Generative Arcana as a platform

The MCP integration has crossed the important boundary: it can carry a real reading into a host-native visual
experience. The next phase is not merely "harden the ChatGPT integration". Generative Arcana needs one
product/domain model and one host-neutral MCP contract that can be consumed by a first-party web application,
ChatGPT, Claude, and other MCP-capable hosts.

## Product shape

Generative Arcana has four layers:

1. **Deck platform** — accounts, owned decks, revisions, visibility/publication, discovery, and later visual assets.
2. **First-party web app** — create/import/edit decks, browse cards, publish/unpublish, share links, and perform readings.
3. **MCP service** — host-neutral conversational/API access to the same deck platform.
4. **Host adapters** — thin presentation/capability layers for ChatGPT, Claude, and future MCP clients.

The web app and MCP hosts must not maintain separate notions of a deck, reading, or user. They share the same
durable identities and authorization rules. A host may render the same reading differently without changing what
the reading is.

## Host neutrality

The MCP contract is a portability boundary, not a ChatGPT API. Core tools should return renderer-neutral semantic
results first: deck ids, reading ids, spread positions, card identities, orientation, authored position prompts,
layout hints, and visual asset references/content. Host-specific presentation metadata is additive.

Rendering should follow a layered rule:

1. **semantic result** — authoritative structured content that any MCP client can understand;
2. **portable visual payload** — card images/assets and layout hints that are useful across hosts;
3. **MCP Apps UI** — when a host supports interactive MCP app resources, render a richer spread component;
4. **host compatibility adapter** — namespaced metadata/bridges for a specific client, isolated from domain and tool
   semantics;
5. **text/image fallback** — clients without the richer UI path still receive a complete usable reading.

Do not detect or branch on model identity inside the domain layer. Prefer capability/protocol support, and keep
client-specific extensions namespaced so an unfamiliar MCP host can safely ignore them. The current spread widget
already follows this direction: the generic MCP Apps initialization/result protocol is primary, while ChatGPT's
`window.openai` bridge and `openai/*` metadata are compatibility glue. Claude or another host may use a different
rendering adapter while consuming the same `render_reading` semantics.

## User-owned decks

A user-authored deck is a durable resource with:

- an opaque stable `id`;
- an `ownerId` supplied by the authentication layer;
- a mutable human-facing `slug`;
- the validated renderer-neutral deck manifest;
- a monotonically increasing revision;
- visibility: `private`, `unlisted`, or `public`;
- creation/update timestamps and, when applicable, publication time.

Visibility semantics:

- **private** — owner only;
- **unlisted** — anyone with the stable link/id can use it, but it never appears in discovery;
- **public** — anyone can use it and it may appear in catalog/search surfaces.

This makes "share my deck" a domain operation rather than an MCP-specific feature.

## Creation paths

Uploading/importing a deck is a core platform capability and must not require an LLM. A user should be able to
submit a supported deck manifest/package, have it validated, and receive a normal owned `UserDeckRecord`. From that
point onward it has exactly the same privacy, sharing, publication, revision, and reading behavior as any other deck.

LLM-assisted deck creation is a separate authoring path that converges on the same canonical manifest:

1. host-appropriate instructions/skills teach the available model the deck grammar and authoring process;
2. the model produces a candidate renderer-neutral manifest;
3. the MCP validates the candidate and returns actionable validation errors when needed;
4. once valid, the MCP persists it as an ordinary user-owned deck.

When an MCP host already provides an LLM, that host model can do the synthesis work, so Generative Arcana does not
need to pay for a second inference merely to create the deck. ChatGPT, Claude, and future hosts may package or expose
the authoring guidance differently, but they must converge on the same manifest contract. A future web-only
"generate a deck for me" flow may call a hosted model and can be metered or premium because it incurs platform cost.
Entitlements should live on the user/account and be client-agnostic; the deck format and upload/import path remain
universal.

## Bundled decks and launch content

The historical decks in this repository are development/reference fixtures, not implicitly launch catalog content.
The production catalog should start empty or with a deliberately curated set of decks authored through the same
user-facing workflow that everyone else uses. Bundled fixtures may remain available in local/dev/test contexts.

That keeps the launch ontology clean: public decks are published resources, not source-code accidents.

## Account/auth boundary

The existing private-alpha bearer token remains useful for development, but production authentication should resolve
OAuth identities to an opaque internal principal/user id. Neither MCP tools nor deck-domain code should depend on the
choice of identity provider.

Production authorization rules live at the resource boundary:

- owners can create/update/delete/publish/unpublish their decks;
- anonymous users can resolve public and unlisted decks;
- authenticated non-owners have the same read access as anonymous users unless collaboration is added later;
- discovery only returns public decks.

## Web application direction

The current Vite renderer is already most of a first-party client: it browses decks, renders cards, and composes
readings. It should evolve from a static GitHub Pages application into the product UI rather than being replaced.
A server/API layer can add:

- sign in / account settings;
- My Decks;
- import/create/edit flows;
- publish/unpublish controls;
- public deck profile/share pages;
- catalog/discovery;
- stable server-backed reading links where appropriate.

The renderer remains client-side and renderer-agnostic. The API supplies validated manifests and asset references.

## Submission-hardening track

ChatGPT submission is one distribution target for the same production MCP service used by the web app and other
MCP hosts. OpenAI-specific review requirements should remain at the adapter/deployment edge rather than changing the
portable tool contract. Before ChatGPT review:

1. replace static bearer auth with standards-compliant OAuth and stable principal resolution;
2. expose only production-safe tools and annotate read/write/destructive behavior correctly;
3. pin the widget CSP and production widget domain;
4. publish website, support, privacy, and terms pages;
5. provide account deletion/data deletion paths;
6. ensure unauthenticated tools degrade intentionally rather than leaking private deck existence;
7. provide reviewer credentials/instructions for authenticated paths;
8. run protocol, auth, UI, mobile, accessibility, and destructive-action regression checks against the production URL.

## Migration strategy

Do this incrementally:

### Phase 1 — domain foundation

Introduce `UserDeckRecord` and visibility semantics without changing existing bundled-deck behavior.

### Phase 2 — persistent catalog

Add a relational deck repository keyed by opaque user/deck ids. Import existing principal-scoped custom decks into the
new repository on first authenticated access or through an explicit migration.

### Phase 3 — real accounts

Add OAuth/account resolution and preserve the `PrincipalResolver` seam. The MCP and web API both consume the resulting
internal user id.

### Phase 4 — first-party web product

Add authenticated My Decks, publishing, public deck pages, and catalog discovery to the existing renderer application.

### Phase 5 — host adapters and submissions

Keep the core MCP service host-neutral, exercise it against multiple MCP clients, and maintain thin host adapters. For
ChatGPT, finish CSP/domain/legal/reviewer metadata and submit. For Claude and other hosts, implement/test their
presentation adapter or fallback behavior without forking deck/reading semantics.
