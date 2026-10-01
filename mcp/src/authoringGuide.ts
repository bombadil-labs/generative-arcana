import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadAuthoringGuide } from "../../tools/build-authoring-guide.mjs";
import type { ArcanaToolCallObserver } from "./observability";

export const AUTHORING_GUIDE_URI = "arcana://authoring/guide";
export const AUTHORING_GUIDE_TOOL = "get_deck_authoring_guide";
const bundle = loadAuthoringGuide();
const characters = Array.from(bundle.text);

/** Public, host-neutral actual authoring method; no account, catalog, or renderer dependency. */
export function registerAuthoringGuide(server: McpServer, observer?: ArcanaToolCallObserver): void {
  server.registerResource("deck-authoring-guide", AUTHORING_GUIDE_URI, {
    title: "Complete Generative Arcana authoring guide",
    description: "The full canonical skill, references, strategies and supporting contracts, with source filename headers.",
    mimeType: "text/plain",
  }, async () => ({ contents: [{ uri: AUTHORING_GUIDE_URI, mimeType: "text/plain", text: bundle.text }] }));
  server.registerTool(AUTHORING_GUIDE_TOOL, {
    title: "Read the complete deck-authoring guide",
    description: "Read this before designing or constructing an Arcana deck. Returns the FULL canonical authoring skill, all references/strategies/schema/examples, and supporting contracts verbatim with filename headers, not only schema metadata. No sign-in required. Omit arguments for the entire guide; use offset/maxChars (Unicode code points) only when a host needs lossless chunks. Then consult get_deck_authoring_spec and validate_deck_manifest. Renderer-neutral: this does not restrict visual implementations.",
    inputSchema: z.object({ offset: z.number().int().nonnegative().max(2_000_000).optional(), maxChars: z.number().int().min(1).max(200_000).optional() }).strict(),
    outputSchema: z.object({
      resourceUri: z.string(), formatVersion: z.number(), sourceRoot: z.string(), sourceDigest: z.string(), sha256: z.string(), byteLength: z.number(),
      files: z.array(z.object({ path: z.string(), bytes: z.number(), sha256: z.string() })),
      range: z.object({ offset: z.number(), returnedChars: z.number(), totalChars: z.number(), nextOffset: z.number().nullable() }),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: [{ type: "noauth" }] },
  }, async ({ offset = 0, maxChars }) => {
    const startedAt = Date.now();
    const ok = offset <= characters.length;
    observer?.({ tool: AUTHORING_GUIDE_TOOL, ok, durationMs: Date.now() - startedAt });
    if (!ok) return { isError: true, content: [{ type: "text", text: "offset exceeds the complete guide's character count." }] };
    const end = Math.min(characters.length, offset + (maxChars ?? characters.length));
    return {
      content: [{ type: "text", text: characters.slice(offset, end).join("") }],
      structuredContent: { resourceUri: AUTHORING_GUIDE_URI, ...bundle.metadata,
        range: { offset, returnedChars: end - offset, totalChars: characters.length, nextOffset: end < characters.length ? end : null } },
    };
  });
}
