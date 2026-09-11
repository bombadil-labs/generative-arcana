# Portable visual packs

`DeckManifest` remains the canonical symbolic/authored deck artifact. Card art and executable visual programs have a different lifecycle: they can be large, host-dependent, security-sensitive, and replaceable without changing what a card means. They therefore belong in a separate **VisualPackManifest** attached to a deck resource by the catalog/import operation.

This is the durable/shareable counterpart to the browser's existing runtime `VisualRegistry`.

## Why a separate artifact

A deck may have many visual treatments over the same symbolic cards. A visual pack can also evolve or be replaced independently of deck semantics. Keeping it separate avoids putting React components, p5 instances, URLs, provider metadata, or executable authority into `DeckManifest`.

A portable pack has no globally canonical deck id inside it. The operation that imports/attaches the pack supplies the owning deck resource. That lets a deck + visual bundle travel before Generative Arcana assigns opaque resource identity, and avoids turning authored slugs into identity again.

## v1 shape

```ts
interface VisualPackManifest {
  schemaVersion: 1;
  id: string;            // authored pack-local metadata, not global identity
  label: string;
  description?: string;

  assets: Record<string, ImageVisualAsset | ProgramVisualAsset>;
  cards?: Record<CardSlug, VisualAssetBinding>;
  spreads?: Record<SpreadId, VisualAssetBinding>;
}

interface VisualAssetBinding {
  asset: AssetKey;
  fallback?: AssetKey;   // must resolve to an image
}
```

Asset keys are logical names inside the portable bundle. Asset declarations use safe relative POSIX paths rather than URLs. A future import/storage service may assign opaque asset records and object-storage locations without rewriting card/spread bindings or exposing provider URLs to the authored model.

### Images

```ts
{
  kind: "image",
  path: "cards/major-0.png",
  mediaType: "image/png",
  integrity?: "sha256-..."
}
```

### Programs

```ts
{
  kind: "program",
  path: "spreads/core-sample.js",
  mediaType: "text/javascript",
  format: "generative-arcana/spread-scene-p5@1",
  capabilities?: ["time", "pointer", "resize", "signals"],
  dependencies?: ["texture-a", "poster"]
}
```

`format` is a stable, namespaced capability identifier. It is not synonymous with permission to execute. Hosts render only formats they explicitly support under their own trust/sandbox policy.

`capabilities` is likewise descriptive: requesting pointer or signals does not grant browser/host authority.

## Fallbacks

A card or spread binding may pair a program with a static image fallback. Fallbacks are intentionally restricted to image assets. This gives hosts that cannot or will not execute a program a portable non-executable representation.

A program with no fallback is legal; an unsupported host may simply render the ordinary semantic card/spread UI.

## Bundle safety

Portable asset paths are relative bundle paths only:

- no absolute paths;
- no `..` traversal;
- no URL/URI schemes;
- no backslashes;
- no query strings or fragments.

The optional integrity field uses Subresource-Integrity-style SHA-256 syntax. Importers should compute/verify a digest when materializing durable asset records even when the author omitted one.

Program dependencies refer only to other asset keys in the same pack. This is the beginning of a closed asset graph; it is not a general network-import mechanism.

## Deck attachment

Standalone validation checks the portable artifact itself. Attachment validation additionally proves:

- every card binding names a card in the owning `DeckManifest`;
- every spread binding names either a generic platform spread or a native spread belonging to that deck.

The pack remains independently versionable after attachment.

## Execution boundary

**A valid program asset is not trusted code.**

This contract deliberately does not add a `new Function`, dynamic module import, or user-code execution path. Today's bundled p5/raw-p5 modules remain trusted application code. The next layers are separate projects:

1. durable asset/blob persistence + catalog records;
2. runtime materialization of image assets and explicitly trusted program formats;
3. sandboxed execution for untrusted user programs, with CSP/origin isolation, constrained messaging, network policy, CPU/frame budgets, teardown, and fallbacks.

That sequencing lets visual packs become portable/shareable now without quietly turning deck upload into arbitrary JavaScript execution.
