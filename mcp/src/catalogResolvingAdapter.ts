import { canResolveUserDeck, type UserDeckRecord } from "../../app/src/decks/catalog.js";
import { DeckRegistry } from "../../app/src/decks/registry.js";
import { ArcanaEngine } from "../../app/src/engine/ArcanaEngine.js";
import { ArcanaToolAdapter, type ArcanaToolName } from "../../app/src/mcp/ArcanaToolAdapter.js";
import { decodeReading } from "../../app/src/reading/encode.js";
import type { UserDeckCatalogRepository } from "./userDeckCatalog.js";

/**
 * Read-through adapter for shared catalog decks.
 *
 * Local/bundled/owned decks always win. A visible catalog resource that is not local is validated
 * into an isolated scratch engine for exactly one call, so shared use never mutates the caller's
 * host registry, ownership, or durable state.
 */
export class CatalogResolvingArcanaToolAdapter extends ArcanaToolAdapter {
  constructor(
    private readonly local: ArcanaToolAdapter,
    private readonly catalog: UserDeckCatalogRepository,
    private readonly viewerId: string | null,
  ) {
    super(local.engine);
  }

  override definitions() {
    return this.local.definitions();
  }

  override async call(name: ArcanaToolName, input: unknown = {}): Promise<unknown> {
    const deckId = referencedDeckId(name, input);
    if (!deckId || this.local.engine.getDeck(deckId)) return this.local.call(name, input);

    const record = await this.catalog.get(deckId);
    if (!record || !canResolveUserDeck(record, this.viewerId)) {
      return this.local.call(name, input);
    }

    return adapterForRecord(record).call(name, input);
  }
}

function adapterForRecord(record: UserDeckRecord): ArcanaToolAdapter {
  const engine = new ArcanaEngine(new DeckRegistry());
  engine.importDeck(record.manifest.data, {
    tagline: record.manifest.tagline,
    ...(record.manifest.spreads ? { spreads: record.manifest.spreads } : {}),
    runtimeId: record.id,
    aliases: [record.slug],
  });
  return new ArcanaToolAdapter(engine);
}

function referencedDeckId(name: ArcanaToolName, input: unknown): string | undefined {
  if (name === "list_decks" || name === "import_deck") return undefined;
  const args = objectInput(input);
  if (!args) return undefined;

  if (name === "resolve_reading" || name === "interpretation_context") {
    const explicit = text(args.deckId);
    if (explicit) return explicit;
    const token = text(args.token);
    return token ? decodeReading(token)?.d : undefined;
  }

  return text(args.deckId);
}

function objectInput(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value.trim();
}
