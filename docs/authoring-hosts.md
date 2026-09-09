# Authoring across hosts

Generative Arcana has one authoring workflow and one persisted authored artifact. Hosts are adapters around that workflow, not alternate deck implementations.

## Portable bundle

`skill/generative-arcana/` is the portable authoring bundle. The directory name is historical; its contents are host-neutral:

```text
skill/generative-arcana/
  SKILL.md
  references/
  strategies/
```

`SKILL.md` contains only portable authoring instructions plus standard `name`/`description` frontmatter. References and strategy modules contain no ChatGPT-, Claude-, OAuth-, account-, renderer-, or provider-specific ontology.

The runtime-shaped source of truth remains the shared domain code and `DeckManifest` validator. The bundle describes **how to author well**; `get_deck_authoring_spec` / `validate_deck_manifest` say whether the resulting artifact is valid for the current platform contract.

## ChatGPT

The portable `skill/generative-arcana/` directory is the ChatGPT-facing skill bundle. No OpenAI-specific field belongs in `DeckManifest`; the host may supply reasoning, tools, file output, and image generation around the common workflow.

When the Generative Arcana MCP is connected, the workflow validates before delivery and treats import as a separate explicit mutation.

## Claude Code / repository agents

Claude Code and Claude repository agents discover project skills from `.claude/skills/<skill-name>/SKILL.md`. The checked-in wrapper at:

```text
.claude/skills/generative-arcana/SKILL.md
```

contains only discovery instructions and delegates to the portable bundle above. It must not copy the schema, strategy registry, or workflow into a second editable location.

Anthropic currently documents this project-skill location and the standard `SKILL.md` frontmatter format here:

- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- https://platform.claude.com/docs/en/managed-agents/skills

## Standalone Claude custom skill

Anthropic custom Agent Skills also use a directory with a top-level `SKILL.md` plus supporting files. Therefore the **same portable `skill/generative-arcana/` bundle** can be packaged/uploaded as a standalone custom Claude skill; the repo-only `.claude` wrapper is not part of that bundle.

This is deliberate: project discovery is host glue, while the bundle remains portable.

## Other hosts

A future native/web authoring adapter should implement only the host UX:

1. collect or generate authored content using the portable workflow or equivalent UI;
2. assemble canonical `DeckManifest`;
3. validate with the shared domain/API boundary;
4. repair until canonical and valid;
5. persist/import only when requested.

Do not copy validation rules into the adapter, introduce a host-specific manifest, or make premium/inference policy part of the deck ontology.

## Drift guard

`tools/check-authoring-hosts.mjs` is run in CI. It verifies that:

- the portable skill frontmatter remains compatible with standard Agent Skill naming/description constraints;
- the Claude wrapper remains thin and points at the portable bundle;
- the portable workflow references the platform validation tools;
- Markdown `references/*.md` and `strategies/*.md` named by the workflow actually exist.

The guard intentionally does **not** compare copied workflows, because there should be no copied workflow to compare.
