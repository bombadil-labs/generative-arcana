/** Keep JSON text by default for hosts that do not expose structuredContent. */
export const ARCANA_RESPONSE_FORMATS = ["json", "structured"] as const;
export type ArcanaResponseFormat = typeof ARCANA_RESPONSE_FORMATS[number];

export interface ToolResultOptions {
  responseFormat?: ArcanaResponseFormat;
  /** Required for structured mode: the text block remains useful without repeating the payload. */
  summary?: string;
}

/**
 * The structured envelope is stable in both modes. JSON mode is the backward-compatible default:
 * whitespace is compact, but text-only consumers still receive the complete parseable result.
 * Structured mode must be explicitly requested by a host/model able to read structuredContent.
 */
export function toolResult<T>(result: T, options: ToolResultOptions = {}) {
  const format = options.responseFormat ?? "json";
  if (format !== "json" && format !== "structured") throw new Error("responseFormat must be json or structured.");
  let text: string;
  if (format === "structured") {
    if (typeof options.summary !== "string" || !options.summary.trim()) {
      throw new Error("A non-empty summary is required for a structured tool response.");
    }
    text = options.summary;
  } else {
    const serialized = JSON.stringify(result);
    if (serialized === undefined) throw new Error("Tool result must be JSON-serializable.");
    text = serialized;
  }
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: { result },
  };
}

/** Small, useful text companion for callers that explicitly request the structured-only payload. */
export function summarizeToolResult(toolName: string, result: unknown): string {
  if (Array.isArray(result)) {
    const subject = toolName === "list_decks" ? "decks"
      : toolName === "list_spreads" ? "spreads"
        : toolName === "query_cards" ? "matching cards" : "items";
    return `Returned ${result.length} ${subject}. Full data is in structuredContent.result.`;
  }
  const value = object(result);
  if (toolName === "validate_deck_manifest" && typeof value?.valid === "boolean") {
    if (!value.valid) return `Deck manifest is invalid: ${label(value.error) ?? "validation failed"}`;
    const summary = object(value.summary);
    return `Deck manifest is valid${label(summary?.name) ? `: ${label(summary?.name)}` : ""}${cardCount(summary?.cardCount)}. Full validation is in structuredContent.result.`;
  }
  if (toolName === "get_deck_authoring_spec") {
    return `Canonical DeckManifest authoring contract, schema version ${object(value?.schema)?.current ?? "unknown"}. Full contract is in structuredContent.result.`;
  }
  if (toolName === "get_deck" || toolName === "import_deck") {
    const summary = object(value?.summary) ?? value;
    const data = object(value?.data);
    const name = label(summary?.name) ?? label(data?.name) ?? label(summary?.id) ?? "deck";
    const cards = object(data?.cards);
    const count = summary?.cardCount ?? (Array.isArray(value?.cards) ? value.cards.length : cards ? Object.keys(cards).length : undefined);
    return `${toolName === "import_deck" ? "Imported deck" : "Deck"}: ${name}${cardCount(count)}. Full result is in structuredContent.result.`;
  }
  if (toolName === "get_card" || toolName === "analyze_card") {
    const card = object(value?.card) ?? value;
    return `Card: ${label(card?.name) ?? label(card?.slug) ?? "resolved"}. Full ${toolName === "analyze_card" ? "analysis" : "card and render specification"} is in structuredContent.result.`;
  }
  if (Array.isArray(value?.placements)) {
    return `Reading for ${label(value.deckName) ?? label(value.deckId) ?? "deck"}: ${value.placements.length} placements. Token and full placements are in structuredContent.result.`;
  }
  if (toolName === "interpretation_context") {
    return `Interpretation context for ${label(value?.deckId) ?? "deck"}. Token and full context are in structuredContent.result.`;
  }
  return `${toolName} completed. Full result is in structuredContent.result.`;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function label(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 160 ? `${compact.slice(0, 157)}...` : compact;
}

function cardCount(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? ` (${value} cards)` : "";
}
