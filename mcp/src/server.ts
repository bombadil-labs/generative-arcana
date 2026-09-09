import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ArcanaToolAdapter, type ArcanaToolName } from "../../app/src/mcp/ArcanaToolAdapter.js";
import { MAX_QUESTION_LENGTH } from "../../app/src/reading/encode.js";
import { createBundledArcanaAdapter } from "./hostStore.js";
import type { ArcanaToolCallObserver } from "./observability.js";
import { ARCANA_MCP_VERSION } from "./version.js";

export { createBundledArcanaAdapter } from "./hostStore.js";

const MAX_IMPORT_JSON_CHARS = 2_000_000;
const MAX_SPREADS = 64;
const MAX_SPREAD_POSITIONS = 64;

const spreadPosition = z.object({ name: z.string(), prompt: z.string() });
const spread = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  deckId: z.string().optional(),
  positions: z.array(spreadPosition).max(MAX_SPREAD_POSITIONS),
});

const cardQuery = z.object({
  arcana: z.enum(["major", "minor"]).optional(),
  suit: z.string().optional(),
  rank: z.string().optional(),
  station: z.string().optional(),
  omega: z.number().int().nonnegative().optional(),
  factorizationCharacter: z.string().optional(),
  dialectic: z.object({ axis: z.string().optional(), pole: z.string() }).optional(),
}).optional();

const schemas: Record<ArcanaToolName, z.ZodTypeAny> = {
  list_decks: z.object({}),
  get_deck: z.object({ deckId: z.string().min(1) }),
  get_card: z.object({ deckId: z.string().min(1), cardSlug: z.string().min(1) }),
  analyze_card: z.object({ deckId: z.string().min(1), cardSlug: z.string().min(1) }),
  query_cards: z.object({ deckId: z.string().min(1), query: cardQuery }),
  list_spreads: z.object({ deckId: z.string().min(1) }),
  cast_reading: z.object({
    deckId: z.string().min(1),
    spread: z.union([z.string().min(1), spread]),
    question: z.string().max(MAX_QUESTION_LENGTH).optional(),
    reversalRate: z.number().min(0).max(1).optional(),
  }),
  resolve_reading: z.object({ token: z.string().min(1), deckId: z.string().min(1).optional() }),
  interpretation_context: z.object({ token: z.string().min(1), deckId: z.string().min(1).optional() }),
  import_deck: z.object({
    data: z.unknown().optional(),
    json: z.string().max(MAX_IMPORT_JSON_CHARS).optional(),
    tagline: z.string().min(1).optional(),
    spreads: z.array(spread).max(MAX_SPREADS).optional(),
    replaceExisting: z.boolean().optional(),
  }).refine((value) => value.data !== undefined || value.json !== undefined, {
    message: "Provide either data or json.",
  }),
};

export interface ArcanaMcpServerOptions {
  /** Reuse an adapter when the transport provides an appropriate state lifetime. */
  adapter?: ArcanaToolAdapter;
  /** Stateless transports must disable tools whose semantics require persistence across calls. */
  includeStatefulTools?: boolean;
  /** Payload-free observer for alpha diagnostics/metrics. */
  onToolCall?: ArcanaToolCallObserver;
}

export function createArcanaMcpServer(options: ArcanaMcpServerOptions = {}): McpServer {
  const adapter = options.adapter ?? createBundledArcanaAdapter();
  const includeStatefulTools = options.includeStatefulTools ?? true;
  const server = new McpServer({ name: "generative-arcana", version: ARCANA_MCP_VERSION });

  for (const definition of adapter.definitions()) {
    if (definition.name === "import_deck" && !includeStatefulTools) continue;
    server.registerTool(
      definition.name,
      {
        description: definition.description,
        inputSchema: schemas[definition.name],
        annotations: {
          readOnlyHint: definition.name === "cast_reading" ? true : definition.readOnly,
          destructiveHint: false,
          idempotentHint: definition.name !== "cast_reading",
          openWorldHint: false,
        },
      },
      async (input: unknown) => {
        const startedAt = Date.now();
        let ok = false;
        try {
          const result = await adapter.call(definition.name, input);
          ok = true;
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
            structuredContent: { result },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Arcana tool call failed.";
          return { content: [{ type: "text" as const, text: message }], isError: true };
        } finally {
          options.onToolCall?.({ tool: definition.name, ok, durationMs: Date.now() - startedAt });
        }
      },
    );
  }

  return server;
}
