# Deck contracts and stable reading links

## Three separate layers

A deck contains meaning and structure, plus an authored **iconographic brief**: axis motifs, glyphs,
and integrated scene descriptions. A skin supplies the **rendered treatment**. Renderer independence
does not mean the data contains no visual ideas; it means it contains no rendering implementation.

`app/src/decks/card.ts` is the renderer-independent card-data contract. Existing sketches can still
import `CardData` from `runtime/types.ts` via its compatibility re-export. Ultima's suit registers and
station-light kernels remain intentionally specialized; the kit rejects unsupported vocabularies
explicitly instead of asserting that every deck uses Ultima's names. Other decks keep their existing
raw-p5/image renderers.

## Runtime validation is not a fixed authoring profile

The default skill profile constructs 22 + 4×14 cards with rank-originating minor numbers. Ultima
Octave constructs 22 + 8×8 cards, carries numbers through suits, and has authored minor glosses.
Neither cardinality nor the default location of numeric interpretation belongs in the universal
runtime card type. Explicit, machine-readable construction profiles are a future extension, not
something this change silently infers from a deck name.

The custom importer requires `name`, `slug`, `version`, `theme`, `suits`, `ranks`, `transversal`,
`major_arcana`, and `cards`. It checks every card, required prose/visual-description fields,
references, factorization field shapes when present, optional dialectic references, and unique,
contiguous zero-based axis indices. A slug must match its record key; lowercase hyphens and legacy
underscores are accepted without renaming. Axis palettes/style prose are optional at runtime,
but must have the appropriate types when supplied. Unknown extension fields are preserved.

Validation happens before registration. A failed import cannot replace any existing deck, and a
custom deck cannot overwrite a bundled deck's id. A valid custom re-import may replace an earlier
custom version. Card order is derived: majors by number, then minors by suit index and rank index,
with slug as a deterministic tie-breaker. JSON key order is not card identity.

This is a runtime structural check, not a full authoring-quality or security audit. It does not enforce
complete lattice coverage, the default station walk, mathematical correctness of a gloss, or an exact
prime-factor decomposition. It is **not an SVG sanitizer**; deck-supplied glyphs still use the existing
SVG rendering path. Import authored deck files from trusted sources. Broadening the trust boundary
for arbitrary third-party SVG is separate work.

## Reading token v2

New tokens are base64url-encoded UTF-8 JSON in the URL fragment:

```ts
{
  v: 2,
  d: string,                 // deck id; must agree with the route
  h: string,                 // lowercase SHA-256 hex digest of canonical deck JSON
  s: Spread,                 // complete snapshot, not a mutable spread-id lookup
  q: string,                 // question
  c: [string, 0 | 1][]        // ordered [card slug, reversed] pairs
}
```

Canonicalization recursively sorts object keys using JavaScript's default string ordering, retains
array order, and JSON-encodes every value. The hash covers all deck-data fields, including extension
metadata and iconographic briefs, but not executable skins or card-list insertion order. Whitespace
outside strings and object-key reordering do not change the digest. Authored string edits, metadata
edits, and array reordering do. A digest identifies content; it neither authenticates the author nor
encrypts the question.

Before a reading is displayed, resolution checks token shape, the route's deck id, spread ownership,
exact card/position counts, deck fingerprint, unique card identities, and existence of every card.
It either resolves the complete reading or returns an explicit error. It never silently substitutes
a newer deck revision, skips missing cards, or deals fewer cards than a spread requires. The browser
uses Web Crypto for SHA-256 (HTTPS or localhost); hash failures are surfaced rather than bypassed.

Limits are 65,536 encoded characters, 4,000 UTF-16 code units of question text, and 512 positions.
Cards are dealt without replacement. New links snapshot spread descriptions and prompts so editing
a named spread later cannot change an existing interpretation.

## Compatibility and availability

Well-formed **v1 built-in** links still resolve using the existing bundled order. The UI explicitly
warns that these index-based links do not establish the original deck revision. **V1 custom** links
are refused: the old importer relied on JSON property order, which cannot be safely reconstructed
from a newly imported file. Cast a new reading to obtain a v2 link.

Custom decks are still session-local and are not embedded in a link. A recipient must import the
same original deck JSON and reopen the link. A fingerprint detects missing/different revisions; it
does not provide archival storage or retrieve an old bundled deck automatically. Anyone possessing
a link can read its question and card selections; URL-fragment storage is not encryption. Copying
the self-contained prompt remains an alternative for sharing a reading without installing its deck.

## Checks

From `app/`, run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`. The test command uses
the existing TypeScript dependency and Node's built-in test runner: it strictly compiles the pure
contract/import/reading modules, tests the entire bundled corpus, and cleans its temporary output.
There are no new package dependencies or lockfile changes. The PR workflow runs all three checks;
the Pages build repeats the checks before publishing.
