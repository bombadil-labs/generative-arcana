---
name: generative-arcana
description: Design or generate a thematically coherent Generative Arcana tarot deck and emit the canonical DeckManifest. Use when the user asks to create, author, design, revise, or validate a custom tarot deck in this repository.
---

# Generative Arcana — Claude host wrapper

This file is intentionally thin. **Do not define a Claude-specific deck schema or generation method here.**

The canonical portable authoring bundle for this repository is:

```text
../../../skill/generative-arcana/SKILL.md
```

Read that file and follow it as the source of truth. Resolve every `references/...` and `strategies/...` path relative to the canonical bundle directory (`skill/generative-arcana/`), not relative to this wrapper.

When the Generative Arcana MCP is connected, use the canonical workflow's platform loop: call `get_deck_authoring_spec`, construct a `DeckManifest`, and use `validate_deck_manifest` as repair feedback until the result is `valid: true, canonical: true`. Only perform `import_deck` when the user explicitly wants an account/host mutation.

This wrapper supplies **discovery only**. Claude contributes intelligence and presentation; Generative Arcana owns the authored artifact contract and validation semantics.
