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

## Production account prerequisite

- Web app: https://generative-arcana.vercel.app/
- MCP URL: `https://generative-arcana.vercel.app/mcp`
- Library: [My Decks](https://generative-arcana.vercel.app/#/my-decks)

**Not yet verified:** the 2026-09-30 public audit found production browser sign-in disabled and MCP
in private-alpha mode. The flow below applies once the deployment is account-enabled and the
[launch acceptance checklist](production-launch-checklist.md) passes. “Accounts aren’t configured
yet” or `/readyz` HTTP 503 is an operator setup blocker; do not distribute an alpha secret as a
friend-account workaround.

These onboarding steps describe the self-hosted Better Auth account path after the operator
activates and verifies it.

Create/sign into your Generative Arcana account from My Decks and verify your email. Then authorize the
**same Generative Arcana account** in both hosts. Your Claude/OpenAI account selects the host;
your Arcana login selects the deck library. Email similarity alone does not link accounts.

## Claude remote custom connector

1. In Claude, open **Settings → Connectors → Add custom connector** (workspace controls may require
   an owner/admin to add it first).
2. Enter a name such as **Generative Arcana** and the remote MCP URL above.
3. Complete **Connect** and the provider's login/consent flow using your Arcana account. If the
   deployment uses a pre-registered OAuth client, its operator supplies that client's ID/secret
   through Claude's **Advanced settings**; do not put them in conversation messages.
4. Enable the connector for the conversation and ask for `list_my_decks` before saving anything.
   Use the common authoring workflow below.

Claude's current documentation makes custom remote connectors available across plans; Free is
limited to one custom connector. Team/Enterprise workspace controls still apply. Check the current
[remote connector setup](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
and [plan/connector availability](https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities).
These host capabilities are not evidence that Arcana's production OAuth has been tested.

## ChatGPT custom MCP connection

Use a ChatGPT account/workspace with its supported **custom MCP / developer-mode** surface enabled.
Workspace administrators may need to permit custom connections and write actions. The ordinary
chat composer or a public app-directory listing is not proof that a custom server can be installed.

1. Open the host's app/connector management settings and enable developer mode where required.
2. Create a custom connection with `https://generative-arcana.vercel.app/mcp` and choose OAuth.
   Use the configured dynamic-client path, or the operator-provided pre-registered client where
   supported. Copy any connection-specific OAuth callback from the management UI; the operator
   must allowlist that exact callback in the corresponding provider application.
3. Connect and consent using the same Arcana account as the web app and Claude.
4. Add/enable the connection in a new conversation, confirm `list_my_decks`, then follow the
   workflow below. Allow an explicitly requested import/write when the host asks.

The current [OpenAI MCP authentication guide](https://developers.openai.com/plugins/build/auth)
documents OAuth and client-identification/registration requirements. Plan, workspace policy, and
rollout can affect which setup UI is available; record the actual supported product/surface in the
[acceptance checklist](production-launch-checklist.md). A direct API bearer-token smoke does not
verify ChatGPT end-user login or tool approvals.

The portable `skill/generative-arcana/` directory is the host-neutral authoring bundle. Use it in a
host that supports skills, or have the model read `get_deck_authoring_guide` through MCP.
`get_deck_authoring_spec` remains the compact machine-readable contract and links to that guide.
A custom skill package alone does not create an OAuth connection or save to an account.
No OpenAI-specific field belongs in `DeckManifest`.

## Reading the authoring guide

Call `get_deck_authoring_guide({})` before planning. No arguments return all 23 canonical source
files verbatim, with filename headers: the full skill, references, strategies, and reviewed
supporting contracts. Broad reading is the default because planning needs the method before
strategy selection. This public, read-only tool needs no login; the same full text is available
at the listed resource `arcana://authoring/guide`.

For a host with output limits, use the same tool in two steps:

1. Call `get_deck_authoring_guide({ toc: true })` for a compact inventory with bundle format,
   hashes, total size, and every file's exact path, size, and purpose.
2. Call it with `{ files: ["skill/generative-arcana/SKILL.md", "skill/generative-arcana/strategies/index.md"] }`
   before selecting strategies. Continue reading whole files in sensible batches, using exact
   repository-relative filenames from the TOC. Returned files are verbatim, retain their filename
   headers, and appear in canonical order even if requested in another order. A TOC or purpose
   label is navigation, not a replacement for the source instructions.

All modes return the complete structured inventory. Its source `bytes`/`chars` exclude headers;
`section.bytes`/`section.chars` include the file's framing. Allow one extra newline between
selected sections when sizing a batch. Empty selections, duplicate or unknown paths, and mixed
modes are rejected, including `files` or `toc` combined with `offset: 0`.

Use legacy `offset`/`maxChars` only for an existing chunking client or an oversized file. Offsets
are Unicode code points into the full guide. For a single file, start at its `section.offset`,
cap each chunk to the remaining `section.chars`, and concatenate without separators until that
section is complete. The returned `range.nextOffset` is full-guide-relative, so do not use its
nullness to detect the end of one file. See the [complete retrieval contract](../mcp/README.md#response-metadata-and-version-checks).

For an installed copy, compare the TOC's source hashes against **all** inventory files, including
`docs/contracts-and-readings.md`, `docs/deck-manifest.md`, `docs/schema-v2.md`, and
`docs/visual-grammar.md`. Comparing only the installed skill directory misses those supporting
contracts. Global `sha256` and `sourceDigest` always identify the complete bundle and canonical
inventory, respectively; compare them across retrieval calls. Purpose labels are not hashed.
`formatVersion: 1` is the unchanged bundle-framing version, not a tool API version.

## Author → validate → explicitly import

A prompt that makes the intended save explicit:

> Design a deep-sea mythology tarot deck. First read the complete Generative Arcana authoring guide and authoring spec, then
> create a canonical schema-v2 manifest and repair it until validation succeeds. Show me the
> summary before importing it into my private library. Do not replace or publish an existing deck.

The complete tool flow is:

1. Call `get_deck_authoring_guide({})` for the complete portable method, then `get_deck_authoring_spec`
   for the current executable contract. If the host limits output, use the
   [TOC and whole-file batches](#reading-the-authoring-guide) above.
2. Produce a canonical `DeckManifest` with `schemaVersion: 2`, `data`, `tagline`, and optional `spreads`.
   Ownership, visibility, revision, and provider IDs do not belong inside the manifest.
3. Call `validate_deck_manifest({ manifest })`; repair until `valid: true` and `canonical: true`.
   Validation is stateless and does not save the deck.
4. After you approve saving it, explicitly call `import_deck({ manifest })`. New catalog decks start private. Save the returned
   stable resource ID and confirm it with `list_my_decks`; do not substitute the authored slug.
5. Use that resource ID with `get_deck`, `list_spreads`, and `cast_reading`; use the resulting token
   with `resolve_reading` / `render_reading`. A host without the richer visual UI can still use the
   structured reading and supported image/text fallback.
6. Open My Decks while signed into the same account, select the deck, and deal in the browser.
   Reconnect/refresh the other host and verify it sees the same ID and latest contents.

For larger decks, prefer native-file validation or upload-ticket PUT when the host supports it,
then validate/import by immutable `uploadId`. If Claude's sandbox PUT fails with
`host_not_allowed`, use `start_deck_draft` → bounded `update_deck_draft` batches →
`validate_deck_draft` → explicitly authorized `commit_deck_draft`, all through the MCP connector.
Keep the returned draft version and retry keys; recover only necessary sections with
`get_deck_draft`. This avoids a single giant inline call and repeated transmission of accepted
batches. The text still passes through model tool arguments, so this is not zero-copy transport.
Native files, raw PUT, inline staging and legacy inline tools remain available. See the
[limits and resumable workflow](mcp-efficiency.md#incremental-resumable-mcp-drafts). Host acceptance
must be tested separately; local protocol tests do not prove a real Claude conversation succeeded.

For a revision, retain the authored slug, validate the changed manifest, then explicitly request
`import_deck({ manifest, replaceExisting: true })`. Replacement preserves the resource ID and
publication state and advances the catalog revision. A duplicate import without that flag fails;
it must not be silently treated as permission to replace. Use a new slug for a distinct deck.

No separate server-side `generate_deck` tool is necessary: the host model authors the content and
Arcana validates/persists the common manifest. See [validation](authoring-validation.md) and
[manifest identity](deck-manifest.md).

## Sharing and storage

- **Browser-local paste on the landing page:** current page runtime only. It is not an account save;
  after a full reload or on another browser, import the original JSON again.
- **My Decks / authenticated MCP import:** account-owned server catalog entry, private by default.
  With the production Neon deployment configured, it should survive refresh, reconnect, and restart;
  that behavior still requires the recorded live acceptance evidence.
- **Unlisted:** deliberately choose it in My Decks or call `set_deck_visibility` with the deck ID.
  Anyone with the stable link/ID can resolve it; it is absent from Community/public discovery.
- **Public:** also discoverable in Community. Private links grant no access to another user.

Use the catalog's stable resource link/ID for account decks; visible shared decks do not require
recipient-side JSON import. Re-privatizing/deleting blocks future unauthorized catalog reads, not
copies or prompts already received. Reading links contain questions and card selections, not a
full deck or encrypted data. A replacement can invalidate an old link's deck fingerprint, so keep
the original manifest when archiving a reading. See [reading contracts](contracts-and-readings.md).

## Connection troubleshooting

- **Protected tools missing:** first check account readiness. Non-OAuth anonymous deployments
  intentionally omit them. In OAuth mode they should be advertised before login; refresh/reconnect
  the host after a deployment or tool change.
- **Login works but import is denied:** verify actual `decks:read` and `decks:write` grants and the
  exact MCP audience. Verify the selected client-identification/registration path and consent;
  do not substitute OIDC identity scopes for deck permissions.
- **Web and host show different libraries:** check the selected Arcana account, issuer/subject
  mapping, production versus preview environment, and stable resource ID. Do not publish a private
  deck or weaken ownership checks to hide an identity mismatch.
- **Discovery looks like HTML:** the host is not receiving valid OAuth metadata. Check the
  deployment/routing rather than retrying credentials.

Operators should use the [deployment guide](better-auth-deployment.md); never paste access
credentials into a chat or bug report.

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
